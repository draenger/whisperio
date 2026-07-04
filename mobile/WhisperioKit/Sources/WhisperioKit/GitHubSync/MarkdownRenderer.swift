import Foundation

/// Pure renderers turning sync models into the Markdown files committed to the repo. Every file
/// leads with YAML frontmatter (machine-readable metadata) then the human body. Timestamps are
/// ISO8601 in UTC so the frontmatter is stable across devices/time zones.
public enum MarkdownRenderer {
    /// ISO8601 timestamp in UTC (e.g. `2026-01-15T12:00:00Z`). Built per call — `ISO8601DateFormatter`
    /// isn't `Sendable`, so we never hold it in shared static state (matches `DigestPromptBuilder`).
    private static func isoString(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        // `created` is an absolute instant — keep it canonical UTC, independent of the LOCAL zone
        // GitHubPaths uses for day-bucket file/folder names.
        f.timeZone = TimeZone(identifier: "UTC")!
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: date)
    }

    /// Whitespace-delimited word count (spaces, tabs, newlines).
    public static func wordCount(_ text: String) -> Int {
        text.split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" || $0 == "\r" }).count
    }

    /// `transcript.md` — always emitted for a synced recording.
    public static func transcriptMarkdown(_ item: SyncItem) -> String {
        var lines = ["---"]
        lines.append("id: \(item.id.uuidString)")
        lines.append("type: transcript")
        lines.append("category: \(item.categoryId)")
        lines.append("created: \(isoString(item.timestamp))")
        if let provider = item.provider { lines.append("provider: \(provider.rawValue)") }
        lines.append("source: whisperio-ios")
        lines.append("duration_sec: \(Int(item.duration.rounded()))")
        lines.append("words: \(wordCount(item.transcript))")
        lines.append("---")
        lines.append("")
        lines.append(item.transcript)
        return lines.joined(separator: "\n") + "\n"
    }

    /// `render.md` — only when the recording has a non-empty AI render (nil otherwise, so the
    /// caller skips the file entirely rather than committing an empty render).
    public static func renderMarkdown(_ item: SyncItem) -> String? {
        guard let render = item.aiRender,
              !render.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        var lines = ["---"]
        lines.append("id: \(item.id.uuidString)")
        lines.append("type: render")
        lines.append("category: \(item.categoryId)")
        lines.append("created: \(isoString(item.timestamp))")
        if let provider = item.provider { lines.append("provider: \(provider.rawValue)") }
        lines.append("source: whisperio-ios")
        lines.append("---")
        lines.append("")
        lines.append(render)
        return lines.joined(separator: "\n") + "\n"
    }

    /// `YYYY-MM-DD-summary.md` — the daily synthesis. `categories` (optional) records which
    /// category buckets fed the summary; `source_ids` links back to the source recordings.
    public static func synthesisMarkdown(_ synthesis: DailySynthesis, categories: [String] = []) -> String {
        var lines = ["---"]
        lines.append("type: daily-synthesis")
        lines.append("date: \(GitHubPaths.daySlug(synthesis.date))")
        lines.append("created: \(isoString(synthesis.date))")
        lines.append("source: whisperio-ios")
        lines.append("recordings: \(synthesis.sourceIds.count)")
        lines.append("categories: [\(categories.joined(separator: ", "))]")
        lines.append("source_ids: [\(synthesis.sourceIds.map(\.uuidString).joined(separator: ", "))]")
        lines.append("---")
        lines.append("")
        lines.append(synthesis.body)
        return lines.joined(separator: "\n") + "\n"
    }
}
