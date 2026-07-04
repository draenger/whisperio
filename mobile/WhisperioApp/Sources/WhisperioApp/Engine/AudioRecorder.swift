import Foundation
import AVFoundation
import Speech
import Combine
import WhisperioKit

// Records mic audio to an .m4a file and hands back an AudioClip for the provider chain.
@MainActor
final class AudioRecorder: NSObject, ObservableObject {
    @Published var isRecording = false
    @Published var level: CGFloat = 0          // 0…1, for the live waveform

    private var recorder: AVAudioRecorder?
    private var fileURL: URL?
    private var startedAt: Date?
    private var meterTimer: Timer?

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
        isRecording = true

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

    // Stops recording and returns the captured clip (nil if nothing was recorded).
    func stop() -> AudioClip? {
        meterTimer?.invalidate(); meterTimer = nil
        guard let rec = recorder, let url = fileURL else { isRecording = false; return nil }
        let duration = startedAt.map { Date().timeIntervalSince($0) } ?? rec.currentTime
        rec.stop()
        recorder = nil
        isRecording = false
        level = 0
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif

        let clip = (try? Data(contentsOf: url)).map {
            AudioClip(data: $0, filename: url.lastPathComponent, duration: duration)
        }
        try? FileManager.default.removeItem(at: url)   // don't leave temp .m4a files behind
        return clip
    }

    func cancel() {
        meterTimer?.invalidate(); meterTimer = nil
        recorder?.stop()
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
        recorder = nil
        isRecording = false
        level = 0
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }
}
