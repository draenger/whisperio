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
/// Threading model: the mic tap fires on the audio thread and recognition callbacks arrive
/// on an arbitrary Speech queue, so all recognition state (`request`/`task`/`committed`/…)
/// is confined to a private serial `stateQueue`. The `AVAudioEngine` itself (and `fileURL`)
/// stays main-confined — `start()`/`finish()`/`cancel()` are `@MainActor`. Every `@Published`
/// mutation hops to main explicitly (mirrors the Husar recognizer).
final class LiveDictation: ObservableObject, @unchecked Sendable {
    @Published private(set) var transcript: String = ""
    @Published private(set) var level: CGFloat = 0
    @Published private(set) var isRunning = false
    /// Non-nil once dictation has died mid-session (e.g. repeated recognizer errors). The
    /// UI observes this to leave the listening state instead of spinning forever.
    @Published private(set) var failure: String?

    private let audioEngine = AVAudioEngine()
    private var fileURL: URL?
    private var startedAt: Date?

    /// Serial queue guarding all recognition state below. The audio tap and the Speech
    /// callbacks both hop through it, so segment swaps can never race a buffer append.
    private let stateQueue = DispatchQueue(label: "whisperio.dictation")

    // MARK: state confined to `stateQueue`
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var file: AVAudioFile?
    // Config captured at start(), so a segment restart can rebuild the request identically.
    private var requireOnDevice = true
    private var vocabulary: [String] = []
    /// Synchronous stop flag: cleared inside `stateQueue` on teardown so a trailing
    /// recognition callback can never restart a segment after we stopped.
    private var active = false
    /// Text of segments already finalized in THIS dictation. SFSpeech finalizes (and stops)
    /// a segment on a pause, and the next segment's transcript starts empty — so we keep the
    /// committed text here and always display `committed + current partial`. Without this a
    /// pause wipes everything said before it.
    private var committed: String = ""
    /// Latest partial text of the in-flight segment — kept callback-side so `finish()` can
    /// fold the tail in even if the last `@Published transcript` hop hasn't landed yet.
    private var currentSegment: String = ""
    /// Errors handled back-to-back without any interleaved result. Caps the error→restart
    /// loop so a persistently failing recognizer surfaces `failure` instead of spinning hot.
    private var consecutiveErrorRestarts = 0
    private static let maxConsecutiveErrorRestarts = 3
    /// Set while `finish()` waits for the recognizer to flush the tail of the last segment;
    /// signaled from the callback on the segment's final result (or trailing error).
    private var finishSignal: DispatchSemaphore?

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
    @MainActor
    func start(language: String, vocabulary: [String], requireOnDevice: Bool) throws {
        let recognizer = SFSpeechRecognizer(locale: Self.localeFor(language))
        guard let recognizer, recognizer.isAvailable else {
            throw err("Dictation isn't available for \(Self.localeFor(language).identifier).")
        }
        if requireOnDevice && !recognizer.supportsOnDeviceRecognition {
            throw err("On-device dictation isn't available for \(Self.localeFor(language).identifier).")
        }

        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
        try session.setActive(true, options: .notifyOthersOnDeactivation)
        #endif

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)

        // Persist audio alongside recognition so a saved recording still has its clip.
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("whisperio-\(UUID().uuidString).caf")
        let audioFile = try AVAudioFile(forWriting: url, settings: format.settings)
        fileURL = url

