import Foundation
import WhisperioKit

// Cloud transcription via ElevenLabs Speech-to-Text (BYO key).
struct ElevenLabsProvider: TranscriptionProvider {
    let id: ProviderID = .elevenLabs
    let apiKey: String
    var languageCode: String = ""
    var keyterms: [String] = []

    var isConfigured: Bool { !apiKey.trimmingCharacters(in: .whitespaces).isEmpty }

    // Keyterm biasing requires Scribe v2 (+20% cost); plain transcription uses v1.
    private var cleanKeyterms: [String] {
        let banned = CharacterSet(charactersIn: "<>{}[]\\")
        return keyterms
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && $0.count <= 50
                && $0.split(separator: " ").count <= 5
                && $0.rangeOfCharacter(from: banned) == nil }
    }

    func transcribe(_ clip: AudioClip) async throws -> String {
        guard let url = URL(string: "https://api.elevenlabs.io/v1/speech-to-text") else {
            throw Self.err("Invalid ElevenLabs URL.")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue(apiKey, forHTTPHeaderField: "xi-api-key")

        var body = MultipartBody()
        req.setValue(body.contentType, forHTTPHeaderField: "Content-Type")
        let terms = cleanKeyterms
        body.field("model_id", terms.isEmpty ? "scribe_v1" : "scribe_v2")
        if !languageCode.isEmpty && languageCode != "auto" { body.field("language_code", languageCode) }
        if !terms.isEmpty, let data = try? JSONEncoder().encode(terms),
           let json = String(data: data, encoding: .utf8) {
            body.field("keyterms", json)
        }
        body.file(name: "file", filename: clip.filename,
                  contentType: "application/octet-stream", data: clip.data)
        req.httpBody = body.finalize()

        let (data, resp) = try await MultipartBody.uploadSession.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw Self.err("No response from ElevenLabs.") }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.err("ElevenLabs error \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
        }
        struct R: Decodable { let text: String }
        return try JSONDecoder().decode(R.self, from: data).text
    }

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.ElevenLabs", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}
