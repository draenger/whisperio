#if os(macOS)
import Foundation
import AppKit
import AVFoundation
import UserNotifications
import WhisperioKit

// Native port of desktop/src/main/dictation/hotkeyManager.ts's activate()/activateAndSend()/
// activateCommand()/handleResult()/cancel() state machine, driving the shared `LiveDictation`
// engine (mobile/WhisperioApp/Sources/WhisperioApp/Engine/LiveDictation.swift — the same
// mic→text path `RecordingView.swift` uses) instead of an Electron renderer round-trip, and
// `MacAutoPaste` instead of AppleScript "System Events" keystrokes.
//
// State is tracked locally (`SessionState`) rather than reusing `OverlayPhase` 1:1, because this
// class also needs to remember WHICH `MacHotkeyAction` started the session (to implement
// hotkeyManager.ts's "same hotkey toggles, a different one while busy is ignored" rule) — the
// overlay only cares about the phase for rendering.
@MainActor
final class MacDictationSession: ObservableObject {
    static let shared = MacDictationSession()

    private enum SessionState: Equatable {
        case idle
        case recording(MacHotkeyAction)
        case transcribing
        case pasting
    }

    private var state: SessionState = .idle
    /// Monotonic id guarding stale completions — mirrors hotkeyManager.ts's `currentSessionId`.
    /// Incremented on every start AND every cancel/force-reset/timeout so a transcription that
    /// resolves after the user gave up is dropped instead of auto-pasted into the wrong app.
    private var sessionId = 0

    private let live = LiveDictation()
    private lazy var settings = SettingsStore()
    // System-output capture used only by `.outputRecording` — mirrors hotkeyManager.ts's
    // activateOutput(), a mic-free sibling of `live` that records what's PLAYING instead.
    private let outputCapture = MacSystemAudioCapture()
    private var outputCaptureStart: Date?

    private var escapeMonitorGlobal: Any?
    private var escapeMonitorLocal: Any?
    private var transcribeTimeoutTask: Task<Void, Never>?
    private var elapsedTimer: Timer?

    private init() {}

    // MARK: - Hotkey entry point

    /// Called by `HotkeyCenter.shared.handler`. Mirrors hotkeyManager.ts's activate()/
    /// activateAndSend()/activateCommand(): first tap of an action starts a session in idle;
    /// the SAME action tapped again while recording stops it; any other action pressed while
    /// busy is ignored (Electron's per-hotkey activate() functions only ever react to their own
    /// hotkey — there is no cross-hotkey stop).
    func handle(_ action: MacHotkeyAction) {
        switch state {
        case .idle:
            Task { await start(action) }
        case .recording(let active) where active == action:
            Task { await stopAndFinish() }
        case .recording, .transcribing, .pasting:
            // A different hotkey (or the same one during transcribing/pasting) — ignored,
            // matching the "only the toggle of the same mode stops" contract above.
            break
        }
    }

    /// Esc — mirrors hotkeyManager.ts's `cancel()`: invalidate the session, drop the in-flight
    /// transcript, hide the overlay, go back to idle.
    func cancel() {
        guard state != .idle else { return }
        invalidateSession()
        state = .idle
        removeEscapeMonitors()
        stopElapsedTimer()
        live.cancel()
        Task { await outputCapture.cancel() }
        outputCaptureStart = nil
        OverlayController.shared.hide()
    }

    // MARK: - Start / stop

