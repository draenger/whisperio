import Foundation
import WhisperioKit

// Cloud transcription via Groq's OpenAI-compatible audio/transcriptions endpoint (BYO key).
// Fastest hosted Whisper inference — same request/response shape as OpenAIProvider, with a
// fixed base URL and Groq's model catalog.
struct GroqProvider: TranscriptionProvider {
    let id: ProviderID = .groq
    let apiKey: String
    let model: String
    let language: String
    var prompt: String = ""

    var isConfigured: Bool { !apiKey.trimmingCharacters(in: .whitespaces).isEmpty }

    // Settings persists the design's short model ids; map the one whose Groq API id differs.
    private var apiModel: String {
        switch model {
        case "": return "whisper-large-v3-turbo"
        case "distil-whisper": return "distil-whisper-large-v3-en"
        default: return model
        }
    }

    func transcribe(_ clip: AudioClip) async throws -> String {
        guard let url = URL(string: "https://api.groq.com/openai/v1/audio/transcriptions") else {
            throw Self.err("Invalid Groq URL.")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        var body = MultipartBody()
        req.setValue(body.contentType, forHTTPHeaderField: "Content-Type")
        body.field("model", apiModel)
        if language != "auto" && !language.isEmpty { body.field("language", language) }
        if !prompt.trimmingCharacters(in: .whitespaces).isEmpty { body.field("prompt", prompt) }
        body.file(name: "file", filename: clip.filename,
                  contentType: "application/octet-stream", data: clip.data)
        req.httpBody = body.finalize()

        let (data, resp) = try await MultipartBody.uploadSession.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw Self.err("No response from Groq.") }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.err("Groq error \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
        }
        struct R: Decodable { let text: String }
        return try JSONDecoder().decode(R.self, from: data).text
    }

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.Groq", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}
