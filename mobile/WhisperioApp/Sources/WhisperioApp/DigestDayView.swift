import SwiftUI
import WhisperioKit
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// One day's digest — the top summary card (Generate summary / spinner / summary + Regenerate) over
// the day's notes grouped by category. Grouping is computed live from the store so a category the
// user corrects in Detail moves the note between sections here; the summary text comes from the
// cached DailyDigest. Generation is gated on cloud consent + key exactly like Detail's rewrite.
struct DigestDayView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var digests: DigestStore
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var digestPrompts: DigestPromptStore
    let day: Date
    var onBack: () -> Void
    var openRec: (DemoRecording) -> Void
    var openSettings: () -> Void = {}
    var toast: (String) -> Void = { _ in }
    // How the journal composer seeded this page ("ai" | "raw"), if it did — "raw" flips the
    // summary card into its on-device stacked-notes presentation. Nil for a normal day open.
    var seed: String? = nil
    // "Blank page" entry point (JournalComposerView's .blank kind) opens straight into the
    // manual free-text editor instead of the AI-summary card, per design (mob-screens.jsx:422-423,688).
    var startInManual: Bool = false

    @State private var generating = false
    @State private var showConsent = false
    // "Pick per day" source filter (Settings → Journaling → "What goes into the digest"): shown
    // only when the day actually has more than one real capture source to choose between (no
    // fabricated choices) — see `sourcePickerSheet`.
    @State private var showSourcePicker = false
    @State private var pickedSourceKeys: Set<String> = []

    // Manual "Start from scratch" authoring — a free-text alternative to the AI summary,
    // reachable on any day, with real on-device/cloud dictation appending straight into it
    // (mirrors ScratchpadView's live-vs-record-then-transcribe dictation, minus its running-note
    // bookkeeping since here we're just filling a single text field).
    private enum DictateStage { case idle, listening, processing }
    @State private var manual = false
    @State private var manualText = ""
    @State private var dictateStage: DictateStage = .idle
    @StateObject private var dictation = LiveDictation()
    @StateObject private var micRecorder = AudioRecorder()
    @FocusState private var manualFocused: Bool

    private var dayKey: String { DigestGrouping.dayKey(for: day, calendar: .current) }

    // The day's completed notes, and their live grouping by category (order = the display order).
    private var dayRecs: [Recording] {
        let cal = Calendar.current
        return recordings.items.filter {
            $0.status == .completed
                && DigestGrouping.dayKey(for: $0.timestamp, calendar: cal) == dayKey
        }
    }
    private var groups: [DigestGroup] {
        DigestGrouping.groupByCategory(dayRecs, order: WZCategories.all(with: settings.settings).map(\.id))
    }
    private var cached: DailyDigest? { digests.digest(for: dayKey) }

    // The subset of the day's notes that would actually feed a digest (mirrors DigestStore's own
    // dayRecordings() filter before source filtering) — real data only, never fabricated.
    private var digestEligibleRecs: [Recording] {
        dayRecs.filter { !($0.transcription ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    // One row per real capture source present today, with a true count — the "Pick per day"
    // sheet's content. nil source is bucketed with "app" (same `?? "app"` convention DemoRecording
    // uses elsewhere) since both mean "in-app" and would show identically via SourceBadge.
    private struct SourcePick: Identifiable { let key: String; let count: Int; var id: String { key } }
    private var sourcePicks: [SourcePick] {
        let byKey = Dictionary(grouping: digestEligibleRecs) { $0.source ?? "app" }
        return byKey.map { SourcePick(key: $0.key, count: $0.value.count) }.sorted { $0.key < $1.key }
    }

    var body: some View {
        ZStack {
            ScreenScaffold {
                VStack(spacing: 0) {
                    WHeader(title: JournalFormat.dayTitle(day), onBack: onBack) {
                        Text("\(dayRecs.count) note\(dayRecs.count == 1 ? "" : "s")")
                            .font(WZFont.mono(11)).foregroundStyle(t.faint)
                    }
                    ScrollView(showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 18) {
                            summaryCard
                            ForEach(groups, id: \.categoryID) { group in
                                groupSection(group)
                            }
                        }
                        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 30)
                        .animation(.easeInOut(duration: 0.2), value: generating)
                    }
                }
            }
            .onAppear {
                if startInManual { manual = true }
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
            .onChange(of: manual) { _, isManual in manualFocused = isManual }
            .onDisappear {
                if dictateStage == .listening { dictation.cancel(); micRecorder.cancel() }
            }

            // "Pick per day" source filter (Settings → Journaling → digestSourceMode == .manual):
            // presented only when Generate is tapped and the day genuinely has more than one real
            // source to choose between — no fabricated sources, see `generate()`.
            if showSourcePicker {
                sourcePickerSheet
            }
        }
    }

    // MARK: - Summary card

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                SectionLabel(text: seed == "raw" ? "Notes · raw" : "Daily summary")
                Spacer(minLength: 0)
                PrivacyBadge(mode: seed == "raw" ? .device : .cloud, small: true)
            }
            if generating {
                HStack(spacing: 11) {
                    ProgressView().tint(t.accent)
                    Text("Summarizing your day…").font(WZFont.ui(14)).foregroundStyle(t.muted)
                    Spacer(minLength: 0)
                }
            } else if let summary = cached?.summary, !summary.isEmpty {
                Text(summary)
                    .font(WZFont.ui(15.5)).foregroundStyle(t.text).lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    // Copy lives here as a context menu / long-press instead of a visible button,
                    // matching the design's single-'Regenerate' footer row (mob-screens.jsx:644).
                    .contextMenu {
                        Button { copy(summary) } label: { Label("Copy", systemImage: "doc.on.doc") }
                    }
                HStack(spacing: 8) {
                    if seed == "raw" {
                        Text("Stacked verbatim · nothing sent to the cloud")
                            .font(WZFont.mono(10.5)).foregroundStyle(t.faint)
                    } else if let at = cached?.summaryGeneratedAt {
                        Text(JournalFormat.generatedMeta(at)).font(WZFont.mono(10.5)).foregroundStyle(t.faint)
                    }
                    Spacer(minLength: 0)
                    GhostButton(title: "Regenerate", icon: "sync") { generate() }.fixedSize()
                }
            } else if manual {
                manualCard
            } else {
                Text("Start with an AI summary of the day’s notes — or write it yourself from scratch.")
                    .font(WZFont.ui(14)).foregroundStyle(t.muted).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 9) {
                    GradButton(title: "Generate summary", icon: "spark") { generate() }.fixedSize()
                    GhostButton(title: "Start from scratch", icon: "pencil") { manual = true }.fixedSize()
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    // The manual-authoring mode: a free-text editor (with placeholder), a mic button that
    // dictates straight into it, an "AI instead" escape hatch back to `generate()`, and Save,
    // which caches the typed text as this day's summary through the same store path
    // JournalComposerView.composeRaw uses for a composed page.
    @ViewBuilder private var manualCard: some View {
        TextEditor(text: $manualText)
            .font(WZFont.ui(14.5)).foregroundStyle(t.text)
            .scrollContentBackground(.hidden)
            .frame(minHeight: 110, maxHeight: 180)
            .focused($manualFocused)
            .disabled(dictateStage != .idle)
            #if os(iOS)
            .textInputAutocapitalization(.sentences)
            #endif
            .padding(.horizontal, 9).padding(.vertical, 6)
            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
            .overlay(alignment: .topLeading) {
                if manualText.isEmpty {
                    Text("Write the day in your own words — or dictate straight into it…")
                        .font(WZFont.ui(14.5)).foregroundStyle(t.faint)
                        .padding(.horizontal, 14).padding(.vertical, 14)
                        .allowsHitTesting(false)
                }
            }
        HStack(spacing: 8) {
            Button(action: toggleDictate) {
                Group {
                    if dictateStage == .processing {
                        ProgressView().tint(t.primaryInk)
                    } else {
                        WIcon(dictateStage == .listening ? "stop" : "mic", size: 17)
                            .foregroundStyle(t.primaryInk)
                    }
                }
                .frame(width: 40, height: 40)
                .background(t.primary, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(dictateStage == .processing)
            Spacer(minLength: 0)
            GhostButton(title: "AI instead", icon: "spark") { manual = false; generate() }
                .fixedSize()
                .disabled(dictateStage != .idle)
            GradButton(title: "Save", icon: "check") { saveManual() }
                .fixedSize()
                .opacity(manualText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.5 : 1)
                .disabled(manualText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || dictateStage != .idle)
        }
        Text(dictateCaption)
            .font(WZFont.mono(10.5)).foregroundStyle(t.faint)
    }

    private var dictateCaption: String {
        switch dictateStage {
        case .listening: return "Listening — tap the mic to stop"
        case .processing: return "Transcribing…"
        case .idle: return "Dictate into the summary · on-device"
        }
    }

    // MARK: - Copy

    private func copy(_ text: String) {
#if canImport(UIKit)
        UIPasteboard.general.string = text
        UINotificationFeedbackGenerator().notificationOccurred(.success)
#elseif canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
#endif
        toast("Copied!")
    }

    // MARK: - Grouped notes

    private func groupSection(_ group: DigestGroup) -> some View {
        let byID = Dictionary(dayRecs.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let recs = group.recordingIDs.compactMap { byID[$0] }
        let known = group.categoryID == uncategorizedCategoryID ? nil : WZCategories.of(group.categoryID, with: settings.settings)
        return VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                SectionLabel(text: known?.label ?? "Uncategorized")
                if let known { CategoryTag(category: known) }
            }
            VStack(spacing: 0) {
                ForEach(Array(recs.enumerated()), id: \.element.id) { idx, item in
                    let demo = DemoRecording(item)
                    RecRow(r: demo, category: known,
                           onTap: { openRec(demo) }, onDelete: { recordings.delete(item) })
                    if idx < recs.count - 1 { Divider().overlay(t.lineSoft) }
                }
            }
            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            // Clip so a swiped-open row's red delete action stays inside the rounded card.
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }

    // MARK: - Generation

    // Gate on the chat client being configured (cloud consent + key) — a missing consent presents
    // the consent sheet, a missing key routes to Settings. In "Pick per day" mode with more than
    // one real source today, hand off to the source picker instead of generating immediately; a
    // day with one (or no) source has nothing to choose between, so it skips straight to
    // generating (ruling: no fabricated choices).
    private func generate() {
        let client = settings.makeChatClient()
        guard client.isConfigured else {
            if !settings.settings.cloudConsentGranted {
                showConsent = true
            } else {
                openSettings()   // consented, but no OpenAI key yet
            }
            return
        }
        let mode = settings.settings.digestSourceMode
        if mode == .manual, sourcePicks.count > 1 {
            pickedSourceKeys = Set(sourcePicks.map(\.key))   // default: every source on
            showSourcePicker = true
            return
        }
        runGenerate(client: client, sourceMode: mode, allowedSources: nil)
    }

    // Shared generation call, used both by the direct path above and by the source picker's own
    // Generate button.
    private func runGenerate(client: ChatLLM, sourceMode: DigestSourceMode, allowedSources: Set<String?>?) {
        generating = true
        Task {
            do {
                try await digests.generate(for: day, recordings: recordings,
                                           categories: WZCategories.all(with: settings.settings),
                                           using: client, model: settings.settings.chatModel,
                                           promptConfig: digestPrompts.config,
                                           sourceMode: sourceMode, allowedSources: allowedSources)
                generating = false
            } catch {
                generating = false
                toast("Couldn’t generate summary")
            }
        }
    }

    // MARK: - "Pick per day" source picker

    // Maps a source display key (see `sourcePicks`) back to the real raw `source` values it
    // stands for — "app" covers both an explicit "app" source and nil (legacy/ambiguous data
    // that's always displayed as in-app; see `DigestGrouping.isAppSource`).
    private func rawSources(for key: String) -> Set<String?> {
        key == "app" ? [nil, "app"] : [key]
    }

    private func sourcePickLabel(_ key: String) -> (icon: String, label: String) {
        switch key {
        case "keyboard": return ("keyboard", "Keyboard")
        case "action": return ("bolt", "Action Button")
        case "backtap": return ("command", "Back-Tap")
        case "watch": return ("watch", "Watch")
        case "lock": return ("lock", "Lock Screen")
        default: return ("mic", "In-app")
        }
    }

    private func toggleSourcePick(_ key: String) {
        if pickedSourceKeys.contains(key) { pickedSourceKeys.remove(key) }
        else { pickedSourceKeys.insert(key) }
    }

    private func generateFromPickedSources() {
        let client = settings.makeChatClient()
        guard client.isConfigured else { return }   // already gated before the sheet opened
        let allowed = Set(pickedSourceKeys.flatMap { rawSources(for: $0) })
        showSourcePicker = false
        runGenerate(client: client, sourceMode: .manual, allowedSources: allowed)
    }

    private var sourcePickerSheet: some View {
        BottomSheet(onClose: { showSourcePicker = false }) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Which sources go into today’s summary?")
                    .font(WZFont.display(18)).foregroundStyle(t.text)
                    .padding(.bottom, 8)
                Text("Journaling is set to “Pick per day” — nothing is auto-included. Choose which of today’s real capture sources this summary should cover.")
                    .font(WZFont.ui(13.5)).foregroundStyle(t.muted).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 14)
                VStack(spacing: 0) {
                    ForEach(Array(sourcePicks.enumerated()), id: \.element.id) { idx, pick in
                        sourcePickRow(pick)
                        if idx < sourcePicks.count - 1 { Divider().overlay(t.lineSoft) }
                    }
                }
                .padding(.horizontal, 14)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(t.line, lineWidth: 1))
                .padding(.bottom, 16)
                GradButton(title: "Generate summary", icon: "spark") { generateFromPickedSources() }
                    .opacity(pickedSourceKeys.isEmpty ? 0.5 : 1)
                    .disabled(pickedSourceKeys.isEmpty)
                    .padding(.bottom, 10)
                GhostButton(title: "Cancel") { showSourcePicker = false }
            }
        }
    }

    // Only the trailing WToggle is the tap target — same convention as SettingsView's SettRow
    // toggle rows (e.g. "Auto-journaling") rather than a whole-row button nested around one.
    private func sourcePickRow(_ pick: SourcePick) -> some View {
        let meta = sourcePickLabel(pick.key)
        return HStack(spacing: 11) {
            WIcon(meta.icon, size: 15).foregroundStyle(t.accentLite)
            VStack(alignment: .leading, spacing: 1) {
                Text(meta.label).font(WZFont.ui(14, .medium)).foregroundStyle(t.text)
                Text("\(pick.count) note\(pick.count == 1 ? "" : "s")")
                    .font(WZFont.mono(10.5)).foregroundStyle(t.faint)
            }
            Spacer(minLength: 0)
            WToggle(on: Binding(
                get: { pickedSourceKeys.contains(pick.key) },
                set: { _ in toggleSourcePick(pick.key) }))
        }
        .padding(.vertical, 11)
    }

    // MARK: - Manual authoring

    // Persist the hand-written (or dictated) text as this day's summary, the same store path
    // JournalComposerView.composeRaw uses for a composed page — keeps whatever grouping already
    // exists for the day, just replaces the summary field.
    private func saveManual() {
        let text = manualText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        digests.storeComposed(DailyDigest(
            id: dayKey, date: day,
            recordingIDs: dayRecs.map(\.id), groups: groups,
            summary: text, summaryGeneratedAt: Date()), viaCloud: false)
        manual = false
        manualText = ""
    }

    // Whether live streaming dictation is available right now — same formula ScratchpadView uses
    // to decide between live partials and record-then-transcribe.
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
                appendDictated(raw)
                dictateStage = .idle
            }
        } else {
            let clip = micRecorder.stop()
            Task {
                defer { dictateStage = .idle }
                guard let clip else { return }
                let result = await settings.makeChain().transcribe(clip)
                if case .success(let tr) = result { appendDictated(tr.text) }
                if !settings.settings.keepAudioRecordings {
                    try? FileManager.default.removeItem(
                        at: FileManager.default.temporaryDirectory.appendingPathComponent(clip.filename))
                }
            }
        }
    }

    private func appendDictated(_ raw: String) {
        let cleaned = settings.cleanup(raw).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return }
        manualText = manualText.isEmpty ? cleaned : manualText + " " + cleaned
    }

    // Accepting cloud consent from the digest flow: persist the grant, then route to Settings if the
    // OpenAI key still isn't set (otherwise the user has everything they need to tap Generate).
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
