#if os(macOS)
import Foundation
import AVFoundation
@preconcurrency import Speech
import Combine
import CoreGraphics
import WhisperioKit

/// macOS microphone capture + on-device streaming speech recognition.
///
/// There is NO `AVAudioSession` on macOS — an `AVAudioEngine` input tap feeds both an
/// `SFSpeechRecognizer` (running transcript, on-device when the locale supports it) and a `.caf`
/// file, so the captured clip is still available for saving. Mic permission is requested via
/// `AVCaptureDevice.requestAccess(for: .audio)` (macOS's TCC gate); speech authorization via
/// `SFSpeechRecognizer.requestAuthorization`.
///
/// Threading mirrors the iOS `LiveDictation`: the mic tap fires on the audio thread and Speech
/// callbacks arrive on an arbitrary queue, so all recognition state is confined to a private
/// serial `stateQueue`. The `AVAudioEngine` (and `fileURL`) stays main-confined —
/// `start()`/`finish()`/`cancel()` are `@MainActor`. Every `@Published` mutation hops to main.
final class MacAudioRecorder: ObservableObject, @unchecked Sendable {
    @Published private(set) var transcript: String = ""
    @Published private(set) var level: CGFloat = 0
    @Published private(set) var isRunning = false
    /// Non-nil once dictation dies mid-session (repeated recognizer errors). The controller
    /// observes this to leave the listening state instead of spinning forever.
    @Published private(set) var failure: String?

    private let audioEngine = AVAudioEngine()
    private var fileURL: URL?
    private var startedAt: Date?

    /// Serial queue guarding all recognition state below.
    private let stateQueue = DispatchQueue(label: "ai.whisperio.mac.dictation")

    // MARK: state confined to `stateQueue`
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var file: AVAudioFile?
    private var requireOnDevice = true
    private var active = false
    private var committed = ""
    private var currentSegment = ""
    private var consecutiveErrorRestarts = 0
    private static let maxConsecutiveErrorRestarts = 3
    private var finishSignal: DispatchSemaphore?

    // MARK: - Permissions

