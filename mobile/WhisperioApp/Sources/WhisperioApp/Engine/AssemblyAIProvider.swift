import Foundation
import WhisperioKit

// Cloud transcription via AssemblyAI (BYO key). Universal models — a three-step async flow:
// upload the raw audio, create a transcript job, then poll until it completes. Uses the shared
// uploadSession so the upload leg gets the same timeouts as the other providers.
//
// Diarization: passing `speaker_labels: true` on job creation makes AssemblyAI return an
// `utterances` array (speaker letter + text + ms timestamps) alongside the flat `text` —
// folded into `SpeakerSegment`s by `AssemblyAISegmentMapper` (WhisperioKit, unit-tested there
// since this App-target file has no test target of its own).
struct AssemblyAIProvider: DiarizingProvider {
    let id: ProviderID = .assemblyAI
    let apiKey: String
    let model: String
    let language: String

    var isConfigured: Bool { !apiKey.trimmingCharacters(in: .whitespaces).isEmpty }

    private static let base = "https://api.assemblyai.com/v2"
    /// Poll every 2 s, up to ~5 minutes, before giving up on a stuck job.
    private static let pollInterval: UInt64 = 2_000_000_000
    private static let maxPolls = 150

    // Settings persists the design's short model ids; map them onto AssemblyAI's
    // `speech_model` values ("universal" is Universal-2, "best" the previous generation).
    private var apiModel: String {
        switch model {
        case "", "universal-2": return "universal"
        case "universal-1": return "best"
        default: return model
        }
    }

    private struct Job: Decodable {
        let id: String
        let status: String
        let text: String?
        let error: String?
        let utterances: [AssemblyAISegmentMapper.Utterance]?
    }

    func transcribe(_ clip: AudioClip) async throws -> String {
        let job = try await runJob(clip, diarize: false)
        guard let text = job.text else { throw Self.err("AssemblyAI returned no transcript.") }
        return text
    }

    /// Conversation mode: same job flow with `speaker_labels: true`, folding the returned
    /// utterances into per-speaker segments.
    func transcribeDiarized(_ clip: AudioClip) async throws -> DiarizedTranscription {
        let job = try await runJob(clip, diarize: true)
        guard let text = job.text else { throw Self.err("AssemblyAI returned no transcript.") }
        let segments = AssemblyAISegmentMapper.segments(from: job.utterances ?? [])
        return DiarizedTranscription(text: text, segments: segments)
    }

    // Upload the raw audio, create the transcript job (speaker_labels when diarizing), then
    // poll until it completes or errors.
    private func runJob(_ clip: AudioClip, diarize: Bool) async throws -> Job {
        // 1. Upload the raw audio; the response carries a private URL for step 2.
        guard let uploadURL = URL(string: Self.base + "/upload") else {
            throw Self.err("Invalid AssemblyAI URL.")
        }
        var upload = URLRequest(url: uploadURL)
        upload.httpMethod = "POST"
        upload.setValue(apiKey, forHTTPHeaderField: "authorization")
        upload.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        upload.httpBody = clip.data
        let audioURL: String
        do {
            let data = try await send(upload, step: "upload")
            struct Uploaded: Decodable { let upload_url: String }
            audioURL = try JSONDecoder().decode(Uploaded.self, from: data).upload_url
        }

        // 2. Create the transcript job.
        guard let jobURL = URL(string: Self.base + "/transcript") else {
            throw Self.err("Invalid AssemblyAI URL.")
        }
        struct JobRequest: Encodable {
            let audio_url: String
            let speech_model: String
            let language_code: String?
            let language_detection: Bool?
            let speaker_labels: Bool?
        }
        let auto = language == "auto" || language.isEmpty
        var create = URLRequest(url: jobURL)
        create.httpMethod = "POST"
        create.setValue(apiKey, forHTTPHeaderField: "authorization")
        create.setValue("application/json", forHTTPHeaderField: "Content-Type")
        create.httpBody = try JSONEncoder().encode(JobRequest(
            audio_url: audioURL, speech_model: apiModel,
            language_code: auto ? nil : language,
            language_detection: auto ? true : nil,
            speaker_labels: diarize ? true : nil))
        let job = try JSONDecoder().decode(Job.self, from: try await send(create, step: "transcript"))

        // 3. Poll until the job settles.
        guard let pollURL = URL(string: Self.base + "/transcript/" + job.id) else {
            throw Self.err("Invalid AssemblyAI URL.")
        }
        for _ in 0..<Self.maxPolls {
            try await Task.sleep(nanoseconds: Self.pollInterval)
            var poll = URLRequest(url: pollURL)
            poll.setValue(apiKey, forHTTPHeaderField: "authorization")
            let state = try JSONDecoder().decode(Job.self, from: try await send(poll, step: "status"))
            switch state.status {
            case "completed":
                return state
            case "error":
                throw Self.err("AssemblyAI failed: \(state.error ?? "unknown error")")
            default:
                continue   // queued / processing — keep polling
            }
        }
        throw Self.err("AssemblyAI timed out waiting for the transcript.")
    }

    private func send(_ req: URLRequest, step: String) async throws -> Data {
        let (data, resp) = try await MultipartBody.uploadSession.data(for: req)
        guard let http = resp as? HTTPURLResponse else {
            throw Self.err("No response from AssemblyAI (\(step)).")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.err("AssemblyAI \(step) error \(http.statusCode): \(String(data: data, encoding: .utf8) ?? "")")
        }
        return data
    }

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.AssemblyAI", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}
