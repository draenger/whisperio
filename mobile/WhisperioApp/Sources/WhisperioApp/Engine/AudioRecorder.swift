import Foundation
import AVFoundation
import Speech
import Combine
import WhisperioKit

// Records mic audio to an .m4a file and hands back an AudioClip for the provider chain.
@MainActor
final class AudioRecorder: NSObject, ObservableObject {
    @Published var isRecording = false
    @Published var isPaused = false
    @Published var level: CGFloat = 0          // 0…1, for the live waveform

    private var recorder: AVAudioRecorder?
    private var fileURL: URL?
    private var startedAt: Date?
    private var meterTimer: Timer?
    // Active (non-paused) recording time, accumulated across pause/resume cycles — the
    // wall clock overstates duration once pause exists, and AVAudioRecorder.currentTime
    // isn't reliable while paused.
    private var accumulatedActive: TimeInterval = 0
    private var lastResumeAt: Date?

    // Ask for mic (+ speech, used by the on-device engine) permissions up front.
    func requestPermissions() async -> Bool {
        #if os(iOS)
        let mic = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            AVAudioApplication.requestRecordPermission { c.resume(returning: $0) }
        }
        #else
        // macOS has no AVAudioApplication permission API — the mic gate is AVCaptureDevice's TCC.
        let mic = await AVCaptureDevice.requestAccess(for: .audio)
        #endif
        _ = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) }
        }
        return mic
    }

    func start() throws {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.duckOthers, .defaultToSpeaker])
        try session.setActive(true)
        #endif

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("whisperio-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]
        let rec = try AVAudioRecorder(url: url, settings: settings)
        rec.isMeteringEnabled = true
        guard rec.record() else {
            #if os(iOS)
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            #endif
            throw NSError(domain: "Whisperio.Recorder", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Couldn't start recording. Check the microphone isn't in use."])
        }

        recorder = rec
        fileURL = url
        startedAt = Date()
        accumulatedActive = 0
        lastResumeAt = Date()
        isRecording = true
        isPaused = false

        meterTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.updateLevel() }
        }
    }

    private func updateLevel() {
        guard let rec = recorder, rec.isRecording else { return }
        rec.updateMeters()
        let power = rec.averagePower(forChannel: 0)          // dBFS, ~ -60…0
        let norm = max(0, (power + 55) / 55)                  // → 0…1
        level = CGFloat(min(1, norm))
    }

    /// Pause capture without ending the file — `resume()` continues appending to the same
    /// recording (Conversation mode). No-op unless actively recording.
    func pause() {
        guard let rec = recorder, isRecording, !isPaused else { return }
        if let resumedAt = lastResumeAt {
            accumulatedActive += Date().timeIntervalSince(resumedAt)
        }
        lastResumeAt = nil
        rec.pause()
        isPaused = true
        level = 0
    }

    /// Resume a paused recording. No-op unless paused.
    func resume() {
        guard let rec = recorder, isRecording, isPaused else { return }
        guard rec.record() else { return }   // keep paused state if the session was lost
        lastResumeAt = Date()
        isPaused = false
    }

    // Stops recording and returns the captured clip (nil if nothing was recorded).
    func stop() -> AudioClip? {
        meterTimer?.invalidate(); meterTimer = nil
        guard let rec = recorder, let url = fileURL else { isRecording = false; return nil }
        var duration = accumulatedActive
        if let resumedAt = lastResumeAt { duration += Date().timeIntervalSince(resumedAt) }
        if duration <= 0 { duration = startedAt.map { Date().timeIntervalSince($0) } ?? rec.currentTime }
        rec.stop()
        recorder = nil
        isRecording = false
        isPaused = false
        level = 0
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif

        let clip = (try? Data(contentsOf: url)).map {
            AudioClip(data: $0, filename: url.lastPathComponent, duration: duration)
        }
        // Deliberately NOT deleted here: keptFilename()/keptName() decide the file's fate
        // right after transcription — AudioStore.persist moves it to durable storage when
        // "Keep audio recordings" is on, AudioStore.delete removes it otherwise. Deleting
        // eagerly here made persist() a silent no-op, which is why kept audio never saved.
        return clip
    }

    func cancel() {
        meterTimer?.invalidate(); meterTimer = nil
        recorder?.stop()
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
        recorder = nil
        isRecording = false
        isPaused = false
        level = 0
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }
}
