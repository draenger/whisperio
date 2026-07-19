import Foundation

/// Groups already-directory-assigned sync entries into the "journal book" buckets mirrored to
/// GitHub: one file per ISO week, and one file per topic (category) across all time.
///
/// This mirrors `JournalView.automaticBooks`' week/topic grouping intent, but is keyed on the
/// already-category-resolved `SyncItem` (not `Recording`) and organized as one file per ISO week
/// rather than month-with-week-chapters — per the codebase's "duplication with a mirrors-X
/// comment" convention (JournalView is mid-edit by another agent, so this is additive, not a
/// refactor of it).
public enum JournalGrouping {
    public typealias Entry = (item: SyncItem, dir: String)

    /// `YYYY-Www` for the ISO 8601 week (Monday-start) containing `date`, using a FIXED
    /// `Calendar(identifier: .iso8601)` + `GitHubPaths.timeZone` (not `Calendar.current`) so the
    /// same recording always mirrors to the same week file regardless of device region settings.
    public static func isoWeekKey(for date: Date) -> String {
        var cal = Calendar(identifier: .iso8601)
        cal.timeZone = GitHubPaths.timeZone
        let comps = cal.dateComponents([.yearForWeekOfYear, .weekOfYear], from: date)
        let year = comps.yearForWeekOfYear ?? 0
        let week = comps.weekOfYear ?? 0
        return String(format: "%04d-W%02d", year, week)
    }

    /// Every entry, bucketed by the ISO week its timestamp falls in.
    public static func byWeek(_ entries: [Entry]) -> [String: [Entry]] {
        Dictionary(grouping: entries) { isoWeekKey(for: $0.item.timestamp) }
    }

    /// Every entry with a known category, bucketed by categoryId — uncategorized notes are
    /// excluded (mirrors JournalView never showing an "uncategorized" shelf book).
    public static func byTopic(_ entries: [Entry]) -> [String: [Entry]] {
        Dictionary(grouping: entries.filter { $0.item.categoryId != uncategorizedCategoryID }) { $0.item.categoryId }
    }
}
