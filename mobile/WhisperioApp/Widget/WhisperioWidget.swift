import WidgetKit
import SwiftUI
import AppIntents
import WhisperioKit

// One-tap dictation triggers: a Home/Lock-Screen widget button and a Control
// Center control. Both run DictateIntent, which opens Whisperio straight into
// recording — no Back Tap setup needed.
//
// Plus the CONCEPT widgets from mob-triggers.jsx WidgetScene, all reading the
// real `SharedStore.WidgetSnapshot` the app writes on save (see
// RecordingsStore.refreshWidgetSnapshot / DigestStore.refreshWidgetSnapshotIfToday).
// A missing snapshot (fresh install, before the first save) renders an explicit
// empty state — never a fabricated number.

// Rezme teal accent (#1cc8b4) — matches WZTheme.rezmeTheme.accent. The widget extension
// doesn't link the app's SwiftUI module, so the value is mirrored here rather than imported.
private let wzAccent = Color(red: 28 / 255, green: 200 / 255, blue: 180 / 255)
private let wzAccentLite = Color(red: 108 / 255, green: 226 / 255, blue: 209 / 255)

struct DictateEntry: TimelineEntry { let date: Date }

struct DictateProvider: TimelineProvider {
    func placeholder(in context: Context) -> DictateEntry { DictateEntry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (DictateEntry) -> Void) {
        completion(DictateEntry(date: .now))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<DictateEntry>) -> Void) {
        completion(Timeline(entries: [DictateEntry(date: .now)], policy: .never))
    }
}

struct DictateWidgetView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Button(intent: DictateIntent()) {
            switch family {
            case .accessoryCircular:
                ZStack {
                    Circle()
                        .strokeBorder(.white.opacity(0.4), lineWidth: 1.5)
                        .frame(width: 34, height: 34)
                    Image(systemName: "mic.fill").font(.system(size: 22, weight: .bold))
                }
            case .accessoryRectangular:
                HStack(spacing: 6) {
                    Image(systemName: "mic.fill").font(.system(size: 16, weight: .bold))
                    Text("Dictate").font(.system(size: 15, weight: .semibold))
                }
            default:
                VStack(spacing: 8) {
                    Image(systemName: "mic.fill").font(.system(size: 30, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 64, height: 64)
                        .background(wzAccent, in: Circle())
                    Text("Dictate").font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.primary)
                }
            }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

struct DictateWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WhisperioDictate", provider: DictateProvider()) { _ in
            DictateWidgetView()
        }
        .configurationDisplayName("Dictate")
        .description("Tap to start a Whisperio dictation.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .systemSmall])
    }
}

@available(iOS 18.0, *)
struct DictateControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "WhisperioDictateControl") {
            ControlWidgetButton(action: DictateIntent()) {
                Label("Dictate", systemImage: "mic.fill")
            }
            // "mic in 34 r10 accent .16" — the Control Center tile tint. ControlWidgetButton
            // has no raw-opacity API; `.tint` is the closest supported hook and lets the
            // system render the accented background Control Center itself composites.
            .tint(wzAccent)
        }
        .displayName("Whisperio Dictate")
        .description("Start a Whisperio dictation.")
    }
}

// MARK: - Quick dictate (gradient small) — Concepts · Home Screen

// Purely a visual variant of the shipped Dictate button: same intent/action, a gradient
// background and a larger translucent mic circle instead of the solid teal fill. No new data.
struct QuickDictateWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WhisperioQuickDictate", provider: DictateProvider()) { _ in
            Button(intent: DictateIntent()) {
                VStack(spacing: 10) {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(.white.opacity(0.92))
                        .frame(width: 46, height: 46)
                        .background(.white.opacity(0.22), in: Circle())
                    Text("Quick dictate")
                        .font(.system(size: 17, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                }
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .containerBackground(for: .widget) {
                LinearGradient(colors: [wzAccent, wzAccentLite],
                                startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        }
        .configurationDisplayName("Quick Dictate")
        .description("Gradient one-tap dictation button.")
        .supportedFamilies([.systemSmall])
    }
}

// MARK: - Shared snapshot-backed provider — Concepts · This week / Recent / Today's digest / Lock Screen

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: SharedStore.WidgetSnapshot?
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry { SnapshotEntry(date: .now, snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: .now, snapshot: SharedStore.widgetSnapshot))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        // The app calls WidgetCenter.shared.reloadAllTimelines() every time it writes a new
        // snapshot (RecordingsStore/DigestStore), so a fresh timeline is requested exactly when
        // there's new data — `.never` here just means "don't guess in between".
        completion(Timeline(entries: [SnapshotEntry(date: .now, snapshot: SharedStore.widgetSnapshot)], policy: .never))
    }
}

// MARK: - "This week" stats small

struct WeekStatsWidgetView: View {
    let snapshot: SharedStore.WidgetSnapshot?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let snapshot {
                HStack(spacing: 4) {
                    Image(systemName: "sparkle").font(.system(size: 10.5, weight: .semibold))
                        .foregroundStyle(wzAccentLite)
                    Text("THIS WEEK")
                        .font(.system(size: 10.5, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                Text("\(snapshot.todayWordCount)")
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                Text("words · \(snapshot.currentStreak)-day streak")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 2)
                bars(snapshot.weeklyWordCounts)
            } else {
                Spacer()
                Text("No notes yet")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                Text("Dictate one to see stats here")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(.fill.tertiary, for: .widget)
    }

    @ViewBuilder
    private func bars(_ counts: [Int]) -> some View {
        let peak = counts.max() ?? 0
        HStack(alignment: .bottom, spacing: 4) {
            ForEach(Array(counts.enumerated()), id: \.offset) { _, value in
                let isPeak = peak > 0 && value == peak
                RoundedRectangle(cornerRadius: 2)
                    .fill(isPeak ? wzAccent : wzAccent.opacity(0.35))
                    .frame(height: peak > 0 ? max(3, CGFloat(value) / CGFloat(peak) * 28) : 3)
            }
        }
        .frame(height: 28, alignment: .bottom)
    }
}

struct WeekStatsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WhisperioWeekStats", provider: SnapshotProvider()) { entry in
            WeekStatsWidgetView(snapshot: entry.snapshot)
        }
        .configurationDisplayName("This Week")
        .description("Words dictated and your streak this week.")
        .supportedFamilies([.systemSmall])
    }
}

