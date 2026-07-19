import SwiftUI
import WhisperioKit

// Weekly recap — port of the design's RecapScene, computed from the real library:
// words spoken this week, time saved vs typing, streak, per-day chart, category split,
// and the note of the week. Shareable as plain text.
struct RecapView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var recordings: RecordingsStore
    var onBack: () -> Void

    private static let typingWPM = 38.0

    private var calendar: Calendar {
        var c = Calendar.current
        c.firstWeekday = 2   // design chart runs Mon–Sun
        return c
    }

    private var week: DateInterval {
        calendar.dateInterval(of: .weekOfYear, for: Date())
            ?? DateInterval(start: Date().addingTimeInterval(-7 * 24 * 3600), duration: 7 * 24 * 3600)
    }

    private var weekItems: [Recording] {
        recordings.items.filter { week.contains($0.timestamp) && $0.transcription != nil }
    }

    private func wordCount(_ r: Recording) -> Int {
        (r.transcription ?? "").split { $0.isWhitespace || $0.isNewline }.count
    }

    private var totalWords: Int { weekItems.reduce(0) { $0 + wordCount($1) } }
    private var totalMinutesSpoken: Double { weekItems.reduce(0) { $0 + $1.duration } / 60 }

    private var speakingWPM: Int {
        totalMinutesSpoken > 0.05 ? Int((Double(totalWords) / totalMinutesSpoken).rounded()) : 0
    }

    private var minutesSaved: Int {
        let typingMinutes = Double(totalWords) / Self.typingWPM
        return max(0, Int((typingMinutes - totalMinutesSpoken).rounded()))
    }

    // (weekday letter, words) for Mon…Sun of the current week.
    private var perDay: [(String, Int)] {
        let letters = ["M", "T", "W", "T", "F", "S", "S"]
        var buckets = [Int](repeating: 0, count: 7)
        for r in weekItems {
            let day = calendar.dateComponents([.day], from: week.start,
                                              to: calendar.startOfDay(for: r.timestamp)).day ?? 0
            if (0..<7).contains(day) { buckets[day] += wordCount(r) }
        }
        return Array(zip(letters, buckets))
    }

    // Days-with-a-note streaks (all-time): current (ending today/yesterday) and best.
    private var streaks: (current: Int, best: Int) {
        let days = Set(recordings.items.map { calendar.startOfDay(for: $0.timestamp) })
        guard !days.isEmpty else { return (0, 0) }
        var best = 0
        for day in days where !days.contains(calendar.date(byAdding: .day, value: -1, to: day)!) {
            var length = 1
            var next = calendar.date(byAdding: .day, value: 1, to: day)!
            while days.contains(next) {
                length += 1
                next = calendar.date(byAdding: .day, value: 1, to: next)!
            }
            best = max(best, length)
        }
        var current = 0
        var probe = calendar.startOfDay(for: Date())
        if !days.contains(probe) { probe = calendar.date(byAdding: .day, value: -1, to: probe)! }
        while days.contains(probe) {
            current += 1
            probe = calendar.date(byAdding: .day, value: -1, to: probe)!
        }
        return (current, best)
    }

    // Category → note count for this week, biggest first.
    private var categoryCounts: [(WZCategory, Int)] {
        var counts: [String: Int] = [:]
        for r in weekItems { counts[r.category ?? WZCategories.work.id, default: 0] += 1 }
        return counts
            .map { (WZCategories.of($0.key), $0.value) }
            .sorted { $0.1 > $1.1 }
    }

    private var noteOfWeek: Recording? {
        weekItems.max { wordCount($0) < wordCount($1) }
    }

    private var weekLabel: String {
        let df = DateFormatter()
        df.dateFormat = "MMM d"
        let weekNo = calendar.component(.weekOfYear, from: Date())
        let end = week.end.addingTimeInterval(-1)
        return "WEEK \(weekNo) · \(df.string(from: week.start))–\(df.string(from: end))".uppercased()
    }

    private var shareText: String {
        "My week with Whisperio — \(totalWords) words spoken across \(weekItems.count) notes, ~\(minutesSaved) minutes saved vs typing. \(streaks.current)-day streak."
    }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Recap", onBack: onBack) {
                    ShareLink(item: shareText) {
                        WIcon("share", size: 19, weight: .regular)
                            .foregroundStyle(t.muted)
                            .frame(width: 38, height: 38)
                            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 14) {
                        heroCard
                        HStack(spacing: 12) {
                            statCard(speakingWPM > 0 ? "\(speakingWPM) wpm" : "—",
                                     "speaking · you type ~38", "zap")
                            statCard("\(streaks.current) day\(streaks.current == 1 ? "" : "s")",
                                     "streak · best is \(streaks.best)", "spark")
                        }
                        chartCard
                        if !categoryCounts.isEmpty { categoriesCard }
                        if let note = noteOfWeek { noteCard(note) }
                        ShareLink(item: shareText) {
                            HStack(spacing: 8) {
                                WIcon("share", size: 17)
                                Text("Share recap")
                            }
                            .font(WZFont.ui(15, .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13).padding(.horizontal, 20)
                            .background(t.gradient, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .shadow(color: t.accent.opacity(0.5), radius: 12, y: 8)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 30)
                }
            }
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(weekLabel)
                .font(WZFont.mono(10.5, .semibold)).tracking(1.5)
                .foregroundStyle(.white.opacity(0.85))
            Text("\(totalWords)")
                .font(WZFont.display(46, .bold))
                .foregroundStyle(.white)
                .padding(.top, 10)
            Text("words spoken · \(weekItems.count) note\(weekItems.count == 1 ? "" : "s")")
                .font(WZFont.ui(14)).foregroundStyle(.white.opacity(0.92))
                .padding(.top, 3)
            HStack(spacing: 8) {
                WIcon("bolt", size: 15)
                Text("~\(minutesSaved) minutes saved vs typing")
                    .font(WZFont.ui(13, .semibold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 13).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white.opacity(0.16), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .padding(.top, 16)
        }
        .padding(.horizontal, 20).padding(.vertical, 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.gradient, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func statCard(_ big: String, _ sub: String, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            WIcon(icon, size: 16).foregroundStyle(t.accentLite)
            Text(big).font(WZFont.display(22, .bold)).foregroundStyle(t.text).padding(.top, 6)
            Text(sub).font(WZFont.ui(12)).foregroundStyle(t.muted)
        }
        .padding(15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    private var chartCard: some View {
        let days = perDay
        let maxWords = max(days.map(\.1).max() ?? 0, 1)
        let peak = days.max { $0.1 < $1.1 }
        let weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        let peakName = days.firstIndex { $0.1 == (peak?.1 ?? 0) }.map { weekdayNames[$0] } ?? "—"
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                SectionLabel(text: "Words per day")
                Spacer(minLength: 0)
                if let peak, peak.1 > 0 {
                    Text("peak \(peakName) · \(peak.1)")
                        .font(WZFont.mono(11)).foregroundStyle(t.faint)
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                ForEach(Array(days.enumerated()), id: \.offset) { _, day in
                    VStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(day.1 == maxWords && day.1 > 0 ? t.accent : t.accent.opacity(0.3))
                            .frame(height: max(4, 72 * CGFloat(day.1) / CGFloat(maxWords)))
                            .frame(maxHeight: 72, alignment: .bottom)
                        Text(day.0)
                            .font(WZFont.mono(10))
                            .foregroundStyle(day.1 == maxWords && day.1 > 0 ? t.accentLite : t.faint)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 92, alignment: .bottom)
        }
        .padding(16)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    private var categoriesCard: some View {
        let cats = categoryCounts
        let top = max(cats.first?.1 ?? 1, 1)
        return VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Where your words went")
            ForEach(Array(cats.enumerated()), id: \.offset) { _, entry in
                HStack(spacing: 10) {
                    CategoryTag(category: entry.0).frame(width: 96, alignment: .leading)
                    GeometryReader { geo in
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(entry.0.hue(t).opacity(0.75))
                            .frame(width: geo.size.width * CGFloat(entry.1) / CGFloat(top))
                    }
                    .frame(height: 7)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                    Text("\(entry.1)")
                        .font(WZFont.mono(11)).foregroundStyle(t.muted)
                        .frame(width: 22, alignment: .trailing)
                }
            }
        }
        .padding(16)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    private func noteCard(_ note: Recording) -> some View {
        let df = DateFormatter()
        df.dateFormat = "EEEE"
        let text = (note.transcription ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let preview = text.count > 160 ? String(text.prefix(160)) + "…" : text
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                SectionLabel(text: "Note of the week")
                Spacer(minLength: 0)
                CategoryTag(category: WZCategories.of(note.category ?? WZCategories.work.id))
            }
            Text("“\(preview)”")
                .font(WZFont.display(16.5, .medium)).foregroundStyle(t.text).lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(wordCount(note)) words · \(df.string(from: note.timestamp))")
                .font(WZFont.mono(10.5)).foregroundStyle(t.faint)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }
}
