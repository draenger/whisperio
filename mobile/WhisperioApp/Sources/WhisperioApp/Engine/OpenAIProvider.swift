import Foundation
import WhisperioKit

// Cloud transcription via OpenAI's audio/transcriptions endpoint (BYO key).
//
// Diarization: `gpt-4o-transcribe-diarize` with `response_format=diarized_json` returns a
// `segments` array (speaker letter + text + start/end seconds) alongside the flat `text` —
// folded into `SpeakerSegment`s by `OpenAISegmentMapper` (WhisperioKit, unit-tested there).
// Design promises "up to 4 speakers" for this engine (vs. ElevenLabs' up to 32), matching
// OpenAI's documented diarization ceiling.
struct OpenAIProvider: DiarizingProvider {
    let id: ProviderID = .openAI
    let apiKey: String
    let baseURL: String
    let model: String
    let language: String
    var prompt: String = ""

    var isConfigured: Bool { !apiKey.trimmingCharacters(in: .whitespaces).isEmpty }

    func transcribe(_ clip: AudioClip) async throws -> String {
        struct R: Decodable { let text: String }
        let data = try await send(clip, diarize: false)
        return try JSONDecoder().decode(R.self, from: data).text
    }

    /// Conversation mode: same endpoint with the diarizing model + `response_format=diarized_json`,
    /// folding the returned segments into per-speaker segments.
    func transcribeDiarized(_ clip: AudioClip) async throws -> DiarizedTranscription {
        struct R: Decodable {
            let text: String
            let segments: [OpenAISegmentMapper.Segment]?
        }
        let data = try await send(clip, diarize: true)
        let r = try JSONDecoder().decode(R.self, from: data)
        let segments = OpenAISegmentMapper.segments(from: r.segments ?? [])
        return DiarizedTranscription(text: r.text, segments: segments)
    }

    private func send(_ clip: AudioClip, diarize: Bool) async throws -> Data {
        let trimmedBase = baseURL.trimmingCharacters(in: .whitespaces)
        let base = trimmedBase.isEmpty ? "https://api.openai.com/v1" : trimmedBase
        guard let url = URL(string: base + "/audio/transcriptions") else {
            throw Self.err("Invalid OpenAI base URL.")
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        var body = MultipartBody()
        req.setValue(body.contentType, forHTTPHeaderField: "Content-Type")
        body.field("model", diarize ? "gpt-4o-transcribe-diarize" : (model.isEmpty ? "whisper-1" : model))
        if diarize { body.field("response_format", "diarized_json") }
        if language != "auto" && !language.isEmpty { body.field("language", language) }
        if !prompt.trimmingCharacters(in: .whitespaces).isEmpty { body.field("prompt", prompt) }
        body.file(name: "file", filename: clip.filename,
                  contentType: "application/octet-stream", data: clip.data)
        req.httpBody = body.finalize()

        let (data, resp) = try await MultipartBody.uploadSession.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw Self.err("No response from OpenAI.") }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.err("OpenAI error \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
        }
        return data
    }

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.OpenAI", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}
