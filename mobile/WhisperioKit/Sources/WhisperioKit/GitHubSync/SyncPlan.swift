import Foundation

/// One file to write in a commit: its repo path, raw bytes, and the Git blob sha of those bytes
/// (precomputed for idempotency + reuse when building the GraphQL additions).
public struct FileChange: Sendable, Equatable {
    public let path: String
    public let contents: Data
    public let blobSha: String

    public init(path: String, contents: Data, blobSha: String) {
        self.path = path
        self.contents = contents
        self.blobSha = blobSha
    }
}

/// Pure planner: render the desired repo state (transcripts, renders, daily syntheses, and
/// journal week/topic books) and diff it against what the repo already holds, emitting only the
/// files that are new or changed.
public enum SyncPlan {
    /// Build the set of file changes to commit.
    /// - Parameters:
    ///   - items: recordings to mirror (transcript + optional render, plus journal week/topic books).
    ///   - syntheses: daily summaries to mirror.
    ///   - prefix: optional repo folder prefix (from settings).
    ///   - remoteBlobShas: map of repo path → Git blob sha already present in the repo. A file
    ///     whose freshly rendered blob sha matches its remote sha is skipped (idempotent).
    public static func build(
        items: [SyncItem],
        syntheses: [DailySynthesis],
        prefix: String = "",
        remoteBlobShas: [String: String] = [:]
    ) -> [FileChange] {
        var changes: [FileChange] = []

        let assigned = GitHubPaths.assignRecordingDirs(items, prefix: prefix)

        for (item, dir) in assigned {
            appendIfChanged(&changes,
                            path: GitHubPaths.transcriptPath(dir: dir),
                            text: MarkdownRenderer.transcriptMarkdown(item),
                            remote: remoteBlobShas)
            if let render = MarkdownRenderer.renderMarkdown(item) {
                appendIfChanged(&changes,
                                path: GitHubPaths.renderPath(dir: dir),
                                text: render,
                                remote: remoteBlobShas)
            }
        }

        for synthesis in syntheses {
            appendIfChanged(&changes,
                            path: GitHubPaths.synthesisPath(prefix: prefix, date: synthesis.date),
                            text: MarkdownRenderer.synthesisMarkdown(synthesis),
                            remote: remoteBlobShas)
        }

        // Journal books: one file per ISO week, one per topic — every entry links back to the
        // transcript.md this same pass assigned it.
        let weeksDir = GitHubPaths.join([prefix, "journal", "weeks"])
        let byWeek = JournalGrouping.byWeek(assigned)
        for weekKey in byWeek.keys.sorted() {
            let entries = (byWeek[weekKey] ?? [])
                .sorted { $0.item.timestamp < $1.item.timestamp }
                .map { (item: $0.item, link: GitHubPaths.relativePath(from: weeksDir, to: GitHubPaths.transcriptPath(dir: $0.dir))) }
            appendIfChanged(&changes,
                            path: GitHubPaths.journalWeekPath(prefix: prefix, weekKey: weekKey),
                            text: MarkdownRenderer.journalWeekMarkdown(weekKey: weekKey, entries: entries),
                            remote: remoteBlobShas)
        }

        let topicsDir = GitHubPaths.join([prefix, "journal", "topics"])
        let byTopic = JournalGrouping.byTopic(assigned)
        for categoryId in byTopic.keys.sorted() {
            let bucket = (byTopic[categoryId] ?? []).sorted { $0.item.timestamp < $1.item.timestamp }
            guard let categoryLabel = bucket.first?.item.categoryLabel else { continue }
            let entries = bucket.map { (item: $0.item, link: GitHubPaths.relativePath(from: topicsDir, to: GitHubPaths.transcriptPath(dir: $0.dir))) }
            appendIfChanged(&changes,
                            path: GitHubPaths.journalTopicPath(prefix: prefix, categoryId: categoryId),
                            text: MarkdownRenderer.journalTopicMarkdown(categoryId: categoryId, categoryLabel: categoryLabel, entries: entries),
                            remote: remoteBlobShas)
        }

        return changes
    }

    private static func appendIfChanged(
        _ changes: inout [FileChange],
        path: String,
        text: String,
        remote: [String: String]
    ) {
        let data = Data(text.utf8)
        let sha = GitBlob.sha1(data)
        guard remote[path] != sha else { return }   // unchanged — skip
        changes.append(FileChange(path: path, contents: data, blobSha: sha))
    }
}
