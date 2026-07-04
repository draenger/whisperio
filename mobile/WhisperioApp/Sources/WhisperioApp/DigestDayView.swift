import SwiftUI
import WhisperioKit

// One day's digest — the top summary card (Generate summary / spinner / summary + Regenerate) over
// the day's notes grouped by category. Grouping is computed live from the store so a category the
// user corrects in Detail moves the note between sections here; the summary text comes from the
// cached DailyDigest. Generation is gated on cloud consent + key exactly like Detail's rewrite.
struct DigestDayView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var digests: DigestStore
    @EnvironmentObject private var settings: SettingsStore
    let day: Date
    var onBack: () -> Void
    var openRec: (DemoRecording) -> Void
    var openSettings: () -> Void = {}
    var toast: (String) -> Void = { _ in }

    @State private var generating = false
    @State private var showConsent = false

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
        DigestGrouping.groupByCategory(dayRecs, order: WZCategories.all.map(\.id))
    }
    private var cached: DailyDigest? { digests.digest(for: dayKey) }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: JournalFormat.dayTitle(day), onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        summaryCard
                        ForEach(groups, id: \.categoryID) { group in
                            groupSection(group)
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 40)
                    .animation(.easeInOut(duration: 0.2), value: generating)
                }
            }
        }
        .sheet(isPresented: $showConsent) {
            CloudConsentSheet(provider: .openAI,
                              onAccept: grantConsent,
                              onCancel: { showConsent = false })
                .environment(\.wz, t)
                .presentationDetents([.medium, .large])
        }
    }

    // MARK: - Summary card

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                SectionLabel(text: "Daily summary")
                Spacer(minLength: 0)
                PrivacyBadge(mode: .cloud, small: true)
            }
            if generating {
                HStack(spacing: 11) {
                    ProgressView().tint(t.accent)
                    Text("Summarizing your day…").font(WZFont.ui(14, .medium)).foregroundStyle(t.muted)
                    Spacer(minLength: 0)
                }
            } else if let summary = cached?.summary, !summary.isEmpty {
                Text(summary)
                    .font(WZFont.ui(15)).foregroundStyle(t.text).lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                HStack(spacing: 8) {
                    if let at = cached?.summaryGeneratedAt {
                        Text(JournalFormat.generatedMeta(at)).font(WZFont.mono(10.5)).foregroundStyle(t.faint)
                    }
                    Spacer(minLength: 0)
                    GhostButton(title: "Regenerate", icon: "sync") { generate() }.fixedSize()
                }
            } else {
                Text("Group this day’s notes by category and write a short digest with AI.")
                    .font(WZFont.ui(13.5)).foregroundStyle(t.muted).lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                GradButton(title: "Generate summary", icon: "spark") { generate() }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    // MARK: - Grouped notes

    private func groupSection(_ group: DigestGroup) -> some View {
        let byID = Dictionary(uniqueKeysWithValues: dayRecs.map { ($0.id, $0) })
        let recs = group.recordingIDs.compactMap { byID[$0] }
        let known = group.categoryID == uncategorizedCategoryID ? nil : WZCategories.of(group.categoryID)
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
                        .padding(.horizontal, 14)
                    if idx < recs.count - 1 { Divider().overlay(t.lineSoft) }
                }
            }
            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }

    // MARK: - Generation

    // Gate on the chat client being configured (cloud consent + key) — a missing consent presents
    // the consent sheet, a missing key routes to Settings — then generate through the store.
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
        generating = true
        Task {
            do {
                try await digests.generate(for: day, recordings: recordings,
                                           categories: WZCategories.all,
                                           using: client, model: settings.settings.chatModel)
                generating = false
            } catch {
                generating = false
                toast("Couldn’t generate summary")
            }
        }
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
