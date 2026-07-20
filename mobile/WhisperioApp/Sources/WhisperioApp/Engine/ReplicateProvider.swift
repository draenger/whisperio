import Foundation
import WhisperioKit

// Cloud transcription via Replicate's hosted-model API (BYO API token). Runs the canonical
// `openai/whisper` model unless `model` names a different `owner/name` (or `owner/name:version`)
// slug — see `WhisperioSettings.replicateModel`.
//
// Verified against Replicate's HTTP API docs (2026-07): predictions are created with
// `POST /v1/models/{owner}/{name}/predictions`, `Authorization: Bearer <token>`, and a JSON
// `{"input": {...}}` body; `Prefer: wait=<seconds>` holds the connection open for up to 60s so
// short dictation clips usually resolve synchronously, otherwise the response comes back
// `starting`/`processing` and is polled via `GET /v1/predictions/{id}` until `succeeded`/
// `failed`/`canceled`. Files are passed as HTTP URLs or `data:` URIs; Replicate's own docs say
// data URIs are fine under ~256KB and recommends uploading larger files via the Files API
// (`POST /v1/files`, multipart `content` field) first and referencing the returned URL instead.
// `GET /v1/account` is Replicate's own token-verification endpoint (used by ProviderKeyValidator).
struct ReplicateProvider: TranscriptionProvider {
    let id: ProviderID = .replicate
    let apiKey: String
    var model: String = ""

    /// Above this, inline as a data: URI is skipped in favor of the Files API — matches
    /// Replicate's documented ~256KB guidance for inline data URLs.
    private static let inlineLimit = 256_000
    /// How long to hold the connection open per Replicate's `Prefer: wait=n` (max 60, docs).
    private static let waitSeconds = 30
    /// Polling cadence/cap once a prediction is still running after the synchronous wait.
    private static let pollIntervalNanos: UInt64 = 2_000_000_000
    private static let maxPollAttempts = 30

    var isConfigured: Bool { !apiKey.trimmingCharacters(in: .whitespaces).isEmpty }

    func transcribe(_ clip: AudioClip) async throws -> String {
        let audioRef = try await audioInput(for: clip)
        let slug = model.trimmingCharacters(in: .whitespaces)
        let modelSlug = slug.isEmpty ? "openai/whisper" : slug

        guard let url = URL(string: "https://api.replicate.com/v1/models/\(modelSlug)/predictions") else {
            throw Self.err("Invalid Replicate model \"\(modelSlug)\".")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("wait=\(Self.waitSeconds)", forHTTPHeaderField: "Prefer")
        let body: [String: Any] = ["input": ["audio": audioRef, "transcription": "plain text"]]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw Self.err("No response from Replicate.") }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.err("Replicate error \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
        }

        var prediction = try Self.parse(data)
        var attempts = 0
        while !Self.isTerminal(prediction.status), attempts < Self.maxPollAttempts {
            try await Task.sleep(nanoseconds: Self.pollIntervalNanos)
            attempts += 1
            prediction = try await Self.poll(id: prediction.id, apiKey: apiKey)
        }

        switch prediction.status {
        case "succeeded":
            let text = Self.extractText(from: prediction.output)
            guard !text.isEmpty else { throw Self.err("Replicate returned no transcription.") }
            return text
        case "failed", "canceled":
            throw Self.err("Replicate prediction \(prediction.status): \(prediction.error ?? "unknown error")")
        default:
            throw Self.err("Replicate prediction timed out (still \(prediction.status)).")
        }
    }

    private static func isTerminal(_ status: String) -> Bool {
        status == "succeeded" || status == "failed" || status == "canceled"
    }

    // MARK: - Audio input

    private func audioInput(for clip: AudioClip) async throws -> String {
        if clip.data.count <= Self.inlineLimit {
            let ext = (clip.filename as NSString).pathExtension
            let mime = "audio/\(ext.isEmpty ? "wav" : ext)"
            return "data:\(mime);base64,\(clip.data.base64EncodedString())"
        }
        return try await upload(clip)
    }

    private func upload(_ clip: AudioClip) async throws -> String {
        guard let url = URL(string: "https://api.replicate.com/v1/files") else {
            throw Self.err("Invalid Replicate files URL.")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        var body = MultipartBody()
        req.setValue(body.contentType, forHTTPHeaderField: "Content-Type")
        body.file(name: "content", filename: clip.filename,
                  contentType: "application/octet-stream", data: clip.data)
        req.httpBody = body.finalize()

        let (data, resp) = try await MultipartBody.uploadSession.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw Self.err("Replicate file upload failed.")
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let urls = json["urls"] as? [String: Any],
              let get = urls["get"] as? String else {
            throw Self.err("Replicate file upload returned no URL.")
        }
        return get
    }

    // MARK: - Prediction wire shape (parsed loosely — output schema varies per model)

    private struct Prediction {
        let id: String
        let status: String
        let output: Any?
        let error: String?
    }

    private static func parse(_ data: Data) throws -> Prediction {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = json["id"] as? String, let status = json["status"] as? String else {
            throw err("Malformed Replicate response.")
        }
        let errorText: String?
        if let s = json["error"] as? String { errorText = s }
        else if let d = json["error"] as? [String: Any] { errorText = (d["detail"] as? String) ?? "\(d)" }
        else { errorText = nil }
        return Prediction(id: id, status: status, output: json["output"], error: errorText)
    }

    private static func poll(id: String, apiKey: String) async throws -> Prediction {
        guard let url = URL(string: "https://api.replicate.com/v1/predictions/\(id)") else {
            throw err("Invalid Replicate prediction URL.")
        }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw err("Replicate poll error.")
        }
        return try parse(data)
    }

    /// Whisper-family models on Replicate return `{"transcription": "..."}` (plus segments/
    /// detected_language); other community models may return a bare string or a list of
    /// segment dicts with a `text` field. Handle all three shapes rather than assume one.
    private static func extractText(from output: Any?) -> String {
        if let s = output as? String { return s }
        if let dict = output as? [String: Any] {
            if let t = dict["transcription"] as? String { return t }
            if let t = dict["text"] as? String { return t }
        }
        if let arr = output as? [Any] {
            let parts: [String] = arr.compactMap {
                if let s = $0 as? String { return s }
                if let d = $0 as? [String: Any], let t = d["text"] as? String { return t }
                return nil
            }
            if !parts.isEmpty { return parts.joined(separator: " ") }
        }
        return ""
    }

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.Replicate", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}
