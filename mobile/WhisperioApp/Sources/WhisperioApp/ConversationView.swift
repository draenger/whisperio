import SwiftUI
import Combine
import AVFoundation
import WhisperioKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// Conversation mode — long-form mic capture of an in-person conversation (a chat in a café,
// an interview) with user-controlled pause/resume, transcribed with speaker diarization
// (ElevenLabs Scribe v2, diarize=true). Distinct from RecordingView on purpose: dictation is
// a short single-voice clip with live partials; a conversation is long, multi-voice, and only
// transcribable in the cloud — so this screen is always file-based and never auto-stops.
struct ConversationView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var recordings: RecordingsStore
    @StateObject private var recorder = AudioRecorder()

    var onCancel: () -> Void
    var onDone: (Recording) -> Void
    var openSettings: () -> Void = {}

    @State private var phase: Phase = .starting
    @State private var secs = 0
    @State private var errorMsg = ""
    @State private var done = false
    @State private var showConsent = false

    private enum Phase { case starting, setup, listening, paused, processing, error }
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var clock: String { String(format: "%d:%02d", secs / 60, secs % 60) }

    private var statusLabel: String {
        switch phase {
        case .starting: return "Starting…"
        case .setup: return "Setup needed"
        case .listening: return "Recording conversation…"
        case .paused: return "Paused"
        case .processing: return "Transcribing speakers…"
        case .error: return "Couldn’t transcribe"
        }
    }

    private var hint: String {
        switch phase {
        case .setup:
            return "Conversations are transcribed in the cloud with speaker detection " +
                   "(ElevenLabs Scribe). Grant cloud consent and add an ElevenLabs API key " +
                   "in Settings to use this mode."
        case .listening:
            return "Recording everyone near the microphone. Pause anytime — tap stop when " +
                   "the conversation is over."
        case .paused:
            return "Recording is paused — nothing is being captured. Resume to continue " +
                   "the same conversation."
        case .processing:
            return "Detecting who said what…"
        default:
            return ""
        }
    }

    var body: some View {
        ScreenScaffold(bg: t.bg2) {
            VStack(spacing: 0) {
                HStack {
                    EngineChip(label: phase == .processing ? "Transcribing…" : "ElevenLabs · speakers",
                               icon: phase == .processing ? "spark" : "people")
                    Spacer()
                    Text(clock).font(WZFont.mono(15)).foregroundStyle(t.text).monospacedDigit()
                }
                .padding(.horizontal, 24)

                VStack(alignment: .leading, spacing: 14) {
                    SectionLabel(text: statusLabel)
                    Text(phase == .error ? errorMsg : hint)
                        .font(WZFont.display(23, .medium))
                        .foregroundStyle(phase == .error ? t.red : t.muted)
                        .lineSpacing(6).frame(minHeight: 140, alignment: .topLeading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if phase == .setup {
                        GradButton(title: "Open Settings", icon: "settings", action: resolveSetup)
                            .fixedSize()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .padding(.horizontal, 24)

                Group {
                    if phase == .listening {
                        Waveform(color: t.accent, bars: 34, height: 70)
                    } else if phase == .paused {
                        HStack(spacing: 10) {
                            WIcon("pause", size: 16).foregroundStyle(t.accentLite)
                            Text("Paused").font(WZFont.mono(13)).foregroundStyle(t.accentLite)
                        }.frame(height: 70)
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
                            .background(isCapturing ? t.red : t.elevated, in: Circle())
                            .overlay(Circle().stroke(t.red.opacity(isCapturing ? 0.16 : 0), lineWidth: 8))
                    }
                    .buttonStyle(.plain).disabled(!isCapturing)
                    if phase == .listening || phase == .paused {
                        circleButton(icon: phase == .paused ? "play" : "pause", action: togglePause)
                    } else {
                        Color.clear.frame(width: 56, height: 56)
                    }
                }
                .padding(.top, 14).padding(.bottom, 42)
            }
        }
        .onReceive(tick) { _ in
            if phase == .listening { secs += 1 }
        }
        #if canImport(UIKit)
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { note in
            handleInterruption(note)
        }
        #endif
        .sheet(isPresented: $showConsent) {
            CloudConsentSheet(provider: .elevenLabs,
                              onAccept: grantConsent,
                              onCancel: { showConsent = false })
                .environment(\.wz, t)
                #if os(iOS)
                .presentationDetents([.medium, .large])
                #endif
        }
        .task { await begin() }
    }

    // Listening OR paused — the session is live and stop() can finalize it.
    private var isCapturing: Bool { phase == .listening || phase == .paused }

    private func circleButton(icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            WIcon(icon, size: 22, weight: .regular).foregroundStyle(t.muted)
                .frame(width: 56, height: 56).background(t.surfaceUp, in: Circle())
                .overlay(Circle().stroke(t.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func begin() async {
        // Conversation needs the diarizing cloud engine — surface setup instead of recording
        // audio that could never be transcribed with speakers.
        guard settings.makeConversationTranscriber() != nil else {
            phase = .setup
            return
        }
        let ok = await recorder.requestPermissions()
        guard ok else {
            phase = .error
            errorMsg = "Microphone access denied. Enable it in Settings → Whisperio → Microphone."
            return
        }
        do {
            try recorder.start()
            SharedStore.setRecordingActive(true)
            phase = .listening
        } catch {
            SharedStore.setRecordingActive(false)
            phase = .error; errorMsg = error.localizedDescription
        }
    }

    // Setup CTA: missing consent shows the consent sheet first; with consent granted the
    // missing piece is the API key, which lives in Settings.
    private func resolveSetup() {
        if !settings.settings.cloudConsentGranted {
            showConsent = true
        } else {
            openSettings()
        }
    }

    private func grantConsent() {
        var s = settings.settings
        s.cloudConsentGranted = true
        settings.settings = s
        showConsent = false
        if settings.makeConversationTranscriber() != nil {
            Task { await begin() }
        } else {
            openSettings()   // consented, but no ElevenLabs key yet
        }
    }

    private func togglePause() {
        if phase == .paused {
            recorder.resume()
            if !recorder.isPaused { phase = .listening }
        } else if phase == .listening {
            recorder.pause()
            phase = .paused
        }
    }

    private func stop() {
        guard isCapturing, !done else { return }
        done = true
        phase = .processing
        let clip = recorder.stop()
        Task { await transcribe(clip) }
    }

    private func transcribe(_ clip: AudioClip?) async {
        guard let clip else {
            phase = .error; errorMsg = "Nothing was recorded."; return
        }
        guard let transcriber = settings.makeConversationTranscriber() else {
            phase = .error; errorMsg = "ElevenLabs isn’t configured. Check Settings."; return
        }
        do {
            let result = try await transcriber.transcribeDiarized(clip)
            let text = settings.cleanup(result.text)
            let rec = Recording(filename: clip.filename, duration: clip.duration,
                                status: .completed, provider: .elevenLabs,
                                transcription: text,
                                segments: result.segments.isEmpty ? nil : result.segments)
            // Conversations always persist — unlike a quick dictation (pasted immediately,
            // history optional), the saved transcript IS the deliverable here.
            recordings.add(rec)
            let share = rec.segments.map {
                SpeakerSegmentBuilder.transcriptText(segments: $0, names: [:])
            } ?? text
#if canImport(UIKit)
            UIPasteboard.general.string = share
#elseif canImport(AppKit)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(share, forType: .string)
#endif
            SharedStore.setRecordingActive(false)
            onDone(rec)
        } catch {
            SharedStore.setRecordingActive(false)
            phase = .error
            errorMsg = error.localizedDescription
        }
    }

    private func cancel() {
        done = true
        recorder.cancel()
        SharedStore.setRecordingActive(false)
        onCancel()
    }

    #if canImport(UIKit)
    // A call / Siri / another app taking the mic: pause instead of killing the session —
    // the user resumes manually once the interruption is over, keeping one conversation
    // in one recording.
    private func handleInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .began, phase == .listening {
            recorder.pause()
            phase = .paused
        }
    }
    #endif
}
