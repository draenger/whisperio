import Foundation
@preconcurrency import Speech
import WhisperioKit

// On-device transcription via Apple's Speech framework (free, private, no network).
struct AppleSpeechProvider: TranscriptionProvider {
    let id: ProviderID = .onDevice
    let locale: Locale
    let vocabulary: [String]
    /// When true, recognition is pinned on-device (audio never leaves). When false, Apple
    /// may use its online recognition so STT still works where on-device isn't available.
    let requireOnDevice: Bool

    init(language: String, vocabulary: [String] = [], requireOnDevice: Bool = true) {
        if language == "auto" || language.isEmpty {
            locale = Locale.current
        } else {
            locale = Locale(identifier: language)
        }
        self.vocabulary = vocabulary
        self.requireOnDevice = requireOnDevice
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

        // In on-device mode, refuse if the device can't do it locally (honors the
        // "audio never leaves the device" promise). When the user has allowed Apple online
        // recognition, skip this guard so STT still works via Apple's servers.
        if requireOnDevice && !recognizer.supportsOnDeviceRecognition {
            try? FileManager.default.removeItem(at: url)
            throw Self.err("On-device speech isn't available for \(locale.identifier). Turn on “Apple online speech” in Settings, install dictation for this language in iOS Settings, or pick a cloud engine (OpenAI / ElevenLabs).")
        }

        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false
        request.requiresOnDeviceRecognition = requireOnDevice
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
