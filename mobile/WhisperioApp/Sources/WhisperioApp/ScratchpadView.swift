import SwiftUI
import Combine
import AVFoundation
import WhisperioKit

// Scratchpad — port of the design's continuous-note home: one running note per day, each
// dictation appends a timestamped take inline. Real mic capture on the same engines as
// RecordingView (live on-device partials when available, else record-then-transcribe).
// The ListeningGhost narrates the flow: listens while you talk, scribbles when a take is
// kept, startles when one is discarded.
struct ScratchpadView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var recordings: RecordingsStore
    @StateObject private var recorder = AudioRecorder()
    @StateObject private var live = LiveDictation()
    var onBack: () -> Void
    var onHistory: () -> Void = {}
    var openSettings: () -> Void = {}
    var summarizeDay: () -> Void = {}
    var toast: (String) -> Void = { _ in }

    private enum Stage { case idle, listening, processing }
    @State private var stage: Stage = .idle
    @State private var startedLive = false
    @State private var secs = 0
    @State private var ghostPhase: ListeningGhost.Phase?
    @State private var ghostReactUntil: Date = .distantPast

    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var useLive: Bool {
        settings.settings.liveTranscriptionEnabled
            && (settings.settings.providerChain.first ?? .onDevice) == .onDevice
            && LiveDictation.isSupported(language: settings.settings.language,
                                         requireOnDevice: !settings.settings.appleAllowOnline)
    }

    // Today's takes, oldest first — the running note is just the library filtered to today.
    private var entries: [Recording] {
        let today = Calendar.current.startOfDay(for: Date())
        return recordings.items
            .filter { Calendar.current.startOfDay(for: $0.timestamp) == today && $0.transcription != nil }
            .sorted { $0.timestamp < $1.timestamp }
    }

    private var wordTotal: Int {
        entries.reduce(0) { $0 + ($1.transcription ?? "").split(whereSeparator: \.isWhitespace).count }
    }

    private var todayLabel: String {
        let df = DateFormatter()
        df.dateFormat = "EEE, MMM d"
        return df.string(from: Date())
    }

    private static let timeFmt: DateFormatter = {
        let df = DateFormatter()
        df.dateFormat = "h:mm a"
        return df
    }()

    private var clock: String { String(format: "%d:%02d", secs / 60, secs % 60) }

    var body: some View {
        ScreenScaffold {
            ZStack(alignment: .bottom) {
                VStack(spacing: 0) {
                    WHeader(title: "Today’s note", onBack: onBack) {
                        HStack(spacing: 9) {
                            SquareIconButton(icon: "book", action: onHistory)
                            SquareIconButton(icon: "settings", action: openSettings)
                        }
                    }
                    noteHeader
                    ScrollViewReader { proxy in
                        ScrollView(showsIndicators: false) {
                            noteCard
                                .padding(.horizontal, 16)
                            if stage == .idle && !entries.isEmpty {
                                VStack(spacing: 8) {
                                    Text("At midnight this note rolls into your Journal")
                                        .font(WZFont.mono(11)).foregroundStyle(t.faint)
                                    Button(action: summarizeDay) {
                                        HStack(spacing: 6) {
                                            WIcon("spark", size: 13)
                                            Text("Summarize the day now")
                                        }
                                        .font(WZFont.mono(11.5, .semibold))
                                        .foregroundStyle(t.accentLite)
                                        .padding(.horizontal, 14).padding(.vertical, 7)
                                        .background(t.accent.opacity(0.12), in: Capsule())
                                        .overlay(Capsule().stroke(t.hair, lineWidth: 1))
                                    }
                                    .buttonStyle(.plain)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.top, 14)
                            }
                            Color.clear.frame(height: 150).id("bottom")
                        }
                        .onChange(of: entries.count) { _, _ in
                            withAnimation(.easeOut(duration: 0.3)) { proxy.scrollTo("bottom") }
                        }
                        .onChange(of: live.transcript) { _, _ in
                            proxy.scrollTo("bottom")
                        }
                    }
                }
                controls
            }
        }
        .onReceive(tick) { _ in
            if stage == .listening { secs += 1 }
            // Let a finished reaction (note/wtf) fall back to hidden.
            if stage == .idle, ghostPhase != nil, Date() > ghostReactUntil { ghostPhase = nil }
        }
        .onDisappear {
            if stage == .listening { cancelTake() }
        }
    }

    private var noteHeader: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("Today").font(WZFont.display(22, .semibold)).foregroundStyle(t.text)
            Text(todayLabel).font(WZFont.mono(11.5)).foregroundStyle(t.faint)
            Spacer(minLength: 0)
            Text("\(entries.count) take\(entries.count == 1 ? "" : "s") · \(wordTotal) words")
                .font(WZFont.mono(11)).foregroundStyle(t.faint)
        }
        .padding(.horizontal, 20).padding(.top, 2).padding(.bottom, 12)
    }

    private var noteCard: some View {
        VStack(spacing: 0) {
            ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                entryRow(entry, last: index == entries.count - 1 && stage != .listening)
            }
            if stage == .listening {
                liveRow
            } else if stage == .processing {
                HStack(spacing: 10) {
                    ProgressView().tint(t.accent)
                    Text("Transcribing…").font(WZFont.mono(11.5)).foregroundStyle(t.accentLite)
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 13)
            }
            if entries.isEmpty && stage == .idle {
                Text("Say something — every take lands here, in one running note for the day.")
                    .font(WZFont.ui(14)).foregroundStyle(t.muted).lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 16)
            }
        }
        .padding(.horizontal, 18).padding(.top, 6).padding(.bottom, 14)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    private func entryRow(_ entry: Recording, last: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(Self.timeFmt.string(from: entry.timestamp))
                    .font(WZFont.mono(10.5, .semibold)).foregroundStyle(t.accentLite)
                Rectangle().fill(t.lineSoft).frame(height: 1)
                WIcon("lock", size: 11).foregroundStyle(t.green)
            }
            Text(entry.transcription ?? "")
                .font(WZFont.ui(15)).foregroundStyle(t.text).lineSpacing(5)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 13)
        .overlay(alignment: .bottom) {
            if !last { Rectangle().fill(t.lineSoft).frame(height: 1) }
        }
    }

    private var liveRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                PulsingDot(color: t.red)
                Text("now").font(WZFont.mono(10.5, .semibold)).foregroundStyle(t.red)
                Rectangle().fill(t.lineSoft).frame(height: 1)
                Text(clock).font(WZFont.mono(10.5)).foregroundStyle(t.faint).monospacedDigit()
            }
            (Text(live.transcript).foregroundStyle(t.text)
                .underline(pattern: .dot, color: t.accent.opacity(0.6))
                + Text("|").foregroundStyle(t.accent))
                .font(WZFont.ui(15)).lineSpacing(5)
                .frame(minHeight: 23, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 13)
    }

    // MARK: - Bottom controls

    private var controls: some View {
        VStack(spacing: 10) {
            if let ghostPhase {
                ListeningGhost(phase: ghostPhase, size: 94)
            }
            if stage == .listening {
                HStack(spacing: 12) {
                    Button(action: cancelTake) {
                        WIcon("x", size: 17).foregroundStyle(t.muted)
                            .frame(width: 42, height: 42)
                            .background(t.surfaceUp, in: Circle())
                            .overlay(Circle().stroke(t.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    // Single centered child (design's flex:1 wrapper) — as three separate
                    // HStack children the two Spacers doubled the 12pt gap budget and shifted
                    // the waveform ~12pt off-center.
                    HStack(spacing: 0) {
                        Spacer(minLength: 0)
                        Waveform(color: t.accentLite, bars: 22, height: 30)
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity)
                    Button(action: keepTake) {
                        WIcon("check", size: 21).foregroundStyle(t.primaryInk)
                            .frame(width: 50, height: 50)
                            .background(t.primary, in: Circle())
                            .shadow(color: t.accent.opacity(0.45), radius: 9, y: 4)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                .shadow(color: .black.opacity(0.35), radius: 15, y: 7)
            } else {
                Button(action: startTake) {
                    HStack(spacing: 10) {
                        WIcon("mic", size: 20)
                        Text("Continue note")
                    }
                    .font(WZFont.display(16, .semibold))
                    .foregroundStyle(t.primaryInk)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(t.primary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .shadow(color: t.accent.opacity(0.6), radius: 13, y: 6)
                }
                .buttonStyle(.plain)
                .disabled(stage == .processing)
                .opacity(stage == .processing ? 0.6 : 1)
            }
        }
        .padding(.horizontal, 16).padding(.bottom, 26).padding(.top, 26)
        .background(
            LinearGradient(colors: [t.bg.opacity(0), t.bg, t.bg],
                           startPoint: .top, endPoint: .bottom)
                .allowsHitTesting(false)
        )
    }

    // MARK: - Dictation

    private func startTake() {
        Task {
            let ok = await recorder.requestPermissions()
            guard ok else {
                toast("Microphone access denied — enable it in Settings.")
                return
            }
            startedLive = useLive
            do {
                if startedLive {
                    try live.start(language: settings.settings.language,
                                   vocabulary: settings.settings.vocabularyTerms,
                                   requireOnDevice: !settings.settings.appleAllowOnline)
                } else {
                    try recorder.start()
                }
                SharedStore.setRecordingActive(true)
                secs = 0
                stage = .listening
                ghostPhase = .listening
            } catch {
                toast(error.localizedDescription)
                react(.wtf, for: 2.6)
            }
        }
    }

    private func keepTake() {
        guard stage == .listening else { return }
        stage = .processing
        if startedLive {
            Task {
                let (raw, clip) = await live.finish()
                finishTake(raw: raw, clip: clip)
            }
        } else {
            let clip = recorder.stop()
            Task {
                guard let clip else {
                    SharedStore.setRecordingActive(false)
                    stage = .idle
                    react(.wtf, for: 2.6)
                    return
                }
                let result = await settings.makeChain().transcribe(clip)
                switch result {
                case .success(let tr): finishTake(raw: tr.text, clip: clip, provider: tr.provider)
                case .failure:
                    SharedStore.setRecordingActive(false)
                    stage = .idle
                    toast("Couldn’t transcribe that take.")
                    react(.wtf, for: 2.6)
                }
            }
        }
    }

    private func finishTake(raw: String, clip: AudioClip?, provider: ProviderID = .onDevice) {
        SharedStore.setRecordingActive(false)
        let text = settings.cleanup(raw).trimmingCharacters(in: .whitespacesAndNewlines)
        stage = .idle
        guard !text.isEmpty else {
            toast("Nothing was transcribed — try again.")
            react(.wtf, for: 2.6)
            return
        }
        var filename = clip?.filename ?? ""
        if !settings.settings.keepAudioRecordings, !filename.isEmpty {
            AudioStore.delete(filename)
            filename = ""
        } else if !filename.isEmpty {
            // Adopt the clip into durable storage — tmp gets purged by iOS.
            AudioStore.persist(filename)
        }
        let rec = Recording(filename: filename, duration: clip?.duration ?? 0,
                            status: .completed, provider: provider, transcription: text,
                            source: "app")
        if settings.settings.saveRecordings { recordings.add(rec) }
        react(.note, for: 3.2)
    }

    private func cancelTake() {
        if startedLive { live.cancel() } else { recorder.cancel() }
        SharedStore.setRecordingActive(false)
        stage = .idle
        react(.wtf, for: 2.6)
    }

    private func react(_ phase: ListeningGhost.Phase, for seconds: Double) {
        ghostPhase = phase
        ghostReactUntil = Date().addingTimeInterval(seconds)
    }
}
