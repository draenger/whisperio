import Foundation
import AVFoundation
import Combine
import Speech
import WhisperioKit

@MainActor
final class KeyboardDictationSessionCoordinator: ObservableObject {
    @Published private(set) var snapshot: KeyboardSessionSnapshot?
    @Published private(set) var startError: String?
    private let capture = SessionAudioCapture()
    private var observer: KeyboardSessionObserver?
    private var timer: Timer?
    private var generation = UUID()
    private var lastAction = Date()
    private var fragmentStartedAt: Date?
    private var transcribingTask: Task<Void, Never>?
    private var settings: SettingsStore?
    private var processedCommands = Set<UUID>()
    private var audioObservers: [AnyCancellable] = []

    init() {
        observer = KeyboardSessionObserver(names: [KeyboardSessionStore.commandNotification]) { [weak self] in
            Task { @MainActor in self?.processCommands() }
        }
        NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)
            .sink { [weak self] note in
                guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                      raw == AVAudioSession.InterruptionType.began.rawValue else { return }
                Task { @MainActor in self?.end() }
            }
            .store(in: &audioObservers)
        NotificationCenter.default.publisher(for: AVAudioSession.mediaServicesWereResetNotification)
            .sink { [weak self] _ in Task { @MainActor in self?.end() } }
            .store(in: &audioObservers)
    }

    func start(settings: SettingsStore) async {
        guard snapshot == nil else { return }
        startError = nil
        self.settings = settings
        let granted = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
        }
        guard granted else {
            startError = "Microphone access is required. Enable it in iOS Settings."
            return
        }
        if (settings.settings.providerChain.first ?? .onDevice) == .onDevice {
            let speech = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
                SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
            }
            guard speech else {
                startError = "Speech Recognition access is required for the selected on-device engine."
                return
            }
        }
        do {
            try capture.start()
            let now = Date()
            KeyboardSessionStore.purgeExpiredResults(at: now)
            processedCommands.removeAll()
            lastAction = now
            snapshot = KeyboardSessionSnapshot(sessionID: UUID(), phase: .sessionActive,
                heartbeatAt: now, expiresAt: now.addingTimeInterval(Double(KeyboardSessionStore.idleTimeoutMinutes * 60)))
            guard let snapshot, KeyboardSessionStore.publish(snapshot) else {
                end()
                startError = "Shared keyboard data is unavailable. Check Full Access and App Group setup."
                return
            }
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.tick() }
            }
        } catch {
            capture.stop()
            startError = "Could not start the microphone session. Try again."
        }
    }

    func end() {
        generation = UUID()
        transcribingTask?.cancel()
        transcribingTask = nil
        timer?.invalidate()
        timer = nil
        capture.stop()
        if var snapshot {
            snapshot.phase = .idle
            snapshot.heartbeatAt = Date()
            snapshot.expiresAt = Date()
            self.snapshot = nil
            _ = KeyboardSessionStore.publish(snapshot)
        }
    }

    private func publish() {
        guard var snapshot else { return }
        snapshot.heartbeatAt = Date()
        snapshot.expiresAt = lastAction.addingTimeInterval(Double(KeyboardSessionStore.idleTimeoutMinutes * 60))
        self.snapshot = snapshot
        _ = KeyboardSessionStore.publish(snapshot)
    }

    private func tick() {
        guard let snapshot else { return }
        if Date().timeIntervalSince(lastAction) >= Double(KeyboardSessionStore.idleTimeoutMinutes * 60) ||
            (snapshot.phase == .recording && Date().timeIntervalSince(fragmentStartedAt ?? Date()) >= 60) {
            end()
            return
        }
        processCommands()
        publish()
    }

    private func processCommands() {
        for command in KeyboardSessionStore.drainCommands() {
            guard command.version == 1, let current = snapshot,
                  processedCommands.insert(command.id).inserted,
                  command.sessionID == current.sessionID,
                  abs(command.issuedAt.timeIntervalSinceNow) < 30,
                  let next = KeyboardSessionStateMachine.next(current.phase, action: command.action),
                  (command.action != .stopRecording && command.action != .ackResult || command.requestID == current.requestID) else { continue }
            if next == .idle { end(); continue }
            if command.action == .ackResult {
                KeyboardSessionStore.acknowledge(command.requestID)
                snapshot?.phase = .sessionActive
                snapshot?.requestID = nil
            } else if command.action == .startRecording {
                do {
                    try capture.beginFragment()
                    fragmentStartedAt = Date()
                    snapshot?.requestID = command.requestID
                    snapshot?.phase = .recording
                } catch {
                    snapshot?.phase = .error
                    snapshot?.error = "recordingFailed"
                }
            } else if command.action == .cancelRecording {
                capture.cancelFragment()
                fragmentStartedAt = nil
                snapshot?.phase = .sessionActive
                snapshot?.requestID = nil
            } else if command.action == .stopRecording {
                guard let clip = capture.endFragment(), clip.duration > 0.1, let settings else {
                    snapshot?.phase = .error
                    snapshot?.error = "emptyRecording"
                    publish()
                    continue
                }
                fragmentStartedAt = nil
                snapshot?.phase = .transcribing
                let run = generation
                let sessionID = current.sessionID
                let requestID = command.requestID
                transcribingTask = Task {
                    let result = await settings.makeChain().transcribe(clip)
                    guard !Task.isCancelled, generation == run, self.snapshot?.sessionID == sessionID else { return }
                    switch result {
                    case .success(let transcript):
                        let text = settings.cleanup(transcript.text)
                        self.snapshot?.phase = .done
                        self.publish()
                        if !KeyboardSessionStore.publish(KeyboardSessionResult(sessionID: sessionID,
                            requestID: requestID, text: text, provider: transcript.provider)) {
                            self.snapshot?.phase = .error
                            self.snapshot?.error = "resultUnavailable"
                        }
                    case .failure:
                        self.snapshot?.phase = .error
                        self.snapshot?.error = "transcriptionFailed"
                    }
                    self.publish()
                }
            }
            lastAction = Date()
            publish()
        }
    }
}