        stateQueue.sync {
            self.recognizer = recognizer
            self.requireOnDevice = requireOnDevice
            self.vocabulary = vocabulary
            self.committed = ""
            self.currentSegment = ""
            self.consecutiveErrorRestarts = 0
            self.finishSignal = nil
            self.file = audioFile
            self.active = true
        }

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            // Snapshot the live request/file under the lock so a segment swap on
            // `stateQueue` can never race this append.
            let (request, file) = self.stateQueue.sync { (self.request, self.file) }
            request?.append(buffer)
            try? file?.write(from: buffer)
            let lvl = Self.rms(buffer)
            DispatchQueue.main.async { self.level = lvl }
        }

        audioEngine.prepare()
        try audioEngine.start()

        transcript = ""
        failure = nil
        startedAt = Date()
        isRunning = true

        stateQueue.sync { startRecognitionSegmentLocked() }
    }

    /// (Re)start a recognition request over the live audio engine. Called once at start and
    /// again every time a segment finalizes on a pause, so dictation continues across pauses
    /// instead of stopping — the audio tap keeps feeding whatever `self.request` currently is.
    /// Must run on `stateQueue`.
    private func startRecognitionSegmentLocked() {
        guard let recognizer, active else { return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = requireOnDevice   // on = "audio never leaves"
        if !vocabulary.isEmpty { request.contextualStrings = vocabulary }

        // Retire the previous segment before swapping in the new one; its trailing callback
        // (cancellation error) is dropped by the identity guard in handleRecognitionLocked.
        task?.cancel()
        self.request = request
        currentSegment = ""

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            self.stateQueue.async {
                self.handleRecognitionLocked(for: request, result: result, error: error)
            }
        }
    }

    /// Recognition callback body — runs on `stateQueue`.
    private func handleRecognitionLocked(for request: SFSpeechAudioBufferRecognitionRequest,
                                         result: SFSpeechRecognitionResult?,
                                         error: Error?) {
        // A finished/cancelled segment still fires one trailing callback (usually an error).
        // Only the segment that currently owns `self.request` may mutate state — otherwise a
        // stale callback would restart a second, orphaned task alongside the live one.
        guard self.request === request else { return }

        if let result {
            consecutiveErrorRestarts = 0
            currentSegment = result.bestTranscription.formattedString
            // Live view = everything committed so far + this in-progress segment.
            let live = Self.join(committed, currentSegment)
            DispatchQueue.main.async { self.transcript = live }

            if result.isFinal {
                // Pause detected: bank this segment and open a fresh one so the next
                // words append instead of replacing what came before.
                committed = live
                currentSegment = ""
                if let signal = finishSignal {
                    // finish() is waiting on the tail — it's banked now, let it proceed.
                    finishSignal = nil
                    signal.signal()
                } else if active {
                    startRecognitionSegmentLocked()
                }
                return
            }
        }

        if error != nil {
            if let signal = finishSignal {
                // The tail segment ended in an error (common at endAudio); whatever partial
                // text we captured in `currentSegment` is the best we'll get — release finish().
                finishSignal = nil
                signal.signal()
                return
            }
            // On-device recognition often reports the end-of-segment as an error right after
            // it finalizes. While we're still recording, treat that as a segment boundary and
            // keep going — but cap back-to-back failures so a broken recognizer (asset gone,
            // service wedged) doesn't turn this into a hot restart loop.
            guard active else { return }
            if consecutiveErrorRestarts < Self.maxConsecutiveErrorRestarts {
                consecutiveErrorRestarts += 1
                startRecognitionSegmentLocked()
            } else {
                teardownStateLocked()
                DispatchQueue.main.async {
                    self.stopEngineOnMain()
                    self.failure = "Dictation stopped unexpectedly — please try again."
                }
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
    /// Waits briefly for the recognizer to flush the tail of the last segment, so the final
    /// words spoken right before stop aren't dropped.
    @MainActor
    func finish() async -> (text: String, clip: AudioClip?) {
        let duration = startedAt.map { Date().timeIntervalSince($0) } ?? 0

        // 1. Stop capturing first (engine is main-confined; tap removed before endAudio so
        //    no buffer arrives after the request is closed).
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)

        let semaphore = DispatchSemaphore(value: 0)
        stateQueue.sync {
            if active, task != nil {
                finishSignal = semaphore
                request?.endAudio()
            } else {
                semaphore.signal()   // nothing in flight — don't wait
            }
        }

        // 2. Give the recognizer up to ~1s to deliver the segment's final result; if it never
        //    fires we fall through and use whatever partial we already have.
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.global(qos: .userInitiated).async {
                _ = semaphore.wait(timeout: .now() + 1.0)
                continuation.resume()
            }
        }

        // 3. Read the final text from callback-side state (not the possibly-stale @Published
        //    transcript) and tear down.
        let text: String = stateQueue.sync {
            finishSignal = nil
            let final = Self.join(committed, currentSegment)
            teardownStateLocked()
            return final
        }
        stopEngineOnMain()

        var clip: AudioClip?
        if let url = fileURL, let data = try? Data(contentsOf: url) {
            clip = AudioClip(data: data, filename: url.lastPathComponent, duration: duration)
            try? FileManager.default.removeItem(at: url)
        }
        fileURL = nil
        return (text, clip)
    }

    @MainActor
    func cancel() {
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        stateQueue.sync { teardownStateLocked() }
        stopEngineOnMain()
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
        fileURL = nil
        transcript = ""
    }

    /// Drop all recognition state. Must run on `stateQueue`. Never touches the audio engine
    /// (main-confined) — callers pair this with `stopEngineOnMain()`.
    private func teardownStateLocked() {
        active = false
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        file = nil
        committed = ""
        currentSegment = ""
        consecutiveErrorRestarts = 0
        if let signal = finishSignal { finishSignal = nil; signal.signal() }
    }

    /// Engine + session + UI-state teardown. Must run on main.
    private func stopEngineOnMain() {
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        isRunning = false
        level = 0
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
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
