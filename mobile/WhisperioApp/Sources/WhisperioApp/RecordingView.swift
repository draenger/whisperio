import SwiftUI
import Combine
import AVFoundation
import WhisperioKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// Live recording — real mic capture, then transcription through the configured
// provider chain (Apple on-device / OpenAI / ElevenLabs).
struct RecordingView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var recordings: RecordingsStore
    @StateObject private var recorder = AudioRecorder()
    @StateObject private var live = LiveDictation()

    var fromKeyboard: Bool = false
    var onCancel: () -> Void
    var onDone: (Recording) -> Void

    // Live partials run on the Apple Speech engine; gated by the user setting. On-device is
    // required unless the user allowed Apple online recognition.
    private var useLive: Bool {
        settings.settings.liveTranscriptionEnabled
            && (settings.settings.providerChain.first ?? .onDevice) == .onDevice
            && LiveDictation.isSupported(language: settings.settings.language,
                                         requireOnDevice: !settings.settings.appleAllowOnline)
    }

    @State private var phase: Phase = .starting
    @State private var secs = 0
    @State private var errorMsg = ""
    @State private var done = false   // guards against stop firing after cancel/stop
    @State private var startedLive = false   // which path begin() actually took
    @State private var resumeAfterInterruption = false
    @State private var interruptionDidEnd = false
    @State private var lastActivityAt: Date?

    private enum Phase { case starting, listening, processing, error }
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var clock: String { String(format: "%d:%02d", secs / 60, secs % 60) }

    private var engineLabel: String {
        switch settings.settings.providerChain.first {
        case .openAI: return "OpenAI · cloud"
        case .elevenLabs: return "ElevenLabs · cloud"
        case .groq: return "Groq · cloud"
        case .deepgram: return "Deepgram · cloud"
        case .assemblyAI: return "AssemblyAI · cloud"
        case .mistral: return "Mistral · cloud"
        default: return "Apple Speech · on-device"
        }
    }

    private var ghostPhase: ListeningGhost.Phase {
        switch phase {
        case .processing: return .note
        case .error: return .wtf
        default: return .listening
        }
    }

    private var statusLabel: String {
        switch phase {
        case .starting: return "Starting…"
        case .listening: return "Listening…"
        case .processing: return "Transcribing…"
        case .error: return "Couldn’t transcribe"
        }
    }

    var body: some View {
        ScreenScaffold(bg: t.bg2) {
            VStack(spacing: 0) {
                HStack {
                    EngineChip(label: phase == .processing ? "Transcribing…" : engineLabel,
                               icon: phase == .processing ? "spark" : "cpu")
                    Spacer()
                    Text(clock).font(WZFont.mono(15)).foregroundStyle(t.text).monospacedDigit()
                }
                .padding(.horizontal, 24).padding(.top, 18)

                VStack(alignment: .leading, spacing: 14) {
                    SectionLabel(text: statusLabel)
                    Text(mainText)
                        .font(WZFont.display(23, .medium))
                        .foregroundStyle(phase == .error ? t.red : (showingLive ? t.text : t.muted))
                        .lineSpacing(6).frame(minHeight: 140, alignment: .topLeading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .animation(.easeOut(duration: 0.15), value: live.transcript)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .padding(.horizontal, 24).padding(.top, 26)

                // The design's ListeningGhost: leans in and nods while you talk, scribbles
                // on its notepad while transcribing, startles ("?!") on an error.
                ListeningGhost(phase: ghostPhase, size: 96)
                    .padding(.bottom, 2)

                Group {
                    if phase == .listening {
                        Waveform(color: t.accent, bars: 34, height: 70)
                    } else if phase == .processing {
                        HStack(spacing: 10) {
                            ProgressView().tint(t.accent)
                            Text("Working…").font(WZFont.mono(13)).foregroundStyle(t.accentLite)
                        }.frame(height: 70)
                    } else {
                        Color.clear.frame(height: 70)
                    }
                }
                .padding(.bottom, 8)

                HStack(spacing: 30) {
                    circleButton(icon: "x", action: cancel)
                    Button(action: stop) {
                        WIcon("stop", size: 30).foregroundStyle(.white)
                            .frame(width: 84, height: 84)
                            .background(phase == .listening ? t.red : t.elevated, in: Circle())
                            .overlay(Circle().stroke(t.red.opacity(phase == .listening ? 0.16 : 0), lineWidth: 8))
                    }
                    .buttonStyle(.plain).disabled(phase != .listening)
                    if phase == .error {
                        circleButton(icon: "x", action: onCancel)
                    } else {
                        Color.clear.frame(width: 56, height: 56)
                    }
                }
                .padding(.top, 14).padding(.bottom, 42)
            }
        }
        .onReceive(tick) { _ in
            guard phase == .listening else { return }
            secs += 1
            noteActivityIfNeeded()
            checkAutoStopIfNeeded()
        }
        .onReceive(NotificationCenter.default.publisher(for: .whisperioStopDictation)) { _ in
            stop()   // triple-tap / "stop" shortcut ends recording + transcribes
        }
        .onReceive(live.$failure) { message in
            // Live dictation died mid-session (e.g. the recognizer kept erroring) — surface
            // it instead of leaving the screen stuck on "Listening…".
            if let message, startedLive, phase == .listening, !done {
                done = true
                phase = .error
                errorMsg = message
            }
        }
        #if canImport(UIKit)
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { note in
            handleInterruption(note)
        }
        #endif
        .task { await begin() }
    }

    private var hint: String {
        switch phase {
        case .listening: return "Speak now — tap stop when you’re done."
        case .processing: return "Turning your voice into text…"
        default: return ""
        }
    }

    // While live dictation is running we render the growing transcript itself; before the
    // first words (or on the file path) we fall back to the hint.
    private var showingLive: Bool { startedLive && phase == .listening && !live.transcript.isEmpty }
    private var mainText: String {
        if phase == .error { return errorMsg }
        if startedLive && phase == .listening { return live.transcript.isEmpty ? hint : live.transcript }
        return hint
    }

    private func circleButton(icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            WIcon(icon, size: 22, weight: .regular).foregroundStyle(t.muted)
                .frame(width: 56, height: 56).background(t.surfaceUp, in: Circle())
                .overlay(Circle().stroke(t.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func begin() async {
        let ok = await recorder.requestPermissions()
        guard ok else {
            phase = .error
            errorMsg = "Microphone access denied. Enable it in Settings → Whisperio → Microphone."
            return
        }
        startedLive = useLive
        lastActivityAt = Date()
        do {
            if startedLive {
                try live.start(language: settings.settings.language,
                               vocabulary: settings.settings.vocabularyTerms,
                               requireOnDevice: !settings.settings.appleAllowOnline)
            } else {
                try recorder.start()
            }
            SharedStore.setRecordingActive(true)
            phase = .listening
        } catch {
            SharedStore.setRecordingActive(false)
            phase = .error; errorMsg = error.localizedDescription
        }
    }

    private func stop() {
        stop(shouldDismiss: true)
    }

    private func stop(shouldDismiss: Bool) {
        guard phase == .listening, !done else { return }
        done = shouldDismiss
        phase = .processing
        if startedLive {
            Task {
                // finish() waits briefly for the recognizer to flush the tail of the last
                // segment, so the words spoken right before stop make it into the result.
                let (text, clip) = await live.finish()
                await finalizeLive(text, clip, shouldDismiss: shouldDismiss)
            }
        } else {
            let clip = recorder.stop()
            Task { await transcribe(clip, shouldDismiss: shouldDismiss) }
        }
    }

    // Finalize the on-device live path: the streamed transcript IS the result (no second pass).
    private func finalizeLive(_ raw: String, _ clip: AudioClip?, shouldDismiss: Bool) async {
        let text = settings.cleanup(raw).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            SharedStore.setRecordingActive(false)
            phase = .error; errorMsg = "Nothing was transcribed — try again and speak clearly."; return
        }
        let rec = Recording(filename: keptFilename(clip?.filename), duration: clip?.duration ?? 0,
                            status: .completed, provider: .onDevice, transcription: text)
        // Save even when the clip is missing — the live transcript is the result, and losing
        // it from history just because the audio file failed to persist would be worse.
        if settings.settings.saveRecordings { recordings.add(rec) }
#if canImport(UIKit)
        UIPasteboard.general.string = text
#elseif canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
#endif
        SharedStore.setRecordingActive(false)
        if fromKeyboard { SharedStore.setPendingTranscript(text) }
        if shouldDismiss {
            onDone(rec)
        } else {
            phase = .starting
            attemptResumeAfterInterruption()
        }
    }

    private func transcribe(_ clip: AudioClip?, shouldDismiss: Bool) async {
        guard let clip else {
            phase = .error; errorMsg = "Nothing was recorded."; return
        }
        let result = await settings.makeChain().transcribe(clip)
        switch result {
        case .success(let tr):
            let text = settings.cleanup(tr.text)
            let rec = Recording(filename: keptFilename(clip.filename), duration: clip.duration,
                                status: .completed, provider: tr.provider, transcription: text)
            if settings.settings.saveRecordings { recordings.add(rec) }
#if canImport(UIKit)
            UIPasteboard.general.string = text   // ready to paste anywhere immediately
#elseif canImport(AppKit)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
#endif
            SharedStore.setRecordingActive(false)
            // Bounce-to-app from the keyboard: stash the transcript in the shared App Group
            // so the keyboard can insert it via textDocumentProxy when the user swipes back.
            if fromKeyboard { SharedStore.setPendingTranscript(text) }
            if shouldDismiss {
                onDone(rec)
            } else {
                phase = .starting
                attemptResumeAfterInterruption()
            }
        case .failure(let err):
            SharedStore.setRecordingActive(false)
            phase = .error
            switch err {
            case .noProvidersConfigured:
                errorMsg = "No transcription engine is configured. Check Settings."
            case .allProvidersFailed(let first):
                errorMsg = first
            }
        }
    }

    // Storage & data → "Keep audio recordings" off: discard the clip file right after
    // transcription and persist the recording as text-only.
    private func keptFilename(_ filename: String?) -> String {
        guard let filename, !filename.isEmpty else { return "" }
        guard !settings.settings.keepAudioRecordings else { return filename }
        try? FileManager.default.removeItem(
            at: FileManager.default.temporaryDirectory.appendingPathComponent(filename))
        return ""
    }

    private func cancel() {
        done = true
        if startedLive { live.cancel() } else { recorder.cancel() }
        SharedStore.setRecordingActive(false)
        onCancel()
    }

    #if canImport(UIKit)
    private func handleInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }

        switch type {
        case .began:
            interruptionDidEnd = false
            if settings.settings.audioInterruptionBehavior == .resume {
                resumeAfterInterruption = true
                stop(shouldDismiss: false)
            } else {
                stop(shouldDismiss: true)
            }
        case .ended:
            interruptionDidEnd = true
            attemptResumeAfterInterruption()
        @unknown default:
            break
        }
    }
    #endif

    private func attemptResumeAfterInterruption() {
        guard resumeAfterInterruption, interruptionDidEnd, phase != .listening, !done else { return }
        resumeAfterInterruption = false
        interruptionDidEnd = false
        done = false
        Task { await begin() }
    }

    private func noteActivityIfNeeded() {
        guard phase == .listening else { return }
        let currentLevel = startedLive ? live.level : recorder.level
        if currentLevel > 0.05 {
            lastActivityAt = Date()
        }
    }

    private func checkAutoStopIfNeeded() {
        let timeout = settings.settings.audioAutoStopTimeoutSeconds
        guard timeout > 0,
              phase == .listening,
              let lastActivityAt else { return }
        if Date().timeIntervalSince(lastActivityAt) >= timeout {
            stop()
        }
    }
}
