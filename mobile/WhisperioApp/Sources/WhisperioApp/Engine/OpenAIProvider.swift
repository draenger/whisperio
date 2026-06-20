import Foundation
import WhisperioKit

// Cloud transcription via OpenAI's audio/transcriptions endpoint (BYO key).
struct OpenAIProvider: TranscriptionProvider {
    let id: ProviderID = .openAI
    let apiKey: String
    let baseURL: String
    let model: String
    let language: String
    var prompt: String = ""

    var isConfigured: Bool { !apiKey.trimmingCharacters(in: .whitespaces).isEmpty }

    func transcribe(_ clip: AudioClip) async throws -> String {
        let trimmedBase = baseURL.trimmingCharacters(in: .whitespaces)
        let base = trimmedBase.isEmpty ? "https://api.openai.com/v1" : trimmedBase
        guard let url = URL(string: base + "/audio/transcriptions") else {
            throw Self.err("Invalid OpenAI base URL.")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        let boundary = "----whisperio-\(UUID().uuidString)"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        func field(_ name: String, _ value: String) {
            body.appendString("--\(boundary)\r\n")
            body.appendString("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            body.appendString("\(value)\r\n")
        }
        field("model", model.isEmpty ? "whisper-1" : model)
        if language != "auto" && !language.isEmpty { field("language", language) }
        if !prompt.trimmingCharacters(in: .whitespaces).isEmpty { field("prompt", prompt) }
        body.appendString("--\(boundary)\r\n")
        body.appendString("Content-Disposition: form-data; name=\"file\"; filename=\"\(clip.filename)\"\r\n")
        body.appendString("Content-Type: application/octet-stream\r\n\r\n")
        body.append(clip.data)
        body.appendString("\r\n--\(boundary)--\r\n")
        req.httpBody = body

        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw Self.err("No response from OpenAI.") }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.err("OpenAI error \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
        }
        struct R: Decodable { let text: String }
        return try JSONDecoder().decode(R.self, from: data).text
    }

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.OpenAI", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}

extension Data {
    mutating func appendString(_ string: String) {
        if let d = string.data(using: .utf8) { append(d) }
    }
}