    /// Ask for mic (AVCaptureDevice) + speech-recognition authorization up front. Returns whether
    /// mic access was granted — dictation is impossible without it.
    @MainActor
    func requestPermissions() async -> Bool {
        let mic = await AVCaptureDevice.requestAccess(for: .audio)
        _ = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) }
        }
        return mic
    }

    static func localeFor(_ language: String) -> Locale {
        (language == "auto" || language.isEmpty) ? .current : Locale(identifier: language)
    }

    // MARK: - Lifecycle

    /// Begin streaming dictation. `transcript` then updates live until `finish()`/`cancel()`.
    /// Prefers on-device recognition where the locale supports it, otherwise falls back to
    /// Apple's streaming recognizer (still partial-result capable).
    @MainActor
    func start(language: String) throws {
        let recognizer = SFSpeechRecognizer(locale: Self.localeFor(language))
        guard let recognizer, recognizer.isAvailable else {
            throw err("Dictation isn't available for \(Self.localeFor(language).identifier).")
        }
        let onDevice = recognizer.supportsOnDeviceRecognition

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)

        // Persist audio alongside recognition so a saved recording still has its clip.
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("whisperio-\(UUID().uuidString).caf")
        let audioFile = try AVAudioFile(forWriting: url, settings: format.settings)
        fileURL = url

        stateQueue.sync {
            self.recognizer = recognizer
            self.requireOnDevice = onDevice
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

    /// (Re)start a recognition request over the live audio engine. Called once at start and again
    /// each time a segment finalizes on a pause, so dictation continues across pauses. Must run
    /// on `stateQueue`.
    private func startRecognitionSegmentLocked() {
        guard let recognizer, active else { return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = requireOnDevice

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
        // Only the segment that currently owns `self.request` may mutate state — a stale
        // trailing callback from a retired task is dropped here.
        guard self.request === request else { return }

        if let result {
            consecutiveErrorRestarts = 0
            currentSegment = result.bestTranscription.formattedString
            let live = Self.join(committed, currentSegment)
            DispatchQueue.main.async { self.transcript = live }

            if result.isFinal {
                committed = live
                currentSegment = ""
                if let signal = finishSignal {
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
                finishSignal = nil
                signal.signal()
                return
            }
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

    /// Stop and hand back the final transcript + the captured clip (for saving). Waits briefly
    /// for the recognizer to flush the tail of the last segment.
    @MainActor
    func finish() async -> (text: String, clip: AudioClip?) {
        let duration = startedAt.map { Date().timeIntervalSince($0) } ?? 0

        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)

        let semaphore = DispatchSemaphore(value: 0)
        stateQueue.sync {
            if active, task != nil {
                finishSignal = semaphore
                request?.endAudio()
            } else {
                semaphore.signal()
            }
        }

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.global(qos: .userInitiated).async {
                _ = semaphore.wait(timeout: .now() + 1.0)
                continuation.resume()
            }
        }

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

    /// Drop all recognition state. Must run on `stateQueue`.
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

    /// Engine + UI-state teardown. Must run on main. No AVAudioSession on macOS.
    private func stopEngineOnMain() {
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        isRunning = false
        level = 0
    }

    private static func join(_ a: String, _ b: String) -> String {
        let head = a.trimmingCharacters(in: .whitespacesAndNewlines)
        let tail = b.trimmingCharacters(in: .whitespacesAndNewlines)
        if head.isEmpty { return tail }
        if tail.isEmpty { return head }
        return head + " " + tail
    }

    private static func rms(_ buffer: AVAudioPCMBuffer) -> CGFloat {
        guard let ch = buffer.floatChannelData?[0] else { return 0 }
        let n = Int(buffer.frameLength)
        guard n > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<n { let s = ch[i]; sum += s * s }
        return CGFloat(min(1, sqrtf(sum / Float(n)) * 6))
    }

    private func err(_ m: String) -> NSError {
        NSError(domain: "Whisperio.MacAudioRecorder", code: 1, userInfo: [NSLocalizedDescriptionKey: m])
    }
}

// MARK: - Dictation controller

/// Ties the hotkey → recorder → overlay → save flow together, driven by WhisperioKit's pure
/// `DictationStateMachine`. Owns the mac recorder and the floating overlay pill, and persists the
/// finished transcript into the shared `RecordingSyncStore` (the same journal the window + iPhone
/// read). On-device transcription has no cloud cleanup step, so the `cleaning` state passes
/// through instantly; the state machine is still walked in full for parity with the phone.
@available(macOS 14, *)
@MainActor
final class MacDictationController: ObservableObject {
    @Published private(set) var state: DictationState = .idle
    @Published private(set) var transcript: String = ""
    @Published private(set) var level: CGFloat = 0
    @Published private(set) var elapsed: TimeInterval = 0
    /// Transient user-facing status (permission denied, empty transcript, recognizer failure).
    @Published var statusMessage: String?

    private let recorder = MacAudioRecorder()
    private let store: RecordingSyncStore
    private let overlay = DictationOverlayController()
    private var cancellables = Set<AnyCancellable>()
    private var timer: Timer?
    private var startedAt: Date?

    init(store: RecordingSyncStore) {
        self.store = store
        recorder.$transcript
            .receive(on: RunLoop.main)
            .sink { [weak self] in self?.transcript = $0 }
            .store(in: &cancellables)
        recorder.$level
            .receive(on: RunLoop.main)
            .sink { [weak self] in self?.level = $0 }
            .store(in: &cancellables)
        recorder.$failure
            .receive(on: RunLoop.main)
            .sink { [weak self] failure in if let failure { self?.fail(failure) } }
            .store(in: &cancellables)
        overlay.attach(self)
    }

    /// Hotkey / tray entry point: start when idle, stop when recording, ignore mid-transition.
    func toggle() {
        switch state {
        case .idle:      start()
        case .recording: stop()
        default:         break
        }
    }

    func start() {
        guard state == .idle else { return }
        statusMessage = nil
        Task { @MainActor in
            let granted = await recorder.requestPermissions()
            guard granted else {
                statusMessage = "Microphone access is denied. Enable it in System Settings › Privacy."
                return
            }
            do {
                try recorder.start(language: "auto")
            } catch {
                statusMessage = error.localizedDescription
                return
            }
            transition(.startRecording)
            startedAt = Date()
            elapsed = 0
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self, let started = self.startedAt else { return }
                    self.elapsed = Date().timeIntervalSince(started)
                }
            }
            overlay.show()
        }
    }

    func stop() {
        guard state == .recording else { return }
        transition(.stopRecording)          // recording → transcribing
        timer?.invalidate(); timer = nil
        Task { @MainActor in
            let (text, clip) = await recorder.finish()
            transition(.transcribed)        // transcribing → cleaning
            transition(.cleaned)            // cleaning → output (no cloud cleanup on-device)
            save(text: text, clip: clip)
            transition(.delivered)          // output → idle
            overlay.hide()
        }
    }

    func cancel() {
        timer?.invalidate(); timer = nil
        recorder.cancel()
        transition(.cancel)
        overlay.hide()
    }

    private func fail(_ message: String) {
        timer?.invalidate(); timer = nil
        statusMessage = message
        transition(.fail)
        overlay.hide()
    }

    private func save(text: String, clip: AudioClip?) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            statusMessage = "Nothing was transcribed."
            return
        }
        let recording = Recording(
            filename: clip?.filename ?? "dictation-\(UUID().uuidString).caf",
            timestamp: Date(),
            duration: clip?.duration ?? elapsed,
            status: .completed,
            provider: .onDevice,
            transcription: trimmed
        )
        store.add(recording)

        // Deliver the transcript to wherever the user was typing. Always lands on the pasteboard;
        // auto-pastes into the focused app when enabled + Accessibility-trusted (AutoPaste.deliver).
        switch AutoPaste.deliver(trimmed) {
        case .pasted:
            break
        case .copiedOnly:
            statusMessage = "Copied to clipboard — press ⌘V to paste."
        case .needsAccessibility:
            statusMessage = "Copied to clipboard. Enable Whisperio in System Settings › Privacy & Security › Accessibility to paste automatically."
        }
    }

    private func transition(_ event: DictationEvent) {
        state = nextDictationState(state, on: event)
    }
}
#endif
