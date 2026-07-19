import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif
import WhisperioKit

// Weekly recap — port of the design's RecapScene, computed from the real library:
// words spoken this week, time saved vs typing, streak, per-day chart, category split,
// and the note of the week. Shareable as a rendered image card (matching the design's
// "recap card saved to Photos" affordance) with the text summary as caption/fallback.
struct RecapView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var recordings: RecordingsStore
    @EnvironmentObject private var settings: SettingsStore
    var onBack: () -> Void

#if canImport(UIKit)
    private typealias PlatformImage = UIImage
#elseif canImport(AppKit)
    private typealias PlatformImage = NSImage
#endif

    @State private var cardImage: PlatformImage?

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

    // MARK: - Usage & cost

    // Recordings persisted before engine-tracking shipped decode with `provider == nil`; we
    // exclude them rather than guessing which engine produced them, per the no-mock-data policy.
    private var engineWeekItems: [Recording] { weekItems.filter { $0.provider != nil && $0.duration > 0 } }

    // Minutes spoken this week, bucketed by the engine that actually transcribed them,
    // sorted by usage descending (deliberate choice — see plan open_questions).
    private var engineMinutes: [(provider: ProviderID, minutes: Double)] {
        var totals: [ProviderID: Double] = [:]
        for r in engineWeekItems { totals[r.provider!, default: 0] += r.duration / 60 }
        return totals.map { (provider: $0.key, minutes: $0.value) }.sorted { $0.minutes > $1.minutes }
    }

    private var totalEngineMinutes: Double { engineMinutes.reduce(0) { $0 + $1.minutes } }

    // Published per-minute list price for `provider`, using the sub-model currently configured
    // in Settings (Recording doesn't persist which sub-model transcribed a given clip, so this
    // is the closest real proxy available — documented approximation, not fabrication).
    private func rate(for provider: ProviderID) -> Double? {
        let s = settings.settings
        switch provider {
        case .onDevice:
            return 0
        case .openAI:
            // A non-default base URL means a self-hosted/custom endpoint — no published rate applies.
            guard s.openAIBaseURL.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            return ProviderPricing.ratePerMinuteUSD(provider: .openAI, model: s.whisperModel)
        case .elevenLabs:
            return ProviderPricing.ratePerMinuteUSD(provider: .elevenLabs, model: "")
        case .groq:
            return ProviderPricing.ratePerMinuteUSD(provider: .groq, model: s.groqModel)
        case .deepgram:
            return ProviderPricing.ratePerMinuteUSD(provider: .deepgram, model: s.deepgramModel)
        case .assemblyAI:
            return ProviderPricing.ratePerMinuteUSD(provider: .assemblyAI, model: s.assemblyAIModel)
        case .mistral:
            return ProviderPricing.ratePerMinuteUSD(provider: .mistral, model: s.mistralModel)
        }
    }

    private var totalCostUSD: Double {
        engineMinutes.reduce(0) { total, entry in
            guard entry.provider != .onDevice, let rate = rate(for: entry.provider) else { return total }
            return total + rate * entry.minutes
        }
    }

    // True when a cloud engine used this week has no known rate (custom/self-hosted model),
    // so the header total is a lower bound, not an exhaustive sum — the footnote flags this.
    private var hasUnknownRate: Bool {
        engineMinutes.contains { $0.provider != .onDevice && rate(for: $0.provider) == nil }
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

    // Renders the shareable recap card (hero + stat highlights) to a real UIImage via
    // ImageRenderer. This is the design's "recap card" artifact — an image, not just text.
    // The system share sheet's own "Save Image" action covers the design's "saved to Photos"
    // copy honestly, so we don't fabricate a separate save-confirmation toast.
    private func renderCard() {
        let card = RecapShareCard(
            t: t,
            weekLabel: weekLabel,
            totalWords: totalWords,
            noteCount: weekItems.count,
            minutesSaved: minutesSaved,
            speakingWPM: speakingWPM,
            streakCurrent: streaks.current,
            streakBest: streaks.best
        )
        let renderer = ImageRenderer(content: card)
#if canImport(UIKit)
        renderer.scale = UIScreen.main.scale
        cardImage = renderer.uiImage
#elseif canImport(AppKit)
        cardImage = renderer.nsImage
#endif
    }

    private var cardShareImage: Image? {
        guard let cardImage else { return nil }
#if canImport(UIKit)
        return Image(uiImage: cardImage)
#elseif canImport(AppKit)
        return Image(nsImage: cardImage)
#else
        return nil
#endif
    }

    @ViewBuilder
    private func shareButton<Label: View>(@ViewBuilder label: () -> Label) -> some View {
        if let cardShareImage {
            ShareLink(
                item: cardShareImage,
                preview: SharePreview(shareText, image: cardShareImage),
                label: label
            )
        } else {
            ShareLink(item: shareText, label: label)
        }
    }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Recap", onBack: onBack) {
                    shareButton {
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
                        if !engineMinutes.isEmpty { usageCostCard }
                        if !categoryCounts.isEmpty { categoriesCard }
                        if let note = noteOfWeek { noteCard(note) }
                        shareButton {
                            HStack(spacing: 8) {
                                WIcon("share", size: 17)
                                Text("Share recap")
                            }
                            .font(WZFont.ui(15, .semibold))
                            .foregroundStyle(t.primaryInk)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13).padding(.horizontal, 20)
                            .background(t.primary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .shadow(color: t.accent.opacity(0.45), radius: 8, y: 6)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 30)
                }
            }
        }
        .task { renderCard() }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(weekLabel)
                .font(WZFont.mono(10.5, .semibold)).tracking(1.5)
                .foregroundStyle(.white.opacity(0.85))
            Text(totalWords.formatted())
                .font(WZFont.display(46, .bold)).tracking(-0.9)
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
                    Text("peak \(peakName) · \(peak.1.formatted())")
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

    // The design's "Your ElevenLabs plan looks too big" credit-usage advisor block is
    // deliberately omitted here — Whisperio has no ElevenLabs (or any provider's) account/plan/
    // credit integration to compute it from honestly. Faking those credit numbers would be
    // exactly the fabricated-usage case the no-mock-data policy forbids, so this is a scoped
    // skip, not an oversight.
    private var usageCostCard: some View {
        let total = totalEngineMinutes
        return VStack(alignment: .leading, spacing: 11) {
            HStack {
                SectionLabel(text: "Usage & cost")
                Spacer(minLength: 0)
                (Text("\(Int(total.rounded())) min · ").foregroundColor(t.faint)
                    + Text(totalCostLabel).foregroundColor(t.accentLite))
                    .font(WZFont.mono(12))
            }
            ForEach(Array(engineMinutes.enumerated()), id: \.offset) { _, entry in
                engineRow(entry.provider, entry.minutes, total)
            }
            Text(usageFootnote)
                .font(WZFont.mono(10)).foregroundStyle(t.faint)
        }
        .padding(16)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    private func engineRow(_ provider: ProviderID, _ minutes: Double, _ total: Double) -> some View {
        VStack(spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(provider.displayName)
                    .font(WZFont.ui(12.5)).foregroundStyle(t.text)
                    .lineLimit(1).truncationMode(.tail)
                Spacer(minLength: 0)
                Text("\(Int(minutes.rounded())) min")
                    .font(WZFont.mono(10.5)).foregroundStyle(t.faint)
                Text(engineCostLabel(provider, minutes))
                    .font(WZFont.mono(10.5, .bold))
                    .foregroundStyle(engineCostLabel(provider, minutes) == "Free" ? t.green
                        : engineCostLabel(provider, minutes) == "—" ? t.faint : t.text)
                    .frame(width: 46, alignment: .trailing)
            }
            GeometryReader { geo in
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(engineColor(provider))
                    .frame(width: total > 0 ? geo.size.width * CGFloat(minutes / total) : 0)
            }
            .frame(height: 5)
            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 3, style: .continuous))
        }
    }

    private func engineColor(_ id: ProviderID) -> Color {
        switch id {
        case .onDevice: return t.green
        case .elevenLabs: return t.amber
        case .groq: return .hex(0x3da2f7)
        case .openAI: return .hex(0xa78bfa)
        // Deepgram/AssemblyAI/Mistral postdate the wz2 recap mock, so these 3 have no design
        // source — picked for hue separation from Groq's blue and OpenAI's purple. Flag for
        // design review before treating as final.
        case .deepgram: return .hex(0xd946ef)
        case .assemblyAI: return .hex(0xec4899)
        case .mistral: return .hex(0xfb7185)
        }
    }

    private func engineCostLabel(_ provider: ProviderID, _ minutes: Double) -> String {
        if provider == .onDevice { return "Free" }
        guard let rate = rate(for: provider) else { return "—" }
        let cost = rate * minutes
        if cost > 0 && cost < 0.01 { return "<$0.01" }
        return "$" + String(format: "%.2f", cost)
    }

    private var totalCostLabel: String {
        totalCostUSD > 0 ? "~$" + String(format: "%.2f", totalCostUSD) : "Free"
    }

    private var usageFootnote: String {
        var text = "Cloud engines are billed per audio minute at each provider's published rate. " +
            "On-device transcription is always free."
        if hasUnknownRate {
            text += " A custom or self-hosted model's cost isn't included in the total above."
        }
        return text
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

// The actual shareable artifact — a Spotify-Wrapped-style card built from the same real
// numbers as the on-screen recap (hero + two stat highlights), rendered off-screen via
// ImageRenderer and shared as an image instead of plain text.
private struct RecapShareCard: View {
    let t: WZTheme
    let weekLabel: String
    let totalWords: Int
    let noteCount: Int
    let minutesSaved: Int
    let speakingWPM: Int
    let streakCurrent: Int
    let streakBest: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 0) {
                Text(weekLabel)
                    .font(WZFont.mono(10.5, .semibold)).tracking(1.5)
                    .foregroundStyle(.white.opacity(0.85))
                Text(totalWords.formatted())
                    .font(WZFont.display(46, .bold)).tracking(-0.9)
                    .foregroundStyle(.white)
                    .padding(.top, 10)
                Text("words spoken · \(noteCount) note\(noteCount == 1 ? "" : "s")")
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

            HStack(spacing: 12) {
                shareStat(speakingWPM > 0 ? "\(speakingWPM) wpm" : "—", "speaking · you type ~38", "zap")
                shareStat("\(streakCurrent) day\(streakCurrent == 1 ? "" : "s")",
                          "streak · best is \(streakBest)", "spark")
            }

            HStack(spacing: 6) {
                WIcon("mic", size: 13).foregroundStyle(t.muted)
                Text("Whisperio").font(WZFont.mono(11, .semibold)).tracking(0.5).foregroundStyle(t.muted)
            }
            .padding(.top, 2)
        }
        .padding(18)
        .frame(width: 340, alignment: .leading)
        .background(t.bg)
    }

    private func shareStat(_ big: String, _ sub: String, _ icon: String) -> some View {
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
}
