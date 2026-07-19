import Testing
import Foundation
@testable import WhisperioKit

@Suite struct GitHubSyncTests {
    // 2026-01-15T12:00:00Z (also used by the digest tests).
    private static let noon = Date(timeIntervalSince1970: 1_768_478_400)

    private func item(
        id: UUID,
        category: String = "work",
        label: String = "Work",
        timestamp: Date = noon,
        provider: ProviderID? = .openAI,
        transcript: String = "hello world",
        aiRender: String? = nil,
        duration: TimeInterval = 12
    ) -> SyncItem {
        SyncItem(id: id, categoryId: category, categoryLabel: label, timestamp: timestamp,
                 provider: provider, transcript: transcript, aiRender: aiRender, duration: duration)
    }

    // MARK: - Path derivation

    // Format a date in the SAME local zone the paths use, so these assertions stay deterministic on
    // any host while still exercising the join/short-id/sanitize/collision structure.
    private static func stamp(_ date: Date, _ fmt: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = fmt
        return f.string(from: date)
    }

    @Test func recordingPathIsLocalMinuteAndUUIDShort() {
        let ts = Date(timeIntervalSince1970: 1_768_449_600)
        let id = UUID(uuidString: "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8")!
        let min = Self.stamp(ts, "yyyy-MM-dd_HH-mm")
        let dir = GitHubPaths.recordingDir(prefix: "notes", categoryId: "work", timestamp: ts, id: id)
        #expect(dir == "notes/work/\(min)-6f1a2b3c")
        #expect(GitHubPaths.transcriptPath(dir: dir) == "notes/work/\(min)-6f1a2b3c/transcript.md")
        #expect(GitHubPaths.renderPath(dir: dir) == "notes/work/\(min)-6f1a2b3c/render.md")
    }

    @Test func emptyPrefixOmitsLeadingSlash() {
        let id = UUID(uuidString: "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8")!
        let min = Self.stamp(Self.noon, "yyyy-MM-dd_HH-mm")
        let dir = GitHubPaths.recordingDir(prefix: "", categoryId: "work", timestamp: Self.noon, id: id)
        #expect(dir == "work/\(min)-6f1a2b3c")
    }

    @Test func prefixTrailingSlashIsNormalized() {
        let id = UUID(uuidString: "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8")!
        let min = Self.stamp(Self.noon, "yyyy-MM-dd_HH-mm")
        let dir = GitHubPaths.recordingDir(prefix: "/vault/", categoryId: "work", timestamp: Self.noon, id: id)
        #expect(dir == "vault/work/\(min)-6f1a2b3c")
    }

    @Test func synthesisPathIsDaySlug() {
        let day = Self.stamp(Self.noon, "yyyy-MM-dd")
        #expect(GitHubPaths.synthesisPath(prefix: "notes", date: Self.noon) == "notes/\(day)-summary.md")
        #expect(GitHubPaths.synthesisPath(prefix: "", date: Self.noon) == "\(day)-summary.md")
    }

    @Test func oddCategoryIdsAreSanitized() {
        #expect(GitHubPaths.sanitizeCategory("Work / Personal") == "Work-Personal")
        #expect(GitHubPaths.sanitizeCategory("../etc/passwd") == "etc-passwd")
        #expect(GitHubPaths.sanitizeCategory("café ☕️ notes") == "caf-notes")
        #expect(GitHubPaths.sanitizeCategory("") == "uncategorized")
        #expect(GitHubPaths.sanitizeCategory("///") == "uncategorized")
    }

    @Test func collisionGetsNumericSuffix() {
        // Two uuids sharing the same first-8 hex, same minute → the second folder is suffixed.
        let a = UUID(uuidString: "6F1A2B3C-0000-4000-8000-000000000001")!
        let b = UUID(uuidString: "6F1A2B3C-0000-4000-8000-000000000002")!
        let min = Self.stamp(Self.noon, "yyyy-MM-dd_HH-mm")
        let assigned = GitHubPaths.assignRecordingDirs([item(id: a), item(id: b)], prefix: "notes")
        #expect(assigned[0].dir == "notes/work/\(min)-6f1a2b3c")
        #expect(assigned[1].dir == "notes/work/\(min)-6f1a2b3c-2")
    }

    // MARK: - Markdown rendering

