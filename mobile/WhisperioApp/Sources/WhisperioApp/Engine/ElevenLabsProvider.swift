import Foundation
import WhisperioKit

// Cloud transcription via ElevenLabs Speech-to-Text (BYO key).
struct ElevenLabsProvider: DiarizingProvider {
    let id: ProviderID = .elevenLabs
    let apiKey: String
    var languageCode: String = ""
    var keyterms: [String] = []
    /// Explicit model_id override (e.g. "scribe_v2"/"scribe_v1" — see
    /// `WhisperioSettings.elevenLabsModel`). Empty keeps the original diarize/keyterm-driven
    /// default below, so existing users who never touch the new model picker see zero change.
    var model: String = ""

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
        struct R: Decodable { let text: String }
        let data = try await send(clip, diarize: false)
        return try JSONDecoder().decode(R.self, from: data).text
    }

    /// Conversation mode: same endpoint with `diarize=true` (Scribe v2 — diarization needs
    /// v2), folding the returned word stream into per-speaker segments.
    func transcribeDiarized(_ clip: AudioClip) async throws -> DiarizedTranscription {
        struct Word: Decodable {
            let text: String
            let start: TimeInterval?
            let end: TimeInterval?
            let type: String?
            let speaker_id: String?
        }
        struct R: Decodable {
            let text: String
            let words: [Word]?
        }
        let data = try await send(clip, diarize: true)
        let r = try JSONDecoder().decode(R.self, from: data)
        let segments = SpeakerSegmentBuilder.build(words: (r.words ?? []).map {
            DiarizedWord(text: $0.text, start: $0.start, end: $0.end,
                         type: $0.type ?? "word", speakerID: $0.speaker_id)
        })
        return DiarizedTranscription(text: r.text, segments: segments)
    }

    private func send(_ clip: AudioClip, diarize: Bool) async throws -> Data {
        guard let url = URL(string: "https://api.elevenlabs.io/v1/speech-to-text") else {
            throw Self.err("Invalid ElevenLabs URL.")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue(apiKey, forHTTPHeaderField: "xi-api-key")

        var body = MultipartBody()
        req.setValue(body.contentType, forHTTPHeaderField: "Content-Type")
        let terms = cleanKeyterms
        let trimmedModel = model.trimmingCharacters(in: .whitespaces)
        let modelID = trimmedModel.isEmpty
            ? ((diarize || !terms.isEmpty) ? "scribe_v2" : "scribe_v1")
            : trimmedModel
        body.field("model_id", modelID)
        if diarize { body.field("diarize", "true") }
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
        return data
    }

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.ElevenLabs", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}
