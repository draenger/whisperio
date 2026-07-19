import Foundation

/// Pure path derivation for the GitHub mirror. Timestamps are formatted in the device's LOCAL
/// time zone so the mirrored day matches the digest/journal, which bucket days with
/// `Calendar.current` — otherwise a note captured near midnight would land in the app under one
/// day but its `-summary.md` file under the previous (UTC) day.
///
/// Layout (under an optional `<prefix>`):
///   `<prefix>/<category>/<YYYY-MM-DD_HH-mm-xxxxxxxx>/transcript.md` (and `render.md`)
///   `<prefix>/<YYYY-MM-DD>-summary.md`  (daily synthesis)
public enum GitHubPaths {
    /// Local time zone for every path component — kept in sync with the digest's `Calendar.current`.
    public static let timeZone = TimeZone.current

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

    /// `<prefix>/journal/weeks/<weekKey>.md` — one file per ISO week.
    public static func journalWeekPath(prefix: String, weekKey: String) -> String {
        join([prefix, "journal", "weeks", "\(weekKey).md"])
    }

    /// `<prefix>/journal/topics/<sanitized-category>.md` — one file per topic, across all time.
    public static func journalTopicPath(prefix: String, categoryId: String) -> String {
        join([prefix, "journal", "topics", "\(sanitizeCategory(categoryId)).md"])
    }

    /// A relative path from a directory to a target file, so a journal book can link to the exact
    /// `transcript.md` emitted the same pass regardless of `prefix` depth. Splits both on `/`, walks
    /// up past the shared prefix with `..` for each remaining `sourceDir` segment, then appends the
    /// remaining `targetPath` segments (including its filename). `journal/weeks/*` and
    /// `journal/topics/*` sit at the SAME depth under `<prefix>` as `<prefix>/<category>/<folder>/`,
    /// so this always walks exactly `../..` today, but the general helper stays correct if that
    /// ever changes.
    public static func relativePath(from sourceDir: String, to targetPath: String) -> String {
        let sourceParts = sourceDir.split(separator: "/").map(String.init)
        let targetParts = targetPath.split(separator: "/").map(String.init)
        var shared = 0
        while shared < sourceParts.count, shared < targetParts.count - 1,
              sourceParts[shared] == targetParts[shared] {
            shared += 1
        }
        let ups = Array(repeating: "..", count: sourceParts.count - shared)
        let downs = targetParts[shared...]
        return (ups + downs).joined(separator: "/")
    }
}
