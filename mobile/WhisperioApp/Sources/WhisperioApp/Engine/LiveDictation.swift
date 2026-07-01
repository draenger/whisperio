import Foundation
import AVFoundation
@preconcurrency import Speech
import Combine
import CoreGraphics
import WhisperioKit

/// Live on-device dictation — streams partial results while you speak (the concept's
/// "live recording with on-device partial results", same technique Husar uses). A single
/// `AVAudioEngine` tap feeds both the speech recognizer (running transcript) and an audio
/// file, so the clip can still be saved. iOS on-device only; cloud engines stay file-based.
///
/// Not `@MainActor`: the mic tap fires on the audio thread, so state is plain and every
/// `@Published` mutation hops to main explicitly (mirrors the Husar recognizer).
final class LiveDictation: ObservableObject, @unchecked Sendable {
    @Published private(set) var transcript: String = ""
    @Published private(set) var level: CGFloat = 0
    @Published private(set) var isRunning = false

    private let audioEngine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var file: AVAudioFile?
    private var fileURL: URL?
    private var startedAt: Date?

    // Config captured at start(), so a segment restart can rebuild the request identically.
    private var requireOnDevice = true
    private var vocabulary: [String] = []
    /// Synchronous stop flag read on the recognition callback queue. `isRunning` is @Published
    /// and only flips on main (async), which would let a callback restart a segment *after*
    /// teardown; this plain bool is cleared synchronously in teardown so that can't happen.
    private var active = false
    /// Text of segments already finalized in THIS dictation. SFSpeech finalizes (and stops)
    /// a segment on a pause, and the next segment's transcript starts empty — so we keep the
    /// committed text here and always display `committed + current partial`. Without this a
    /// pause wipes everything said before it. Only mutated on the recognition callback queue.
    private var committed: String = ""

    /// True when live dictation is possible for this language — the gate RecordingView uses
    /// to decide between the live path and file-then-transcribe. In on-device mode it also
    /// requires local recognition support; when Apple online is allowed, availability alone
    /// is enough (Apple streams partials from its servers too).
    static func isSupported(language: String, requireOnDevice: Bool) -> Bool {
        guard let r = SFSpeechRecognizer(locale: localeFor(language)), r.isAvailable else { return false }
        return requireOnDevice ? r.supportsOnDeviceRecognition : true
    }

    private static func localeFor(_ language: String) -> Locale {
        (language == "auto" || language.isEmpty) ? .current : Locale(identifier: language)
    }

    /// Begin streaming dictation. `transcript` then updates live until `finish()`/`cancel()`.
    func start(language: String, vocabulary: [String], requireOnDevice: Bool) throws {
        let recognizer = SFSpeechRecognizer(locale: Self.localeFor(language))
        guard let recognizer, recognizer.isAvailable else {
            throw err("Dictation isn't available for \(Self.localeFor(language).identifier).")
        }
        if requireOnDevice && !recognizer.supportsOnDeviceRecognition {
            throw err("On-device dictation isn't available for \(Self.localeFor(language).identifier).")
        }
        self.recognizer = recognizer
        self.requireOnDevice = requireOnDevice
        self.vocabulary = vocabulary
        self.committed = ""

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)

        // Persist audio alongside recognition so a saved recording still has its clip.
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("whisperio-\(UUID().uuidString).caf")
        file = try AVAudioFile(forWriting: url, settings: format.settings)
        fileURL = url

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            self.request?.append(buffer)
            try? self.file?.write(from: buffer)
            let lvl = Self.rms(buffer)
            DispatchQueue.main.async { self.level = lvl }
        }

        audioEngine.prepare()
        try audioEngine.start()

        transcript = ""
        startedAt = Date()
        active = true
        isRunning = true

        startRecognitionSegment()
    }

    /// (Re)start a recognition request over the live audio engine. Called once at start and
    /// again every time a segment finalizes on a pause, so dictation continues across pauses
    /// instead of stopping — the audio tap keeps feeding whatever `self.request` currently is.
    private func startRecognitionSegment() {
        guard let recognizer else { return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = requireOnDevice   // on = "audio never leaves"
        if !vocabulary.isEmpty { request.contextualStrings = vocabulary }
        self.request = request

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            if let result {
                let segment = result.bestTranscription.formattedString
                // Live view = everything committed so far + this in-progress segment.
                let live = Self.join(self.committed, segment)
                DispatchQueue.main.async { self.transcript = live }

                if result.isFinal {
                    // Pause detected: bank this segment and open a fresh one so the next
                    // words append instead of replacing what came before.
                    self.committed = live
                    if self.active { self.startRecognitionSegment() }
                    return
                }
            }
            // On-device recognition often reports the end-of-segment as an error right after
            // it finalizes. While we're still recording, treat that as a segment boundary and
            // keep going rather than letting dictation die on the first pause.
            if error != nil, self.active {
                self.startRecognitionSegment()
            }
        }
    }

    /// Join two transcript fragments with a single separating space, trimming stray edges.
    private static func join(_ a: String, _ b: String) -> String {
        let head = a.trimmingCharacters(in: .whitespacesAndNewlines)
        let tail = b.trimmingCharacters(in: .whitespacesAndNewlines)
        if head.isEmpty { return tail }
        if tail.isEmpty { return head }
        return head + " " + tail
    }

    /// Stop and hand back the final transcript + the captured clip (for saving).
    func finish() -> (text: String, clip: AudioClip?) {
        let duration = startedAt.map { Date().timeIntervalSince($0) } ?? 0
        let text = transcript
        teardown()
        var clip: AudioClip?
        if let url = fileURL, let data = try? Data(contentsOf: url) {
            clip = AudioClip(data: data, filename: url.lastPathComponent, duration: duration)
            try? FileManager.default.removeItem(at: url)
        }
        fileURL = nil
        return (text, clip)
    }

    func cancel() {
        teardown()
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
        fileURL = nil
        DispatchQueue.main.async { self.transcript = "" }
    }

    private func teardown() {
        active = false   // synchronous: block any in-flight callback from restarting a segment
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        file = nil
        DispatchQueue.main.async { self.isRunning = false; self.level = 0 }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private static func rms(_ buffer: AVAudioPCMBuffer) -> CGFloat {
        guard let ch = buffer.floatChannelData?[0] else { return 0 }
        let n = Int(buffer.frameLength)
        guard n > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<n { let s = ch[i]; sum += s * s }
        return CGFloat(min(1, sqrtf(sum / Float(n)) * 6))   // RMS → 0…1 with headroom
    }

    private func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.LiveDictation", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}
