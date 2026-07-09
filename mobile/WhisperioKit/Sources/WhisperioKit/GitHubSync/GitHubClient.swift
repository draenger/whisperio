import Foundation

/// Transport seam for GitHub requests — injectable so the client's request-building logic can be
/// tested with a mock and never touches the network in unit tests.
public protocol GitHubTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// Default transport: a dedicated ephemeral `URLSession` with real timeouts that stamps every
/// request with the auth + versioning headers the GitHub API expects (Bearer token, the JSON
/// media type, and the pinned REST API version). Mirrors the house HTTP style
/// (see `OpenAIChatClient`): its own session, hard resource cap, no shared cookie/cache state.
public struct GitHubURLSessionTransport: GitHubTransport {
    private let token: String
    private let session: URLSession

    public init(token: String, session: URLSession? = nil) {
        self.token = token
        self.session = session ?? GitHubURLSessionTransport.makeSession()
    }

    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30    // idle timeout between bytes
        config.timeoutIntervalForResource = 60   // hard cap for the whole request+response
        return URLSession(configuration: config)
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        var req = request
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        let (data, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw GitHubError.noResponse }
        return (data, http)
    }
}

public enum GitHubError: Error, Equatable, Sendable {
    case noResponse
    case invalidURL
    case http(status: Int, body: String)
    case malformedResponse(String)
}

/// One entry from a Git tree listing (`type` is "blob" for files, "tree" for directories).
public struct GitTreeEntry: Sendable, Equatable {
    public let path: String
    public let type: String
    public let sha: String
    public init(path: String, type: String, sha: String) {
        self.path = path
        self.type = type
        self.sha = sha
    }
}

/// GitHub sync client. Reads the current repo state (ref + tree) over REST to learn which blobs
/// already exist, and writes all changed files in a single atomic commit via the GraphQL
/// `createCommitOnBranch` mutation (base64 `fileChanges.additions`) guarded by `expectedHeadOid`
/// so a concurrent change on the branch fails the commit instead of silently clobbering.
public struct GitHubClient: Sendable {
    public let owner: String
    public let repo: String
    public let branch: String
    private let transport: GitHubTransport
    private let apiBaseURL: URL

    public init(
        owner: String,
        repo: String,
        branch: String,
        transport: GitHubTransport,
        apiBaseURL: URL = URL(string: "https://api.github.com")!
    ) {
        self.owner = owner
        self.repo = repo
        self.branch = branch
        self.transport = transport
        self.apiBaseURL = apiBaseURL
    }

    private var nameWithOwner: String { "\(owner)/\(repo)" }

    // MARK: - REST reads

    /// Current head commit sha of the configured branch (`GET /git/ref/heads/{branch}`).
    public func headOid() async throws -> String {
        let path = "repos/\(owner)/\(repo)/git/ref/heads/\(branch)"
        let data = try await get(path)
        struct Ref: Decodable { struct Object: Decodable { let sha: String }; let object: Object }
        do { return try JSONDecoder().decode(Ref.self, from: data).object.sha }
        catch { throw GitHubError.malformedResponse("git/ref: \(error)") }
    }

    /// Verify the token can reach the configured repo (`GET /repos/{owner}/{repo}`). Returns the
    /// repo's `full_name` on success; throws `GitHubError.http` (401 bad token / 404 not found or
    /// no access) so the caller can surface a precise "test connection" result.
    @discardableResult
    public func checkAccess() async throws -> String {
        let data = try await get("repos/\(owner)/\(repo)")
        struct Repo: Decodable { let full_name: String? }
        do { return try JSONDecoder().decode(Repo.self, from: data).full_name ?? nameWithOwner }
        catch { throw GitHubError.malformedResponse("repos: \(error)") }
    }

    /// Recursive tree listing for a ref/sha (`GET /git/trees/{ref}?recursive=1`).
    public func tree(ref: String, recursive: Bool = true) async throws -> [GitTreeEntry] {
        var path = "repos/\(owner)/\(repo)/git/trees/\(ref)"
        if recursive { path += "?recursive=1" }
        let data = try await get(path)
        struct TreeResponse: Decodable {
            struct Entry: Decodable { let path: String; let type: String; let sha: String }
            let tree: [Entry]
            let truncated: Bool?
        }
        let decoded: TreeResponse
        do {
            decoded = try JSONDecoder().decode(TreeResponse.self, from: data)
        } catch { throw GitHubError.malformedResponse("git/trees: \(error)") }
        // A truncated listing omits entries, so the blob-sha map would be incomplete and SyncPlan
        // would re-upload already-present files on every sync. Surface it instead of churning.
        if decoded.truncated == true {
            throw GitHubError.malformedResponse("git/trees truncated: repo too large for a single recursive tree listing")
        }
        return decoded.tree.map { GitTreeEntry(path: $0.path, type: $0.type, sha: $0.sha) }
    }