// MARK: - "Recent" medium (2-row recent recordings list)

struct RecentWidgetView: View {
    let snapshot: SharedStore.WidgetSnapshot?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "book.closed").font(.system(size: 14))
                Text("Recent").font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(.secondary)

            let rows = snapshot?.recentRecordings.prefix(2) ?? []
            if rows.isEmpty {
                Spacer()
                Text("No recordings yet")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                Spacer()
            } else {
                ForEach(Array(rows)) { row in
                    HStack(spacing: 10) {
                        Image(systemName: row.iconSystemName)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(wzAccent)
                            .frame(width: 26, height: 26)
                            .background(wzAccent.opacity(0.16), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        Text(row.title.isEmpty ? "Untitled note" : row.title)
                            .font(.system(size: 12.5))
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        Text(row.timestamp, style: .relative)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
                if rows.count < 2 { Spacer() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

struct RecentWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WhisperioRecent", provider: SnapshotProvider()) { entry in
            RecentWidgetView(snapshot: entry.snapshot)
        }
        .configurationDisplayName("Recent Notes")
        .description("Your most recent dictations.")
        .supportedFamilies([.systemMedium])
    }
}

// MARK: - "Today's digest" medium

struct TodayDigestWidgetView: View {
    let snapshot: SharedStore.WidgetSnapshot?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "sparkle").font(.system(size: 13)).foregroundStyle(wzAccentLite)
                Text("Today's digest").font(.system(size: 13, weight: .semibold))
                Spacer()
                Image(systemName: "lock.fill").font(.system(size: 9))
                    .foregroundStyle(.secondary)
            }
            if let text = snapshot?.digestText, !text.isEmpty {
                Text(text)
                    .font(.system(size: 13.5))
                    .lineSpacing(3)
                    .lineLimit(3)
                Spacer(minLength: 2)
                Text("\(snapshot?.digestNoteCount ?? 0) notes · \(snapshot?.digestCategoryCount ?? 0) categories")
                    .font(.system(size: 10.5))
                    .foregroundStyle(.secondary)
            } else {
                Spacer()
                Text("No digest yet today")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

struct TodayDigestWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WhisperioTodayDigest", provider: SnapshotProvider()) { entry in
            TodayDigestWidgetView(snapshot: entry.snapshot)
        }
        .configurationDisplayName("Today's Digest")
        .description("Your day's notes, summarized.")
        .supportedFamilies([.systemMedium])
    }
}

// MARK: - Lock Screen combo — accessoryRectangular, monochrome

// The rich gradient card in the mock (#2a2350→#0c1020, colored chips) isn't achievable as a
// literal Lock Screen widget — those families render monochrome only. Reinterpreted within
// that constraint: today's real note count + "Tap to review".
struct LockScreenDigestWidgetView: View {
    let snapshot: SharedStore.WidgetSnapshot?

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "book.closed.fill").font(.system(size: 13))
            if let count = snapshot?.digestNoteCount, count > 0 {
                Text("\(count) note\(count == 1 ? "" : "s") today · Tap to review")
                    .font(.system(size: 13, weight: .medium))
            } else {
                Text("No notes today")
                    .font(.system(size: 13, weight: .medium))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

struct LockScreenDigestWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WhisperioLockScreenDigest", provider: SnapshotProvider()) { entry in
            LockScreenDigestWidgetView(snapshot: entry.snapshot)
        }
        .configurationDisplayName("Today's Notes")
        .description("How many notes you've dictated today.")
        .supportedFamilies([.accessoryRectangular])
    }
}

// MARK: - StandBy-friendly systemSmall variant

// StandBy shows a user-picked systemSmall/systemMedium widget in landscape; this is a
// dedicated widget kind users add to their StandBy stack, rather than a context-detected
// branch of another widget. Clock + date are the real system clock (Text(_:style:) ticks
// live even from a static timeline) — no fabricated data.
struct StandByWidgetView: View {
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(Date(), style: .time)
                    .font(.system(size: 44, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6)
                Text(Date(), style: .date)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.5))
            }
            Spacer()
            Button(intent: DictateIntent()) {
                VStack(spacing: 4) {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 56, height: 56)
                        .background(
                            LinearGradient(colors: [wzAccent, wzAccentLite],
                                           startPoint: .top, endPoint: .bottom),
                            in: Circle()
                        )
                    Text("Dictate").font(.system(size: 10)).foregroundStyle(wzAccentLite)
                }
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(.black, for: .widget)
    }
}

struct StandByWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WhisperioStandBy", provider: DictateProvider()) { _ in
            StandByWidgetView()
        }
        .configurationDisplayName("Clock & Dictate")
        .description("Clock, date, and one-tap dictation — great for StandBy.")
        .supportedFamilies([.systemSmall])
    }
}

@main
struct WhisperioWidgetBundle: WidgetBundle {
    var body: some Widget {
        DictateWidget()
        QuickDictateWidget()
        WeekStatsWidget()
        RecentWidget()
        TodayDigestWidget()
        LockScreenDigestWidget()
        StandByWidget()
        if #available(iOS 18.0, *) {
            DictateControl()
        }
    }
}
