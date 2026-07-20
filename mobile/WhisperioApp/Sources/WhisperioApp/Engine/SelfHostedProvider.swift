import Foundation
import WhisperioKit

// Cloud transcription via a user's own OpenAI-compatible STT server — whisper.cpp's `server`
// example, faster-whisper-server, and speaches all expose the exact same `/v1/audio/
// transcriptions` multipart shape OpenAI does, so this reuses that wire format against a
// user-supplied base URL instead of api.openai.com. R4: audio still leaves the device (it's a
// network request to *some* host), so this stays honestly `isCloud == true`, even though it's
// the user's own hardware rather than a named vendor.
struct SelfHostedProvider: TranscriptionProvider {
    let id: ProviderID = .selfHosted
    let baseURL: String
    let apiKey: String
    let model: String
    let language: String

    /// Configured as soon as the URL is non-empty and parses to a real host — no key is
    /// required, since most self-hosted servers run with no auth at all on a trusted LAN/tunnel.
    var isConfigured: Bool { Self.normalizedBase(baseURL) != nil }

    func transcribe(_ clip: AudioClip) async throws -> String {
        guard let base = Self.normalizedBase(baseURL) else {
            throw Self.err("Add your server's URL in Settings before dictating.")
        }
        let url = base.appendingPathComponent("audio/transcriptions")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespaces)
        if !trimmedKey.isEmpty {
            req.setValue("Bearer \(trimmedKey)", forHTTPHeaderField: "Authorization")
        }

        var body = MultipartBody()
        req.setValue(body.contentType, forHTTPHeaderField: "Content-Type")
        body.field("model", model.isEmpty ? "whisper-1" : model)
        if language != "auto" && !language.isEmpty { body.field("language", language) }
        body.file(name: "file", filename: clip.filename,
                  contentType: "application/octet-stream", data: clip.data)
        req.httpBody = body.finalize()

        let (data, resp) = try await MultipartBody.uploadSession.data(for: req)
        guard let http = resp as? HTTPURLResponse else {
            throw Self.err("No response from your self-hosted server at \(base.absoluteString).")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.err("Self-hosted server error \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
        }
        struct R: Decodable { let text: String }
        return try JSONDecoder().decode(R.self, from: data).text
    }

    /// Accepts a bare host ("localhost:8000", "192.168.1.5:5000") or a full
    /// "http(s)://host[:port][/v1]" URL, and always ends up rooted at a `/v1` base so
    /// `audio/transcriptions` resolves the same way it does against OpenAI itself. Returns nil
    /// for anything that doesn't parse to a real host — the honest "not configured" signal.
    static func normalizedBase(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if !s.contains("://") { s = "http://" + s }
        guard var url = URL(string: s), let host = url.host, !host.isEmpty else { return nil }
        if !url.path.hasSuffix("/v1") {
            url = url.appendingPathComponent("v1")
        }
        return url
    }

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.SelfHosted", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}
