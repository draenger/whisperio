import Foundation
import Speech
import WhisperioKit

// On-device transcription via Apple's Speech framework (free, private, no network).
struct AppleSpeechProvider: TranscriptionProvider {
    let id: ProviderID = .onDevice
    let locale: Locale
    let vocabulary: [String]

    init(language: String, vocabulary: [String] = []) {
        if language == "auto" || language.isEmpty {
            locale = Locale.current
        } else {
            locale = Locale(identifier: language)
        }
        self.vocabulary = vocabulary
    }

    var isConfigured: Bool {
        guard let r = SFSpeechRecognizer(locale: locale) else { return false }
        return r.isAvailable
    }

    func transcribe(_ clip: AudioClip) async throws -> String {
        let ext = (clip.filename as NSString).pathExtension
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(ext.isEmpty ? "m4a" : ext)
        try clip.data.write(to: url)

        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
            try? FileManager.default.removeItem(at: url)
            throw Self.err("Apple Speech is unavailable for \(locale.identifier).")
        }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            try? FileManager.default.removeItem(at: url)
            throw Self.err("Speech recognition permission not granted.")
        }

        // Require true on-device recognition — honors the "private / offline" promise.
        // Without it, SFSpeechRecognizer silently uploads audio to Apple's servers.
        guard recognizer.supportsOnDeviceRecognition else {
            try? FileManager.default.removeItem(at: url)
            throw Self.err("On-device speech isn't available for \(locale.identifier). Install dictation for this language in iOS Settings, or pick a cloud engine (OpenAI / ElevenLabs).")
        }

        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false
        request.requiresOnDeviceRecognition = true
        if !vocabulary.isEmpty { request.contextualStrings = vocabulary }

        let once = ResumeOnce()
        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
            let task = recognizer.recognitionTask(with: request) { result, error in
                if let error {
                    once.run { try? FileManager.default.removeItem(at: url); cont.resume(throwing: error) }
                    return
                }
                if let result, result.isFinal {
                    let text = result.bestTranscription.formattedString
                    once.run { try? FileManager.default.removeItem(at: url); cont.resume(returning: text) }
                }
            }
            // Recognition can stall on silent/empty audio without ever returning a final
            // result or an error — guard against an indefinite hang.
            DispatchQueue.global().asyncAfter(deadline: .now() + 25) {
                once.run {
                    task.cancel()
                    try? FileManager.default.removeItem(at: url)
                    cont.resume(throwing: Self.err("Transcription timed out — try again and speak clearly."))
                }
            }
        }
    }

    static func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.AppleSpeech", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}

// Guards a CheckedContinuation against the double-resume that crashes if a recognition
// callback fires more than once.
final class ResumeOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func run(_ body: () -> Void) {
        lock.lock(); defer { lock.unlock() }
        guard !done else { return }
        done = true
        body()
    }
}