    @Test func transcriptFrontmatterAndWordCount() {
        let id = UUID(uuidString: "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8")!
        let md = MarkdownRenderer.transcriptMarkdown(
            item(id: id, transcript: "one two three four", duration: 12.6))
        #expect(md.contains("id: 6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8"))
        #expect(md.contains("type: transcript"))
        #expect(md.contains("category: work"))
        #expect(md.contains("created: 2026-01-15T12:00:00Z"))
        #expect(md.contains("provider: openai"))
        #expect(md.contains("source: whisperio-ios"))
        #expect(md.contains("duration_sec: 13"))   // 12.6 rounds to 13
        #expect(md.contains("words: 4"))
        #expect(md.hasSuffix("one two three four\n"))
    }

    @Test func transcriptOmitsProviderWhenNil() {
        let md = MarkdownRenderer.transcriptMarkdown(item(id: UUID(), provider: nil))
        #expect(!md.contains("provider:"))
    }

    @Test func renderOmittedWhenNoAIRender() {
        #expect(MarkdownRenderer.renderMarkdown(item(id: UUID(), aiRender: nil)) == nil)
        #expect(MarkdownRenderer.renderMarkdown(item(id: UUID(), aiRender: "   \n ")) == nil)
    }

    @Test func renderEmittedWhenAIRenderPresent() {
        let id = UUID(uuidString: "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8")!
        let md = MarkdownRenderer.renderMarkdown(item(id: id, aiRender: "# Polished\n\nBody."))
        #expect(md != nil)
        #expect(md!.contains("type: render"))
        #expect(md!.contains("id: 6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8"))
        #expect(md!.hasSuffix("# Polished\n\nBody.\n"))
        // Render has no duration/words frontmatter.
        #expect(!md!.contains("words:"))
    }

    @Test func synthesisFrontmatter() {
        let id1 = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let id2 = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let s = DailySynthesis(date: Self.noon, body: "A productive day.", sourceIds: [id1, id2])
        let md = MarkdownRenderer.synthesisMarkdown(s, categories: ["work", "ideas"])
        #expect(md.contains("type: daily-synthesis"))
        #expect(md.contains("date: 2026-01-15"))
        #expect(md.contains("recordings: 2"))
        #expect(md.contains("categories: [work, ideas]"))
        #expect(md.contains("source_ids: [11111111-1111-4111-8111-111111111111, 22222222-2222-4222-8222-222222222222]"))
        #expect(md.hasSuffix("A productive day.\n"))
    }

    // MARK: - Git blob sha (known git vectors)

    @Test func blobShaMatchesGitVectors() {
        // Verified with `git hash-object --stdin`.
        #expect(GitBlob.sha1(Data()) == "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391")
        #expect(GitBlob.sha1("hello\n") == "ce013625030ba8dba906f756967f9e9ca394464a")
        #expect(GitBlob.sha1("what is up, doc?") == "bd9dbf5aae1a3862dd1526723246b20206e5fc37")
    }

    // MARK: - SyncPlan diffing

    @Test func syncPlanEmitsTranscriptAndRender() {
        let id = UUID(uuidString: "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8")!
        let changes = SyncPlan.build(
            items: [item(id: id, aiRender: "polished")],
            syntheses: [DailySynthesis(date: Self.noon, body: "summary", sourceIds: [id])],
            prefix: "notes")
        let paths = Set(changes.map(\.path))
        let min = Self.stamp(Self.noon, "yyyy-MM-dd_HH-mm")
        let day = Self.stamp(Self.noon, "yyyy-MM-dd")
        let weekKey = JournalGrouping.isoWeekKey(for: Self.noon)
        #expect(paths.contains("notes/work/\(min)-6f1a2b3c/transcript.md"))
        #expect(paths.contains("notes/work/\(min)-6f1a2b3c/render.md"))
        #expect(paths.contains("notes/\(day)-summary.md"))
        #expect(paths.contains("notes/journal/weeks/\(weekKey).md"))
        #expect(paths.contains("notes/journal/topics/work.md"))
        #expect(changes.count == 5)
    }