    private func start(_ action: MacHotkeyAction) async {
        if action == .outputRecording {
            await startOutputRecording()
            return
        }

        // Mic permission — mirrors RecordingView's gate before LiveDictation.start(); requested
        // explicitly here since there's no view lifecycle to lean on.
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .audio)
        }
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            NSSound.beep()
            return
        }

        sessionId += 1
        let mySession = sessionId
        state = .recording(action)

        let overlay = OverlayModel.shared
        overlay.mode = overlayMode(for: action)
        overlay.phase = .armed
        overlay.elapsed = 0
        overlay.stopHint = HotkeyCenter.shared.combo(for: action)?.display ?? ""
        overlay.onDevice = isOnDevicePrimary
        OverlayController.shared.show()
        installEscapeMonitors()

        let s = settings.settings
        do {
            try live.start(language: s.language, vocabulary: [], requireOnDevice: !s.appleAllowOnline)
        } catch {
            handleFailure(mySession)
            return
        }
        guard mySession == sessionId else { return }
        overlay.phase = .recording
        startElapsedTimer()
    }

    // MARK: - Output recording (system audio, mirrors hotkeyManager.ts's activateOutput())

    /// Screen Recording (the TCC bucket ScreenCaptureKit audio capture needs) typically only
    /// takes effect after the app is relaunched the first time it's granted — unlike mic/
    /// Accessibility, there's no "prompt then immediately proceed" path here, so a still-denied
    /// result after requesting just tells the user to restart Whisperio instead of retrying.
    private func startOutputRecording() async {
        if !MacSystemAudioCapture.hasPermission() {
            _ = MacSystemAudioCapture.requestPermission()
            guard MacSystemAudioCapture.hasPermission() else {
                NSSound.beep()
                await notifyScreenRecordingNeeded()
                return
            }
        }

        sessionId += 1
        let mySession = sessionId
        state = .recording(.outputRecording)

        let overlay = OverlayModel.shared
        overlay.mode = .outputRecording
        overlay.phase = .armed
        overlay.elapsed = 0
        overlay.stopHint = HotkeyCenter.shared.combo(for: .outputRecording)?.display ?? ""
        overlay.onDevice = false
        OverlayController.shared.show()
        installEscapeMonitors()

        do {
            try await outputCapture.start()
        } catch {
            handleFailure(mySession)
            return
        }
        guard mySession == sessionId else { return }
        outputCaptureStart = Date()
        overlay.phase = .recording
        startElapsedTimer()
    }

    private func notifyScreenRecordingNeeded() async {
        let center = UNUserNotificationCenter.current()
        _ = try? await center.requestAuthorization(options: [.alert])
        let content = UNMutableNotificationContent()
        content.title = "Whisperio"
        content.body = "Grant Screen Recording permission to capture system audio, then restart " +
            "Whisperio — macOS only applies this permission after a relaunch."
        let request = UNNotificationRequest(identifier: "whisperio.systemaudio.permission",
                                            content: content, trigger: nil)
        try? await center.add(request)
    }

    private func stopAndFinish() async {
        let mySession = sessionId
        let action: MacHotkeyAction
        if case .recording(let a) = state { action = a } else { return }

        if action == .outputRecording {
            await stopOutputRecordingAndFinish(session: mySession)
            return
        }

        state = .transcribing
        removeEscapeMonitors()
        stopElapsedTimer()
        OverlayModel.shared.phase = .transcribing
        startTranscribeTimeout(for: mySession)

        let (text, _) = await live.finish()
        transcribeTimeoutTask?.cancel()
        guard mySession == sessionId else { return } // stale — cancelled/timed out already

        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            await finishSession(mySession, showDone: false)
            return
        }

        if action == .command {
            await runCommand(instruction: trimmed, session: mySession)
        } else {
            await pasteAndFinish(text: trimmed, thenEnter: action == .dictateAndSend, session: mySession)
        }
    }

    /// Stops the system-audio capture, transcribes the recorded file through the settings'
    /// configured provider chain (same `AudioClip` + `ProviderChain.transcribe` API DetailView's
    /// retranscribe uses — mobile/WhisperioApp/Sources/WhisperioApp/DetailView.swift:283-294),
    /// and auto-pastes the result like normal dictation.
    private func stopOutputRecordingAndFinish(session: Int) async {
        state = .transcribing
        removeEscapeMonitors()
        stopElapsedTimer()
        OverlayModel.shared.phase = .transcribing
        startTranscribeTimeout(for: session)

        let duration = outputCaptureStart.map { Date().timeIntervalSince($0) } ?? 0
        outputCaptureStart = nil
        let url = await outputCapture.stop()
        transcribeTimeoutTask?.cancel()
        guard session == sessionId else { return } // stale — cancelled/timed out already

        defer { if let url { try? FileManager.default.removeItem(at: url) } }

        guard let url, let data = try? Data(contentsOf: url) else {
            await finishSession(session, showDone: false)
            return
        }

        let clip = AudioClip(data: data, filename: url.lastPathComponent, duration: duration)
        let chain = settings.makeChain()
        switch await chain.transcribe(clip) {
        case .success(let transcript):
            guard session == sessionId else { return }
            let trimmed = transcript.text.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                await finishSession(session, showDone: false)
            } else {
                await pasteAndFinish(text: trimmed, thenEnter: false, session: session)
            }
        case .failure:
            guard session == sessionId else { return }
            NSSound.beep()
            await finishSession(session, showDone: false)
        }
    }

    private func pasteAndFinish(text: String, thenEnter: Bool, session: Int) async {
        state = .pasting
        OverlayModel.shared.phase = .pasting
        _ = await MacAutoPaste.paste(text, thenEnter: thenEnter)
        guard session == sessionId else { return }
        await finishSession(session, showDone: true)
    }

    // MARK: - Command mode (mirrors hotkeyManager.ts's handleCommandResult)

    /// Applies the spoken instruction to the current CLIPBOARD text via the settings' chat LLM
    /// and pastes the rewritten result — never the spoken instruction itself. Paraphrases
    /// desktop/src/main/llm/prompts.ts's COMMAND_SYSTEM_PROMPT + buildCommandMessages.
    private func runCommand(instruction: String, session: Int) async {
        state = .pasting
        OverlayModel.shared.phase = .pasting

        guard let clipboardText = NSPasteboard.general.string(forType: .string),
              !clipboardText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            // Nothing to rewrite — mirrors handleCommandResult's empty-clipboard branch: no
            // paste, just settle back to idle.
            await finishSession(session, showDone: false)
            return
        }

        let client = settings.makeChatClient()
        guard client.isConfigured else {
            NSSound.beep()
            await finishSession(session, showDone: false)
            return
        }

        do {
            let systemPrompt = "You are a text-editing assistant. Apply the user's instruction to the given " +
                "text and return ONLY the resulting text — no commentary, no quotes, no preamble. Preserve " +
                "the original language unless the instruction explicitly asks to translate. Never add, " +
                "invent, or drop content the instruction did not ask you to change."
            let userPrompt = "Instruction: \(instruction)\n\nText:\n\(clipboardText)"
            let messages = [ChatMessage(role: "system", content: systemPrompt),
                            ChatMessage(role: "user", content: userPrompt)]
            let rewritten = try await client.complete(messages: messages, model: settings.settings.chatModel, temperature: 0)
            guard session == sessionId else { return }
            let result = rewritten.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !result.isEmpty else {
                NSSound.beep()
                await finishSession(session, showDone: false)
                return
            }
            _ = await MacAutoPaste.paste(result, thenEnter: false)
            guard session == sessionId else { return }
            await finishSession(session, showDone: true)
        } catch {
            // Never paste the untouched clipboard or the spoken words on failure — fail soft,
            // same discipline as rewriteClipboardForCommand's NotConfiguredError handling.
            NSSound.beep()
            await finishSession(session, showDone: false)
        }
    }

    // MARK: - Completion / teardown

    private func finishSession(_ session: Int, showDone: Bool) async {
        guard session == sessionId else { return }
        if showDone {
            OverlayModel.shared.phase = .done
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard session == sessionId else { return }
        }
        state = .idle
        OverlayController.shared.hide()
    }

    private func handleFailure(_ session: Int) {
        guard session == sessionId else { return }
        invalidateSession()
        state = .idle
        removeEscapeMonitors()
        stopElapsedTimer()
        outputCaptureStart = nil
        Task { await outputCapture.cancel() }
        OverlayController.shared.hide()
        NSSound.beep()
    }

    private func invalidateSession() {
        sessionId += 1
    }

    // MARK: - Safety timeout (mirrors hotkeyManager.ts's 60s TRANSCRIBE_TIMEOUT_MS)

    private func startTranscribeTimeout(for session: Int) {
        transcribeTimeoutTask?.cancel()
        transcribeTimeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 60_000_000_000)
            guard !Task.isCancelled, let self else { return }
            await MainActor.run {
                guard self.sessionId == session else { return }
                self.invalidateSession()
                self.state = .idle
                self.removeEscapeMonitors()
                self.stopElapsedTimer()
                OverlayController.shared.hide()
            }
        }
    }

    // MARK: - Elapsed ticker

    private func startElapsedTimer() {
        stopElapsedTimer()
        elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                OverlayModel.shared.elapsed += 1
                _ = self
            }
        }
    }

    private func stopElapsedTimer() {
        elapsedTimer?.invalidate()
        elapsedTimer = nil
    }

    // MARK: - Escape-to-cancel (mirrors hotkeyManager.ts registering Escape only while active)

    private func installEscapeMonitors() {
        guard escapeMonitorGlobal == nil else { return }
        escapeMonitorGlobal = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 53 else { return } // 53 = Escape
            Task { @MainActor in self?.cancel() }
        }
        escapeMonitorLocal = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 53 else { return event }
            Task { @MainActor in self?.cancel() }
            return nil
        }
    }

    private func removeEscapeMonitors() {
        if let m = escapeMonitorGlobal { NSEvent.removeMonitor(m); escapeMonitorGlobal = nil }
        if let m = escapeMonitorLocal { NSEvent.removeMonitor(m); escapeMonitorLocal = nil }
    }

    // MARK: - Helpers

    private func overlayMode(for action: MacHotkeyAction) -> OverlayMode {
        switch action {
        case .dictation: return .dictation
        case .dictateAndSend: return .dictateAndSend
        case .command: return .command
        case .outputRecording: return .outputRecording
        }
    }

    /// Feeds `OverlayModel.onDevice` — true when the configured primary transcription provider
    /// never leaves the device (Apple Speech or local WhisperKit), mirroring
    /// `SettingsStore`'s own `primary == .onDevice || primary == .localWhisper` check
    /// (Engine/SettingsStore.swift:90-91, RecordingView.swift:86-87).
    private var isOnDevicePrimary: Bool {
        let primary = settings.settings.providerChain.first ?? .onDevice
        return primary == .onDevice || primary == .localWhisper
    }
}
#endif
