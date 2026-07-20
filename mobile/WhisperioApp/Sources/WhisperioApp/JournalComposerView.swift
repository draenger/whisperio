import SwiftUI
import WhisperioKit

// Journal composer — the "New page" flow (PhoneJournalNew in mob-screens.jsx). Two mode cards:
// a blank page (write/dictate straight onto the page), or a page composed from picked notes.
// Notes mode adds source/day filter chips, a select-visible toggle, pick rows from the real
// RecordingsStore, three layout cards (AI-woven · raw stacked · one per page) and — for the AI
// layout — an optional instructions prompt. AI-woven runs the summarize call over the picked
// notes (busy spinner while weaving); raw/split complete immediately, on-device.
enum JournalComposeKind: String { case blank, ai, raw, split }

// Which composer mode to seed on open (mirrors PhoneJournalNew's `initialMode` prop). nil leaves
// both mode cards showing so the user picks — today's only real call site (AppShell's "+ New
// page") always passes nil; a non-nil value is currently only exercised by the design gallery.
enum JournalComposeMode { case blank, notes }

struct JournalComposerView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var digests: DigestStore
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var digestPrompts: DigestPromptStore
    var onBack: () -> Void
    var onDone: (JournalComposeKind) -> Void
    var openSettings: () -> Void = {}
    var toast: (String) -> Void = { _ in }

    private enum PageLayout: String { case ai, raw, split }

    @State private var mode: JournalComposeMode?
    @State private var layout: PageLayout = .ai
    @State private var picked: Set<UUID> = []
    @State private var seeded = false
    @State private var srcF = "all"       // all | app | keyboard
    @State private var dayF = "all"       // all | today | yesterday
    @State private var prompt = ""
    @State private var busy = false
    @State private var showConsent = false
    // "Dictate the instructions" mic on the AI-prompt field — same real dictation stack as
    // DigestDayView's manual card (LiveDictation when the on-device path supports it, else
    // record + provider-chain transcribe), appending into `prompt`.
    private enum DictateStage { case idle, listening, processing }
    @State private var dictateStage: DictateStage = .idle
    @StateObject private var dictation = LiveDictation()
    @StateObject private var micRecorder = AudioRecorder()

    private static let promptPresets = ["Standup update", "Bullet points", "Dear diary", "Client email"]

    init(onBack: @escaping () -> Void,
         onDone: @escaping (JournalComposeKind) -> Void,
         openSettings: @escaping () -> Void = {},
         toast: @escaping (String) -> Void = { _ in },
         initialMode: JournalComposeMode? = nil) {
        self.onBack = onBack
        self.onDone = onDone
        self.openSettings = openSettings
        self.toast = toast
        _mode = State(initialValue: initialMode)
    }

    // Completed notes with real text — the pickable pool before filters.
    private var allNotes: [Recording] {
        recordings.items.filter {
            $0.status == .completed
                && !($0.transcription ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        .sorted { $0.timestamp > $1.timestamp }
    }

    private func matches(_ r: Recording) -> Bool {
        let src = DemoRecording(r).src
        let srcOK = srcF == "all" || (srcF == "keyboard" ? src == "keyboard" : src != "keyboard")
        let cal = Calendar.current
        let dayOK = dayF == "all"
            || (dayF == "today" ? cal.isDateInToday(r.timestamp) : cal.isDateInYesterday(r.timestamp))
        return srcOK && dayOK
    }

    private var pool: [Recording] { allNotes.filter(matches) }
    private var nSel: Int { allNotes.filter { picked.contains($0.id) }.count }
    private var allOn: Bool { !pool.isEmpty && pool.allSatisfy { picked.contains($0.id) } }

    private struct CTA { let label: String; let icon: String?; let ok: Bool; let kind: JournalComposeKind }
    private var cta: CTA {
        switch mode {
        case .blank:
            return CTA(label: "Open blank page", icon: "pencil", ok: true, kind: .blank)
        default:
            let n = nSel
            switch layout {
            case .ai:
                return CTA(label: busy ? "Weaving…" : "Weave \(n) note\(n == 1 ? "" : "s") with AI",
                           icon: "spark", ok: n > 0, kind: .ai)
            case .raw:
                return CTA(label: "Add \(n) note\(n == 1 ? "" : "s") to one page",
                           icon: "book", ok: n > 0, kind: .raw)
            case .split:
                return CTA(label: "Create \(n) page\(n == 1 ? "" : "s")",
                           icon: "plus", ok: n > 0, kind: .split)
            }
        }
    }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "New page", onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 10) {
                        bigCard(.blank, icon: "pencil", title: "Blank page",
                                sub: "Write or dictate straight onto the page")
                        bigCard(.notes, icon: "book", title: "From your notes",
                                sub: "Pick transcriptions — one by one, by source or by day")
                        if mode == .notes { notesSection }
                    }
                    .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 30)
                    .animation(.easeInOut(duration: 0.2), value: mode == .notes)
                    .animation(.easeInOut(duration: 0.2), value: layout)
                }
                footer
            }
        }
        .onAppear {
            // Default selection: today's notes (mirrors the design's initial pick).
            guard !seeded else { return }
            seeded = true
            let cal = Calendar.current
            picked = Set(allNotes.filter { cal.isDateInToday($0.timestamp) }.map(\.id))
        }
        .onDisappear {
            // Tear down an in-flight prompt dictation — same guard DigestDayView's manual
            // card applies when the screen goes away mid-listen.
            if dictateStage == .listening { dictation.cancel(); micRecorder.cancel() }
        }
        .sheet(isPresented: $showConsent) {
            CloudConsentSheet(provider: .openAI,
                              onAccept: grantConsent,
                              onCancel: { showConsent = false })
                .environment(\.wz, t)
                #if os(iOS)
                .presentationDetents([.medium, .large])
                #endif
        }
    }

    // MARK: - Notes mode

    @ViewBuilder private var notesSection: some View {
        // Filter chips: source × day.
        FlowLayout(spacing: 6) {
            chip(srcF == "all", "All") { srcF = "all" }
            chip(srcF == "app", "In-app", icon: "mic") { srcF = "app" }
            chip(srcF == "keyboard", "Keyboard", icon: "keyboard") { srcF = "keyboard" }
            Rectangle().fill(t.line).frame(width: 1, height: 18).padding(.horizontal, 2)
            chip(dayF == "all", "All days") { dayF = "all" }
            chip(dayF == "today", "Today") { dayF = "today" }
            chip(dayF == "yesterday", "Yesterday") { dayF = "yesterday" }
        }
        .padding(.top, 4)

        HStack {
            SectionLabel(text: "\(nSel) selected")
            Spacer(minLength: 0)
            Button(allOn ? "Deselect visible" : "Select visible") { toggleAll() }
                .font(WZFont.mono(11, .semibold))
                .foregroundStyle(t.accentLite)
                .buttonStyle(.plain)
        }
        .padding(.leading, 4)

        pickList

        SectionLabel(text: "Onto the page as").padding(.leading, 4).padding(.top, 4)
        HStack(spacing: 8) {
            layoutCard(.ai, icon: "spark", title: "Weave with AI", sub: "one page · summarized")
            layoutCard(.raw, icon: "book", title: "Raw, stacked", sub: "one page · verbatim")
            layoutCard(.split, icon: "plus", title: "One per page", sub: "\(nSel > 0 ? "\(nSel)" : "n") pages")
        }

        if layout == .ai { aiPromptSection }
    }

    private var pickList: some View {
        let cal = Calendar.current
        let today = pool.filter { cal.isDateInToday($0.timestamp) }
        let yesterday = pool.filter { cal.isDateInYesterday($0.timestamp) }
        let earlier = pool.filter { !cal.isDateInToday($0.timestamp) && !cal.isDateInYesterday($0.timestamp) }
        return VStack(alignment: .leading, spacing: 0) {
            dayRows("Today", today)
            dayRows("Yesterday", yesterday)
            dayRows("Earlier", earlier)
            if pool.isEmpty {
                Text("Nothing matches these filters.")
                    .font(WZFont.ui(12.5)).foregroundStyle(t.faint)
                    .padding(14)
            }
        }
        .padding(.bottom, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    @ViewBuilder private func dayRows(_ label: String, _ recs: [Recording]) -> some View {
        if !recs.isEmpty {
            Text(label.uppercased())
                .font(WZFont.mono(9.5)).tracking(1.1).foregroundStyle(t.faint)
                .padding(.horizontal, 14).padding(.top, 9).padding(.bottom, 4)
            ForEach(recs) { r in pickRow(r) }
        }
    }

    private func pickRow(_ r: Recording) -> some View {
        let on = picked.contains(r.id)
        let demo = DemoRecording(r)
        return Button { togglePick(r.id) } label: {
            HStack(spacing: 11) {
                ZStack {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(on ? t.accent : t.surfaceUp)
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .stroke(on ? t.accent : t.line, lineWidth: 1)
                    if on { WIcon("check", size: 13).foregroundStyle(.white) }
                }
                .frame(width: 22, height: 22)
                Text(demo.title)
                    .font(WZFont.ui(13)).foregroundStyle(t.text)
                    .lineLimit(1).truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                WIcon(demo.srcIcon, size: 13).foregroundStyle(t.faint)
                Text(demo.when).font(WZFont.mono(9.5)).foregroundStyle(t.faint)
            }
            .padding(.horizontal, 14).padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private var aiPromptSection: some View {
        ZStack(alignment: .bottomTrailing) {
            TextField("Instructions for the AI (optional) — e.g. standup update, first person, casual…",
                      text: $prompt, axis: .vertical)
                .font(WZFont.ui(13)).foregroundStyle(t.text)
                .lineLimit(2...4)
                .padding(.leading, 13).padding(.trailing, 46).padding(.vertical, 11)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
            Button(action: toggleDictate) {
                Circle().fill(dictateStage == .listening ? t.red : t.primary)
                    .frame(width: 30, height: 30)
                    .overlay {
                        if dictateStage == .processing {
                            ProgressView().controlSize(.mini).tint(t.primaryInk)
                        } else {
                            WIcon(dictateStage == .listening ? "stop" : "mic", size: 13)
                                .foregroundStyle(t.primaryInk)
                        }
                    }
            }
            .buttonStyle(.plain)
            .disabled(dictateStage == .processing)
            .accessibilityLabel(dictateStage == .listening ? "Stop dictating" : "Dictate the instructions")
            .padding(.trailing, 9).padding(.bottom, 10)
        }
        .padding(.top, 2)

        FlowLayout(spacing: 6) {
            ForEach(Self.promptPresets, id: \.self) { p in
                let on = prompt == p
                Button { prompt = p } label: {
                    Text(p)
                        .font(WZFont.ui(11.5, .semibold))
                        .foregroundStyle(on ? t.accentLite : t.muted)
                        .padding(.horizontal, 11).padding(.vertical, 5)
                        .background(on ? t.accent.opacity(0.16) : t.surfaceUp, in: Capsule())
                        .overlay(Capsule().stroke(on ? t.hair : t.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }

        Text("Cloud text model · the picked notes and instructions are sent to it. Raw and one-per-page never leave the device.")
            .font(WZFont.mono(10)).foregroundStyle(t.faint).lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - Cards & chips

    private func bigCard(_ id: JournalComposeMode, icon: String, title: String, sub: String) -> some View {
        let on = mode == id
        return Button { withAnimation(.easeInOut(duration: 0.2)) { mode = id } } label: {
            HStack(spacing: 13) {
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(t.surfaceUp)
                    .frame(width: 38, height: 38)
                    .overlay(WIcon(icon, size: 17).foregroundStyle(on ? t.accent : t.accentLite))
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(WZFont.ui(14.5, .semibold)).foregroundStyle(t.text)
                    Text(sub).font(WZFont.ui(12)).foregroundStyle(t.muted).lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if on { WIcon("check", size: 17).foregroundStyle(t.accent) }
            }
            .padding(15)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(on ? t.accent : t.line, lineWidth: on ? 2 : 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func layoutCard(_ id: PageLayout, icon: String, title: String, sub: String) -> some View {
        let on = layout == id
        return Button { layout = id } label: {
            VStack(alignment: .leading, spacing: 5) {
                WIcon(icon, size: 15).foregroundStyle(on ? t.accent : t.faint)
                Text(title).font(WZFont.ui(12, .semibold)).foregroundStyle(t.text)
                Text(sub).font(WZFont.mono(9)).foregroundStyle(t.faint)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(11)
            .background(on ? AnyShapeStyle(t.accent.opacity(t.dark ? 0.12 : 0.08)) : AnyShapeStyle(t.surface),
                        in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(on ? t.accent.opacity(0.5) : t.line, lineWidth: on ? 1.5 : 1))
            .contentShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func chip(_ on: Bool, _ label: String, icon: String? = nil,
                      action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let icon { WIcon(icon, size: 12) }
                Text(label)
            }
            .font(WZFont.ui(11.5, .semibold))
            .foregroundStyle(on ? t.accentLite : t.muted)
            .padding(.horizontal, 11).padding(.vertical, 6)
            .background(on ? t.accent.opacity(0.16) : t.surfaceUp, in: Capsule())
            .overlay(Capsule().stroke(on ? t.hair : t.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Footer CTA

    private var footer: some View {
        let c = cta
        let enabled = mode != nil && c.ok && !busy
        return Button {
            guard enabled else { return }
            go(c.kind)
        } label: {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(t.primaryInk) }
                else if let icon = c.icon { WIcon(icon, size: 17) }
                // Same scale-down guard as the shared GradButton — this label embeds a
                // live note count ("Weave 12 notes with AI") and is the longest CTA around.
                Text(c.label).lineLimit(1).minimumScaleFactor(0.75)
            }
            .font(WZFont.ui(15, .semibold))
            .foregroundStyle(t.primaryInk)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13).padding(.horizontal, 20)
            .background(t.primary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .shadow(color: t.accent.opacity(0.50), radius: 12, y: 8)
        }
        .buttonStyle(.plain)
        .opacity(enabled || busy ? 1 : 0.5)
        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 30)
    }

    // MARK: - Selection

    private func togglePick(_ id: UUID) {
        if picked.contains(id) { picked.remove(id) } else { picked.insert(id) }
    }

    private func toggleAll() {
        let visible = pool.map(\.id)
        if allOn { visible.forEach { picked.remove($0) } }
        else { visible.forEach { picked.insert($0) } }
    }

    private func pickedRecordings() -> [Recording] {
        allNotes.filter { picked.contains($0.id) }
    }

    // MARK: - Prompt dictation (mirrors DigestDayView's manual-card pattern)

    private var useLiveDictation: Bool {
        settings.settings.liveTranscriptionEnabled
            && (settings.settings.providerChain.first ?? .onDevice) == .onDevice
            && LiveDictation.isSupported(language: settings.settings.language,
                                         requireOnDevice: !settings.settings.appleAllowOnline)
    }

    private func toggleDictate() {
        switch dictateStage {
        case .idle: startDictate()
        case .listening: stopDictate()
        case .processing: break
        }
    }

    private func startDictate() {
        Task {
            let ok = await micRecorder.requestPermissions()
            guard ok else {
                toast("Microphone access denied — enable it in Settings.")
                return
            }
            do {
                if useLiveDictation {
                    try dictation.start(language: settings.settings.language,
                                         vocabulary: settings.settings.vocabularyTerms,
                                         requireOnDevice: !settings.settings.appleAllowOnline)
                } else {
                    try micRecorder.start()
                }
                dictateStage = .listening
            } catch {
                toast(error.localizedDescription)
            }
        }
    }

    private func stopDictate() {
        guard dictateStage == .listening else { return }
        dictateStage = .processing
        if useLiveDictation {
            Task {
                let (raw, _) = await dictation.finish()
                appendToPrompt(raw)
                dictateStage = .idle
            }
        } else {
            let clip = micRecorder.stop()
            Task {
                defer { dictateStage = .idle }
                guard let clip else { return }
                let result = await settings.makeChain().transcribe(clip)
                if case .success(let tr) = result { appendToPrompt(tr.text) }
                if !settings.settings.keepAudioRecordings {
                    try? FileManager.default.removeItem(
                        at: FileManager.default.temporaryDirectory.appendingPathComponent(clip.filename))
                }
            }
        }
    }

    private func appendToPrompt(_ raw: String) {
        let text = settings.cleanup(raw).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        prompt = prompt.isEmpty ? text : prompt + " " + text
    }

    // MARK: - Completion

    private func go(_ kind: JournalComposeKind) {
        switch kind {
        case .blank, .split:
            onDone(kind)
        case .raw:
            composeRaw()
        case .ai:
            composeAI()
        }
    }

    // Raw stacked: build the page verbatim on-device and cache it for today — no cloud call.
    private func composeRaw() {
        let picks = pickedRecordings()
        guard !picks.isEmpty else { return }
        let day = Date()
        let stacked = picks.map { "• " + ($0.transcription ?? "") }.joined(separator: "\n")
        let groups = DigestGrouping.groupByCategory(picks, order: WZCategories.all(with: settings.settings).map(\.id))
        digests.storeComposed(DailyDigest(
            id: DigestGrouping.dayKey(for: day, calendar: .current), date: day,
            recordingIDs: picks.map(\.id), groups: groups,
            summary: stacked, summaryGeneratedAt: Date()), viaCloud: false)
        onDone(.raw)
    }

    // AI-woven: summarize the picked notes (plus optional instructions) through the chat client,
    // gated on cloud consent + key exactly like DigestDayView.generate.
    private func composeAI() {
        let client = settings.makeChatClient()
        guard client.isConfigured else {
            if !settings.settings.cloudConsentGranted { showConsent = true }
            else { openSettings() }   // consented, but no OpenAI key yet
            return
        }
        let picks = pickedRecordings()
        guard !picks.isEmpty else { return }
        busy = true
        let day = Date()
        var cfg = digestPrompts.config
        let extra = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if !extra.isEmpty {
            cfg.summaryInstruction += "\nAdditional instructions from the user: \(extra)"
        }
        let model = settings.settings.chatModel
        Task {
            do {
                let groups = DigestGrouping.groupByCategory(picks, order: WZCategories.all(with: settings.settings).map(\.id))
                let byID = Dictionary(picks.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
                let promptGroups: [(label: String, notes: [String])] = groups.map { g in
                    let label = g.categoryID == uncategorizedCategoryID
                        ? "Uncategorized" : WZCategories.of(g.categoryID, with: settings.settings).label
                    return (label: label, notes: g.recordingIDs.compactMap { byID[$0]?.transcription })
                }
                let summary = try await client.summarize(
                    day: day, groups: promptGroups, locale: Locale.current.identifier,
                    model: model, promptConfig: cfg)
                digests.storeComposed(DailyDigest(
                    id: DigestGrouping.dayKey(for: day, calendar: .current), date: day,
                    recordingIDs: picks.map(\.id), groups: groups,
                    summary: summary, summaryGeneratedAt: Date()))
                busy = false
                onDone(.ai)
            } catch {
                busy = false
                toast("Couldn’t weave the notes")
            }
        }
    }

    private func grantConsent() {
        var s = settings.settings
        s.cloudConsentGranted = true
        settings.settings = s
        showConsent = false
        if settings.settings.openAIKey.trimmingCharacters(in: .whitespaces).isEmpty {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { openSettings() }
        } else {
            toast("Cloud journaling enabled")
        }
    }
}
