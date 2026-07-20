import Foundation

// Digest grouping — the pure logic that turns a flat list of recordings into per-day, per-category
// buckets for the daily digest. Everything here injects its Calendar so day boundaries (and hence
// tests) are deterministic across time zones and DST; nothing touches the network or the clock.

/// The bucket id used for recordings with no category (nil) or an unknown one.
public let uncategorizedCategoryID = "uncategorized"

public enum DigestGrouping {
    /// The day key (YYYY-MM-DD) for a date under the given calendar. The calendar's `timeZone`
    /// decides which calendar day the instant falls on, so callers control the boundary.
    public static func dayKey(for date: Date, calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        // Pad to a stable, sortable YYYY-MM-DD regardless of locale.
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Bucket recordings by their day key (YYYY-MM-DD) under the injected calendar.
    public static func bucketByDay(_ recordings: [Recording], calendar: Calendar) -> [String: [Recording]] {
        var out: [String: [Recording]] = [:]
        for rec in recordings {
            out[dayKey(for: rec.timestamp, calendar: calendar), default: []].append(rec)
        }
        return out
    }

    /// Group one day's recordings into DigestGroups by category, preserving the passed-in category
    /// `order`. A category with no recordings is omitted. Recordings whose category is nil or not in
    /// `order` fall into a trailing "uncategorized" group (only emitted when non-empty).
    public static func groupByCategory(_ dayRecordings: [Recording], order: [String]) -> [DigestGroup] {
        // Index recordings by resolved category id (unknown/nil → uncategorized), keeping order.
        var byCategory: [String: [UUID]] = [:]
        let known = Set(order)
        for rec in dayRecordings {
            let resolved = (rec.category.flatMap { known.contains($0) ? $0 : nil }) ?? uncategorizedCategoryID
            byCategory[resolved, default: []].append(rec.id)
        }

        var out: [DigestGroup] = []
        for categoryID in order {
            if let ids = byCategory[categoryID], !ids.isEmpty {
                out.append(DigestGroup(categoryID: categoryID, recordingIDs: ids))
            }
        }
        if let ids = byCategory[uncategorizedCategoryID], !ids.isEmpty {
            out.append(DigestGroup(categoryID: uncategorizedCategoryID, recordingIDs: ids))
        }
        return out
    }

    /// The recordings with no category assigned (nil). Note: this is by the raw `category` field —
    /// an unknown-but-present id is not "uncategorized" here; groupByCategory handles that mapping.
    public static func uncategorized(_ recordings: [Recording]) -> [Recording] {
        recordings.filter { $0.category == nil }
    }

    // MARK: - Digest source filter (H4)

    /// Whether `source` counts as "in-app" for `DigestSourceMode.appOnly`: the real in-app
    /// dictation channels (`"app"` — in-app record or Scratchpad; `"mic"` — Conversation) plus
    /// nil (recordings persisted before the `source` field existed were all in-app back then, and
    /// `DemoRecording` already treats nil the same way — `r.source ?? "app"`). Keyboard, Watch,
    /// Action Button and Back-Tap notes are excluded — they stay in the library, just out of the
    /// auto-summarized digest. `.all` never calls this (nothing is filtered); `.manual` uses an
    /// explicit per-day picked set instead (`DigestStore.generate`'s `allowedSources`).
    public static func isAppSource(_ source: String?) -> Bool {
        guard let source else { return true }
        return source == "app" || source == "mic"
    }
}
