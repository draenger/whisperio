import Foundation

/// Pure path derivation for the GitHub mirror. All timestamps are formatted in UTC so the repo
/// layout is stable regardless of the device's time zone (mirrors the digest day-bucketing).
///
/// Layout (under an optional `<prefix>`):
///   `<prefix>/<category>/<YYYY-MM-DD_HH-mm-xxxxxxxx>/transcript.md` (and `render.md`)
///   `<prefix>/<YYYY-MM-DD>-summary.md`  (daily synthesis)
public enum GitHubPaths {
    /// Fixed UTC time zone for every path component.
    public static let timeZone = TimeZone(identifier: "UTC")!

    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = timeZone
        f.dateFormat = format
        return f
    }

    /// `YYYY-MM-DD` in UTC.
    public static func daySlug(_ date: Date) -> String {
        formatter("yyyy-MM-dd").string(from: date)
    }

    /// `YYYY-MM-DD_HH-mm` in UTC.
    public static func minuteStamp(_ date: Date) -> String {
        formatter("yyyy-MM-dd_HH-mm").string(from: date)
    }

    /// First 8 hex chars of the UUID, lowercased (git-style short id).
    public static func shortID(_ id: UUID) -> String {
        String(id.uuidString.replacingOccurrences(of: "-", with: "").prefix(8)).lowercased()
    }

    /// Sanitize an odd category id into a single safe path segment: keep `[A-Za-z0-9-_]`, turn
    /// anything else (slashes, spaces, punctuation, emoji…) into `-`, collapse runs of `-`, and
    /// trim leading/trailing `-`. Empty/blank ids fall back to the shared uncategorized bucket.
    public static func sanitizeCategory(_ raw: String) -> String {
        let allowed = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
        var out = ""
        for ch in raw {
            out.append(allowed.contains(ch) ? ch : "-")
        }
        while out.contains("--") { out = out.replacingOccurrences(of: "--", with: "-") }
        out = out.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return out.isEmpty ? uncategorizedCategoryID : out
    }

    /// Per-recording folder name: `YYYY-MM-DD_HH-mm-<first8>`.
    public static func recordingFolderName(timestamp: Date, id: UUID) -> String {
        "\(minuteStamp(timestamp))-\(shortID(id))"
    }

    /// Join non-empty segments with `/`, trimming stray slashes so a prefix with or without a
    /// trailing `/` (or an empty prefix) all produce a clean path.
    public static func join(_ segments: [String]) -> String {
        segments
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }
            .filter { !$0.isEmpty }
            .joined(separator: "/")
    }

    /// Directory holding a recording's files.
    public static func recordingDir(prefix: String, categoryId: String, timestamp: Date, id: UUID) -> String {
        join([prefix, sanitizeCategory(categoryId), recordingFolderName(timestamp: timestamp, id: id)])
    }

    public static func transcriptPath(dir: String) -> String { "\(dir)/transcript.md" }
    public static func renderPath(dir: String) -> String { "\(dir)/render.md" }

    /// `<prefix>/YYYY-MM-DD-summary.md`.
    public static func synthesisPath(prefix: String, date: Date) -> String {
        join([prefix, "\(daySlug(date))-summary.md"])
    }

    /// Assign a unique directory to each item, in input order. Two recordings that would derive
    /// the same folder (same UTC minute *and* the same first-8 of their uuid) get a `-2`, `-3`…
    /// suffix so their files never overwrite each other.
    public static func assignRecordingDirs(_ items: [SyncItem], prefix: String) -> [(item: SyncItem, dir: String)] {
        var used = Set<String>()
        var out: [(item: SyncItem, dir: String)] = []
        out.reserveCapacity(items.count)
        for item in items {
            let base = recordingDir(prefix: prefix, categoryId: item.categoryId,
                                    timestamp: item.timestamp, id: item.id)
            var candidate = base
            var n = 2
            while used.contains(candidate) {
                candidate = "\(base)-\(n)"
                n += 1
            }
            used.insert(candidate)
            out.append((item, candidate))
        }
        return out
    }
}
