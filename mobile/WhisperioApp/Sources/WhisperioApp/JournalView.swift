import SwiftUI
import WhisperioKit

// Journal — the daily-digest index. One card per day that has notes: the day title, the categories
// present, a note count, and either a "ready" check (a summary has been generated) or a "Generate
// summary" call-to-action. Tapping a card opens DigestDayView for that day, where the summary is
// generated / regenerated and the notes are browsed. Reuses the same StyleKit surfaces as Home.
struct JournalView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var digests: DigestStore
    var onBack: () -> Void
    var openDay: (Date) -> Void

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Journal", onBack: onBack)
                if days.isEmpty {
                    emptyState
                } else {
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 14) {
                            ForEach(days, id: \.key) { day in
                                dayCard(day)
                            }
                        }
                        .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 40)
                    }
                    // Re-reads whatever CloudKit has already imported locally for the journal —
                    // same recourse Home's pull-to-refresh gives the recordings list.
                    .refreshable { digests.requestCloudRefresh() }
                }
            }
        }
    }

    // A day that has notes: its key (YYYY-MM-DD), a representative date, and its recordings.
    private struct JournalDay { let key: String; let date: Date; let recs: [Recording] }

    // Completed recordings bucketed by calendar day, newest day first.
    private var days: [JournalDay] {
        let cal = Calendar.current
        let completed = recordings.items.filter { $0.status == .completed }
        return DigestGrouping.bucketByDay(completed, calendar: cal)
            .map { key, recs in JournalDay(key: key, date: recs.map(\.timestamp).max() ?? Date(), recs: recs) }
            .sorted { $0.key > $1.key }
    }

    private func dayCard(_ day: JournalDay) -> some View {
        let cats = categories(in: day.recs)
        let ready = digests.digest(for: day.key)?.summary?.isEmpty == false
        return VStack(alignment: .leading, spacing: 12) {
            Button { openDay(day.date) } label: {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        SectionLabel(text: JournalFormat.dayTitle(day.date))
                        Spacer(minLength: 0)
                        Text("\(day.recs.count) note\(day.recs.count == 1 ? "" : "s")")
                            .font(WZFont.mono(11)).foregroundStyle(t.faint)
                    }
                    if !cats.isEmpty {
                        FlowLayout(spacing: 6) {
                            ForEach(cats) { CategoryTag(category: $0) }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if ready {
                HStack(spacing: 7) {
                    WIcon("check", size: 13).foregroundStyle(t.green)
                    Text("Summary ready").font(WZFont.mono(11, .semibold)).foregroundStyle(t.green)
                    Spacer(minLength: 0)
                    if let at = digests.digest(for: day.key)?.summaryGeneratedAt {
                        Text(JournalFormat.generatedMeta(at)).font(WZFont.mono(10.5)).foregroundStyle(t.faint)
                    }
                }
            } else {
                GhostButton(title: "Generate summary", icon: "spark") { openDay(day.date) }
            }
        }
        .padding(16)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    // The known categories present among a day's notes, in the canonical display order.
    private func categories(in recs: [Recording]) -> [WZCategory] {
        let present = Set(DigestGrouping.groupByCategory(recs, order: WZCategories.all.map(\.id)).map(\.categoryID))
        return WZCategories.all.filter { present.contains($0.id) }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Spacer()
            WIcon("book", size: 32, weight: .regular).foregroundStyle(t.faint)
            Text("No journal yet").font(WZFont.ui(16, .semibold)).foregroundStyle(t.text)
            Text("Dictate a few notes and they’ll be grouped into a daily digest here.")
                .font(WZFont.ui(13.5)).foregroundStyle(t.muted).multilineTextAlignment(.center)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 40).padding(.bottom, 80)
    }
}

// Shared day/meta formatting for the journal screens.
enum JournalFormat {
    static func dayTitle(_ date: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(date) { return "Today" }
        if cal.isDateInYesterday(date) { return "Yesterday" }
        let f = DateFormatter()
        f.dateFormat = "EEE, MMM d"
        return f.string(from: date)
    }

    static func generatedMeta(_ date: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return "Generated \(f.localizedString(for: date, relativeTo: Date()))"
    }
}
