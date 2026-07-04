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

    @Test func recordingPathIsUTCAndUUIDShort() {
        // 2026-01-15T04:00:00Z — the UTC minute stamp must not shift with the host time zone.
        let ts = Date(timeIntervalSince1970: 1_768_449_600)
        let id = UUID(uuidString: "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8")!
        let dir = GitHubPaths.recordingDir(prefix: "notes", categoryId: "work", timestamp: ts, id: id)
        #expect(dir == "notes/work/2026-01-15_04-00-6f1a2b3c")
        #expect(GitHubPaths.transcriptPath(dir: dir) == "notes/work/2026-01-15_04-00-6f1a2b3c/transcript.md")
        #expect(GitHubPaths.renderPath(dir: dir) == "notes/work/2026-01-15_04-00-6f1a2b3c/render.md")
    }

    @Test func emptyPrefixOmitsLeadingSlash() {
        let id = UUID(uuidString: "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8")!
        let dir = GitHubPaths.recordingDir(prefix: "", categoryId: "work", timestamp: Self.noon, id: id)
        #expect(dir == "work/2026-01-15_12-00-6f1a2b3c")
    }

    @Test func prefixTrailingSlashIsNormalized() {
        let id = UUID(uuidString: "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8")!
        let dir = GitHubPaths.recordingDir(prefix: "/vault/", categoryId: "work", timestamp: Self.noon, id: id)
        #expect(dir == "vault/work/2026-01-15_12-00-6f1a2b3c")
    }

    @Test func synthesisPathIsDaySlug() {
        #expect(GitHubPaths.synthesisPath(prefix: "notes", date: Self.noon) == "notes/2026-01-15-summary.md")
        #expect(GitHubPaths.synthesisPath(prefix: "", date: Self.noon) == "2026-01-15-summary.md")
    }

    @Test func oddCategoryIdsAreSanitized() {
        #expect(GitHubPaths.sanitizeCategory("Work / Personal") == "Work-Personal")
        #expect(GitHubPaths.sanitizeCategory("../etc/passwd") == "etc-passwd")
        #expect(GitHubPaths.sanitizeCategory("café ☕️ notes") == "caf-notes")
        #expect(GitHubPaths.sanitizeCategory("") == "uncategorized")
        #expect(GitHubPaths.sanitizeCategory("///") == "uncategorized")
    }

    @Test func collisionGetsNumericSuffix() {
        // Two uuids sharing the same first-8 hex, same UTC minute → the second folder is suffixed.
        let a = UUID(uuidString: "6F1A2B3C-0000-4000-8000-000000000001")!
        let b = UUID(uuidString: "6F1A2B3C-0000-4000-8000-000000000002")!
        let assigned = GitHubPaths.assignRecordingDirs([item(id: a), item(id: b)], prefix: "notes")
        #expect(assigned[0].dir == "notes/work/2026-01-15_12-00-6f1a2b3c")
        #expect(assigned[1].dir == "notes/work/2026-01-15_12-00-6f1a2b3c-2")
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
        #expect(paths.contains("notes/work/2026-01-15_12-00-6f1a2b3c/transcript.md"))
        #expect(paths.contains("notes/work/2026-01-15_12-00-6f1a2b3c/render.md"))
        #expect(paths.contains("notes/2026-01-15-summary.md"))
        #expect(changes.count == 3)
    }

    @Test func syncPlanSkipsUnchangedFiles() {
        let id = UUID(uuidString: "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8")!
        let one = item(id: id)
        // First pass: nothing remote, so the transcript is emitted with its blob sha.
        let first = SyncPlan.build(items: [one], syntheses: [], prefix: "notes")
        #expect(first.count == 1)
        // Feed that blob sha back as the remote state — the identical render is now skipped.
        let remote = [first[0].path: first[0].blobSha]
        let second = SyncPlan.build(items: [one], syntheses: [], prefix: "notes", remoteBlobShas: remote)
        #expect(second.isEmpty)
        // A changed transcript re-emits (different bytes → different blob sha).
        let edited = item(id: id, transcript: "changed text")
        let third = SyncPlan.build(items: [edited], syntheses: [], prefix: "notes", remoteBlobShas: remote)
        #expect(third.count == 1)
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
