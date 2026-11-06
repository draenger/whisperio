import Foundation
import AVFoundation
import WhisperioKit

/// Keeps a real microphone input active for an explicitly started keyboard session.
/// Idle buffers are discarded. Only a requested fragment is written to disk.
@MainActor
final class SessionAudioCapture {
    private let engine = AVAudioEngine()
    private let sink = SessionAudioSink()
    private var fileURL: URL?
    private var startedAt: Date?

    func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.mixWithOthers, .defaultToSpeaker])
        try session.setActive(true)
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        let sink = self.sink
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            sink.append(buffer)
        }
        do {
            engine.prepare()
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            throw error
        }
    }

    func beginFragment() throws {
        let format = engine.inputNode.outputFormat(forBus: 0)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("whisperio-session-\(UUID().uuidString).caf")
        let newFile = try AVAudioFile(forWriting: url, settings: format.settings)
        FileProtection.apply(.liveRecording, to: url)
        sink.file = newFile
        fileURL = url
        startedAt = Date()
    }

    func endFragment() -> AudioClip? {
        sink.file = nil
        guard let url = fileURL else { return nil }
        defer { try? FileManager.default.removeItem(at: url); fileURL = nil; startedAt = nil }
        guard let data = try? Data(contentsOf: url) else { return nil }
        return AudioClip(data: data, filename: url.lastPathComponent,
                         duration: startedAt.map { Date().timeIntervalSince($0) } ?? 0)
    }

    func cancelFragment() {
        sink.file = nil
        if let fileURL { try? FileManager.default.removeItem(at: fileURL) }
        fileURL = nil
        startedAt = nil
    }

    func stop() {
        cancelFragment()
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

private final class SessionAudioSink: @unchecked Sendable {
    private let lock = NSLock()
    private var storedFile: AVAudioFile?
    var file: AVAudioFile? {
        get { lock.lock(); defer { lock.unlock() }; return storedFile }
        set { lock.lock(); storedFile = newValue; lock.unlock() }
    }
    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        try? storedFile?.write(from: buffer)
        lock.unlock()
    }
}
