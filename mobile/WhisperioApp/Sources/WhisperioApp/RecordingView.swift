import SwiftUI
import Combine
import WhisperioKit
#if canImport(UIKit)
import UIKit
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

    // Live partials are possible only with the on-device engine; gated by the user setting.
    private var useLive: Bool {
        settings.settings.liveTranscriptionEnabled
            && (settings.settings.providerChain.first ?? .onDevice) == .onDevice
            && LiveDictation.isSupported(language: settings.settings.language)
    }

    @State private var phase: Phase = .starting
    @State private var secs = 0
    @State private var errorMsg = ""
    @State private var done = false   // guards against stop firing after cancel/stop
    @State private var startedLive = false   // which path begin() actually took

    private enum Phase { case starting, listening, processing, error }
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var clock: String { String(format: "%d:%02d", secs / 60, secs % 60) }

    private var engineLabel: String {
        switch settings.settings.providerChain.first {
        case .openAI: return "OpenAI · cloud"
        case .elevenLabs: return "ElevenLabs · cloud"
        default: return "Apple Speech · on-device"
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
                .padding(.horizontal, 24)

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
                .padding(.horizontal, 24)

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
        .onReceive(tick) { _ in if phase == .listening { secs += 1 } }
        .onReceive(NotificationCenter.default.publisher(for: .whisperioStopDictation)) { _ in
            stop()   // triple-tap / "stop" shortcut ends recording + transcribes
        }
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
        do {
            if startedLive {
                try live.start(language: settings.settings.language, vocabulary: settings.settings.vocabularyTerms)
            } else {
                try recorder.start()
            }
            phase = .listening
        } catch {
            phase = .error; errorMsg = error.localizedDescription
        }
    }

    private func stop() {
        guard phase == .listening, !done else { return }
        done = true
        phase = .processing
        if startedLive {
            let (text, clip) = live.finish()
            Task { await finalizeLive(text, clip) }
        } else {
            let clip = recorder.stop()
            Task { await transcribe(clip) }
        }
    }

    // Finalize the on-device live path: the streamed transcript IS the result (no second pass).
    private func finalizeLive(_ raw: String, _ clip: AudioClip?) async {
        let text = settings.cleanup(raw).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            phase = .error; errorMsg = "Nothing was transcribed — try again and speak clearly."; return
        }
        let rec = Recording(filename: clip?.filename ?? "", duration: clip?.duration ?? 0,
                            status: .completed, provider: .onDevice, transcription: text)
        if settings.settings.saveRecordings, clip != nil { recordings.add(rec) }
#if canImport(UIKit)
        UIPasteboard.general.string = text
#endif
        if fromKeyboard { SharedStore.setPendingTranscript(text) }
        onDone(rec)
    }

    private func transcribe(_ clip: AudioClip?) async {
        guard let clip else {
            phase = .error; errorMsg = "Nothing was recorded."; return
        }
        let result = await settings.makeChain().transcribe(clip)
        switch result {
        case .success(let tr):
            let text = settings.cleanup(tr.text)
            let rec = Recording(filename: clip.filename, duration: clip.duration,
                                status: .completed, provider: tr.provider, transcription: text)
            if settings.settings.saveRecordings { recordings.add(rec) }
#if canImport(UIKit)
            UIPasteboard.general.string = text   // ready to paste anywhere immediately
#endif
            // Bounce-to-app from the keyboard: stash the transcript in the shared App Group
            // so the keyboard can insert it via textDocumentProxy when the user swipes back.
            if fromKeyboard { SharedStore.setPendingTranscript(text) }
            onDone(rec)
        case .failure(let err):
            phase = .error
            switch err {
            case .noProvidersConfigured:
                errorMsg = "No transcription engine is configured. Check Settings."
            case .allProvidersFailed(let first):
                errorMsg = first
            }
        }
    }

    private func cancel() {
        done = true
        if startedLive { live.cancel() } else { recorder.cancel() }
        onCancel()
    }
}
