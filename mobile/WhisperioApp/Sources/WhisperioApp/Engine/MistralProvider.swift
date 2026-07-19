import Foundation
import WhisperioKit

// Cloud transcription via Mistral's OpenAI-compatible audio/transcriptions endpoint (BYO key).
// Voxtral open-weights models — same request/response shape as OpenAIProvider, with a fixed
// base URL and Mistral's model catalog.
struct MistralProvider: TranscriptionProvider {
    let id: ProviderID = .mistral
    let apiKey: String
    let model: String
    let language: String

    var isConfigured: Bool { !apiKey.trimmingCharacters(in: .whitespaces).isEmpty }

    // Settings persists the design's short model ids; Mistral's API wants the -latest aliases.
    private var apiModel: String {
        switch model {
        case "", "voxtral-small": return "voxtral-small-latest"
        case "voxtral-mini": return "voxtral-mini-latest"
        default: return model
        }
    }

    func transcribe(_ clip: AudioClip) async throws -> String {
        guard let url = URL(string: "https://api.mistral.ai/v1/audio/transcriptions") else {
            throw Self.err("Invalid Mistral URL.")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        var body = MultipartBody()
        req.setValue(body.contentType, forHTTPHeaderField: "Content-Type")
        body.field("model", apiModel)
        if language != "auto" && !language.isEmpty { body.field("language", language) }
        body.file(name: "file", filename: clip.filename,
                  contentType: "application/octet-stream", data: clip.data)
        req.httpBody = body.finalize()

        let (data, resp) = try await MultipartBody.uploadSession.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw Self.err("No response from Mistral.") }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.err("Mistral error \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
        }
        struct R: Decodable { let text: String }
        return try JSONDecoder().decode(R.self, from: data).text
    }

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.Mistral", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}