    @Test func syncPlanSkipsUnchangedFiles() {
        let id = UUID(uuidString: "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8")!
        let one = item(id: id)
        // First pass: nothing remote, so the transcript plus its journal week/topic books are
        // emitted with their blob shas.
        let first = SyncPlan.build(items: [one], syntheses: [], prefix: "notes")
        #expect(first.count == 3)
        // Feed those blob shas back as the remote state — everything identical is now skipped.
        var remote: [String: String] = [:]
        for c in first { remote[c.path] = c.blobSha }
        let second = SyncPlan.build(items: [one], syntheses: [], prefix: "notes", remoteBlobShas: remote)
        #expect(second.isEmpty)
        // A changed transcript re-emits (different bytes → different blob sha) — and so do its
        // journal week/topic books, since their rendered excerpt line changed too.
        let edited = item(id: id, transcript: "changed text")
        let third = SyncPlan.build(items: [edited], syntheses: [], prefix: "notes", remoteBlobShas: remote)
        #expect(third.count == 3)
    }

    // MARK: - Journal book grouping/rendering

    // Builds a date via DateComponents in a plain Gregorian calendar with the CURRENT (not
    // epoch-based) timezone, so the asserted local calendar date is deterministic regardless of
    // the CI host's timezone — verified against Python's `datetime.isocalendar()`: 2026-01-15 is
    // ISO week 3, and 2025-12-29 is ISO week 1 of 2026 (a year-rollover case).
    private func localDate(_ y: Int, _ m: Int, _ d: Int, _ h: Int) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        var c = DateComponents()
        c.year = y; c.month = m; c.day = d; c.hour = h
        return cal.date(from: c)!
    }

    @Test func relativePathWalksUpToCommonAncestor() {
        #expect(GitHubPaths.relativePath(from: "notes/journal/weeks", to: "notes/work/x/transcript.md")
                 == "../../work/x/transcript.md")
        #expect(GitHubPaths.relativePath(from: "journal/weeks", to: "work/x/transcript.md")
                 == "../../work/x/transcript.md")
    }

    @Test func isoWeekKeyMatchesKnownWeek() {
        #expect(JournalGrouping.isoWeekKey(for: localDate(2026, 1, 15, 12)) == "2026-W03")
    }

    @Test func isoWeekKeyRollsIntoNextYearAtBoundary() {
        #expect(JournalGrouping.isoWeekKey(for: localDate(2025, 12, 29, 12)) == "2026-W01")
    }

    @Test func journalWeekMarkdownListsEntryWithLink() {
        let md = MarkdownRenderer.journalWeekMarkdown(
            weekKey: "2026-W03",
            entries: [(item: item(id: UUID()), link: "../../work/x/transcript.md")])
        #expect(md.contains("type: journal-week"))
        #expect(md.contains("week: 2026-W03"))
        #expect(md.contains("notes: 1"))
        #expect(md.contains("[hello world](../../work/x/transcript.md)"))
    }

    @Test func journalTopicMarkdownListsEntryWithLink() {
        let md = MarkdownRenderer.journalTopicMarkdown(
            categoryId: "work", categoryLabel: "Work",
            entries: [(item: item(id: UUID()), link: "../../work/x/transcript.md")])
        #expect(md.contains("type: journal-topic"))
        #expect(md.contains("category: work"))
        #expect(md.contains("notes: 1"))
        #expect(md.contains("# Work"))
        #expect(md.contains("[hello world](../../work/x/transcript.md)"))
    }

    @Test func journalEntryExcerptIsClippedToOneLine() {
        let longTranscript = String(repeating: "a", count: 60) + "\n" + String(repeating: "b", count: 60)
        let md = MarkdownRenderer.journalWeekMarkdown(
            weekKey: "2026-W03",
            entries: [(item: item(id: UUID(), transcript: longTranscript), link: "x.md")])
        #expect(md.contains("…"))
        // Exactly one list line for the single entry — the embedded newline was flattened to a
        // space rather than becoming a second Markdown list line.
        let listLines = md.components(separatedBy: "\n").filter { $0.hasPrefix("- **") }
        #expect(listLines.count == 1)
        #expect(listLines[0].contains(String(repeating: "a", count: 60)))
    }

    @Test func syncPlanEmitsJournalWeekAndTopicBooks() {
        let a = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let b = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let weekKey = JournalGrouping.isoWeekKey(for: Self.noon)
        let changes = SyncPlan.build(items: [item(id: a), item(id: b)], syntheses: [], prefix: "notes")
        let paths = Set(changes.map(\.path))
        #expect(paths.contains("notes/journal/weeks/\(weekKey).md"))
        #expect(paths.contains("notes/journal/topics/work.md"))
        let topicFile = changes.first { $0.path == "notes/journal/topics/work.md" }
        #expect(topicFile.map { String(data: $0.contents, encoding: .utf8) ?? "" }?.contains("notes: 2") == true)
    }

    @Test func uncategorizedExcludedFromTopicBooksButKeptInWeekBook() {
        let changes = SyncPlan.build(
            items: [item(id: UUID(), category: uncategorizedCategoryID, label: "Uncategorized")],
            syntheses: [], prefix: "notes")
        let paths = changes.map(\.path)
        #expect(!paths.contains { $0.hasPrefix("notes/journal/topics/") })
        #expect(paths.contains { $0.hasPrefix("notes/journal/weeks/") })
    }

    @Test func journalBooksAreIdempotentThenGrowOnNewEntry() {
        let id = UUID(uuidString: "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8")!
        let one = item(id: id)
        // First pass: capture blob shas for ALL paths (transcript + the two new journal files).
        let first = SyncPlan.build(items: [one], syntheses: [], prefix: "notes")
        var remoteBlobShas: [String: String] = [:]
        for c in first { remoteBlobShas[c.path] = c.blobSha }

        // Second pass: same item, same remote shas → nothing changed.
        let second = SyncPlan.build(items: [one], syntheses: [], prefix: "notes", remoteBlobShas: remoteBlobShas)
        #expect(second.isEmpty)

        // Third pass: a second same-week/same-topic item — the journal books grow, but the
        // FIRST item's own transcript.md is untouched (proving the rebuild didn't force a
        // spurious re-diff of unrelated files).
        let secondID = UUID(uuidString: "7A2B3C4D-5E6F-4081-92A3-B4C5D6E7F8A9")!
        let two = item(id: secondID)
        let third = SyncPlan.build(items: [one, two], syntheses: [], prefix: "notes", remoteBlobShas: remoteBlobShas)
        let thirdPaths = Set(third.map(\.path))
        #expect(thirdPaths.contains { $0.hasPrefix("notes/journal/weeks/") })
        #expect(thirdPaths.contains { $0.hasPrefix("notes/journal/topics/") })
        #expect(!thirdPaths.contains { $0.hasSuffix("/transcript.md") && $0.contains("6f1a2b3c") })
    }

    // MARK: - GitHubClient request shape via mock transport (no network)

    /// Captures the last request and returns a canned response.
    final class MockTransport: GitHubTransport, @unchecked Sendable {
        var lastRequest: URLRequest?
        let responseData: Data
        let status: Int
        init(responseData: Data, status: Int = 200) {
            self.responseData = responseData
            self.status = status
        }
        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            lastRequest = request
            let http = HTTPURLResponse(url: request.url!, statusCode: status,
                                       httpVersion: nil, headerFields: nil)!
            return (responseData, http)
        }
    }

    @Test func createCommitBuildsGraphQLRequest() async throws {
        let ok = Data(#"{"data":{"createCommitOnBranch":{"commit":{"oid":"deadbeef"}}}}"#.utf8)
        let mock = MockTransport(responseData: ok)
        let client = GitHubClient(owner: "octocat", repo: "notes", branch: "main", transport: mock)

        let change = FileChange(path: "notes/a.md", contents: Data("hi".utf8),
                                blobSha: GitBlob.sha1("hi"))
        let oid = try await client.createCommit(
            expectedHeadOid: "abc123", changes: [change], message: "sync from whisperio")
        #expect(oid == "deadbeef")

        let req = try #require(mock.lastRequest)
        #expect(req.httpMethod == "POST")
        #expect(req.url?.absoluteString == "https://api.github.com/graphql")
        #expect(req.value(forHTTPHeaderField: "Content-Type") == "application/json")

        // Decode the GraphQL body and assert the mutation shape + variables.
        let body = try #require(req.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        let query = try #require(json["query"] as? String)
        #expect(query.contains("createCommitOnBranch"))
        #expect(query.contains("expectedHeadOid") == false)  // oid is a variable, not inlined in the query
        let variables = try #require(json["variables"] as? [String: Any])
        let input = try #require(variables["input"] as? [String: Any])
        #expect(input["expectedHeadOid"] as? String == "abc123")
        let branch = try #require(input["branch"] as? [String: Any])
        #expect(branch["repositoryNameWithOwner"] as? String == "octocat/notes")
        #expect(branch["branchName"] as? String == "main")
        let message = try #require(input["message"] as? [String: Any])
        #expect(message["headline"] as? String == "sync from whisperio")
        let fileChanges = try #require(input["fileChanges"] as? [String: Any])
        let additions = try #require(fileChanges["additions"] as? [[String: Any]])
        #expect(additions.count == 1)
        #expect(additions[0]["path"] as? String == "notes/a.md")
        #expect(additions[0]["contents"] as? String == Data("hi".utf8).base64EncodedString())
    }

    @Test func checkAccessGetsRepoAndReturnsFullName() async throws {
        let ok = Data(#"{"full_name":"octocat/notes","default_branch":"main"}"#.utf8)
        let mock = MockTransport(responseData: ok)
        let client = GitHubClient(owner: "octocat", repo: "notes", branch: "main", transport: mock)

        let name = try await client.checkAccess()
        #expect(name == "octocat/notes")

        let req = try #require(mock.lastRequest)
        #expect(req.httpMethod == "GET")
        #expect(req.url?.absoluteString == "https://api.github.com/repos/octocat/notes")
    }

    @Test func checkAccessThrowsOnUnauthorized() async {
        let mock = MockTransport(responseData: Data(#"{"message":"Bad credentials"}"#.utf8), status: 401)
        let client = GitHubClient(owner: "octocat", repo: "notes", branch: "main", transport: mock)
        await #expect(throws: GitHubError.self) { try await client.checkAccess() }
    }

    @Test func defaultTransportStampsAuthAndVersionHeaders() async throws {
        // The default URLSession transport must add Bearer + Accept + API-version; drive it with a
        // stub URLProtocol so no real network call happens.
        StubURLProtocol.reset()
        StubURLProtocol.responder = { req in
            StubURLProtocol.captured = req
            let http = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil,
                                       headerFields: nil)!
            return (Data("{}".utf8), http)
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: config)
        let transport = GitHubURLSessionTransport(token: "ghp_test", session: session)

        var req = URLRequest(url: URL(string: "https://api.github.com/graphql")!)
        req.httpMethod = "POST"
        _ = try await transport.send(req)

        let captured = try #require(StubURLProtocol.captured)
        #expect(captured.value(forHTTPHeaderField: "Authorization") == "Bearer ghp_test")
        #expect(captured.value(forHTTPHeaderField: "Accept") == "application/vnd.github+json")
        #expect(captured.value(forHTTPHeaderField: "X-GitHub-Api-Version") == "2022-11-28")
    }

    // MARK: - Settings round-trip

    @Test func githubSettingsDefaults() {
        let s = WhisperioSettings()
        #expect(s.githubSyncEnabled == false)
        #expect(s.githubOwner.isEmpty)
        #expect(s.githubRepo.isEmpty)
        #expect(s.githubBranch == "main")
        #expect(s.githubPathPrefix.isEmpty)
    }

    @Test func githubSettingsRoundTrip() throws {
        let original = WhisperioSettings(
            githubSyncEnabled: true, githubOwner: "octocat", githubRepo: "notes",
            githubBranch: "sync", githubPathPrefix: "vault")
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: data)
        #expect(decoded == original)
    }

    @Test func githubSettingsTolerateMissingKeys() throws {
        // A blob persisted before the GitHub fields existed still decodes, with the defaults.
        let legacy = Data(#"{"providerChain":["ondevice"],"openAIKey":"x"}"#.utf8)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: legacy)
        #expect(decoded.githubSyncEnabled == false)
        #expect(decoded.githubBranch == "main")
        #expect(decoded.githubOwner.isEmpty)
        #expect(decoded.openAIKey == "x")
    }

    @Test func githubKeychainItemHasStableRawValue() {
        #expect(Keychain.Item.githubToken.rawValue == "whisperio.key.github")
    }
}

/// URLProtocol stub so the default transport can be exercised without a real network call.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var responder: ((URLRequest) -> (Data, HTTPURLResponse))?
    nonisolated(unsafe) static var captured: URLRequest?

    static func reset() { responder = nil; captured = nil }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let (data, response) = StubURLProtocol.responder?(request) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)); return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