    /// Convenience: map of repo path → blob sha for every file currently on the branch, ready to
    /// feed `SyncPlan.build(remoteBlobShas:)`. `prefix`, when non-empty, filters to that subtree.
    public func remoteBlobShas(prefix: String = "") async throws -> [String: String] {
        let entries = try await tree(ref: branch)
        var out: [String: String] = [:]
        let trimmedPrefix = prefix.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        for entry in entries where entry.type == "blob" {
            if trimmedPrefix.isEmpty || entry.path == trimmedPrefix || entry.path.hasPrefix(trimmedPrefix + "/") {
                out[entry.path] = entry.sha
            }
        }
        return out
    }

    // MARK: - GraphQL write

    /// Commit all `changes` onto the branch in one atomic `createCommitOnBranch`, guarded by
    /// `expectedHeadOid`. Returns the new commit's oid.
    @discardableResult
    public func createCommit(
        expectedHeadOid: String,
        changes: [FileChange],
        message: String
    ) async throws -> String {
        let body = CommitRequest(
            query: Self.createCommitMutation,
            variables: .init(input: .init(
                branch: .init(repositoryNameWithOwner: nameWithOwner, branchName: branch),
                message: .init(headline: message),
                expectedHeadOid: expectedHeadOid,
                fileChanges: .init(additions: changes.map {
                    .init(path: $0.path, contents: $0.contents.base64EncodedString())
                })
            ))
        )

        guard let url = URL(string: "graphql", relativeTo: apiBaseURL) else {
            throw GitHubError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(body)

        let (data, http) = try await transport.send(req)
        guard (200..<300).contains(http.statusCode) else {
            throw GitHubError.http(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        struct GraphQLResponse: Decodable {
            struct DataBlock: Decodable {
                struct Mutation: Decodable {
                    struct Commit: Decodable { let oid: String }
                    let commit: Commit?
                }
                let createCommitOnBranch: Mutation?
            }
            struct GQLError: Decodable { let message: String }
            let data: DataBlock?
            let errors: [GQLError]?
        }
        let decoded: GraphQLResponse
        do { decoded = try JSONDecoder().decode(GraphQLResponse.self, from: data) }
        catch { throw GitHubError.malformedResponse("createCommitOnBranch: \(error)") }
        if let errors = decoded.errors, !errors.isEmpty {
            throw GitHubError.http(status: http.statusCode, body: errors.map(\.message).joined(separator: "; "))
        }
        guard let oid = decoded.data?.createCommitOnBranch?.commit?.oid else {
            throw GitHubError.malformedResponse("createCommitOnBranch: no commit oid")
        }
        return oid
    }

    static let createCommitMutation = """
    mutation($input: CreateCommitOnBranchInput!) { \
    createCommitOnBranch(input: $input) { commit { oid url } } }
    """

    // MARK: - REST helper

    private func get(_ path: String) async throws -> Data {
        guard let url = URL(string: path, relativeTo: apiBaseURL) else { throw GitHubError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        let (data, http) = try await transport.send(req)
        guard (200..<300).contains(http.statusCode) else {
            throw GitHubError.http(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        return data
    }
}

// MARK: - GraphQL request encoding

private struct CommitRequest: Encodable {
    let query: String
    let variables: Variables

    struct Variables: Encodable { let input: Input }
    struct Input: Encodable {
        let branch: Branch
        let message: Message
        let expectedHeadOid: String
        let fileChanges: FileChanges
    }
    struct Branch: Encodable {
        let repositoryNameWithOwner: String
        let branchName: String
    }
    struct Message: Encodable { let headline: String }
    struct FileChanges: Encodable { let additions: [Addition] }
    struct Addition: Encodable {
        let path: String
        let contents: String   // base64
    }
}
