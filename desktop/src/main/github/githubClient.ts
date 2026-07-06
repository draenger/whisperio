import type { HttpTransport } from './httpTransport'

// TS port of the mobile GitHubClient. Pure request-building over an injected
// transport: stamps the auth + versioning headers GitHub expects, throws typed
// errors on 401/404, and returns plain data the higher layers consume. All
// network + Electron concerns live behind HttpTransport.

const DEFAULT_API_BASE = 'https://api.github.com'
const API_VERSION = '2022-11-28'
const ACCEPT = 'application/vnd.github+json'

export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'GitHubApiError'
  }
}

export interface GitHubRepo {
  fullName: string
  name: string
  owner: string
  defaultBranch: string
  private: boolean
}

export interface GitHubFile {
  contentBase64: string
  sha: string
}

interface RawRepo {
  full_name?: string
  name?: string
  owner?: { login?: string }
  default_branch?: string
  private?: boolean
}

interface RawContent {
  content?: string
  sha?: string
}

interface PutResult {
  content?: { sha?: string }
  commit?: { sha?: string }
}

export class GitHubClient {
  private readonly apiBase: string

  constructor(
    private readonly transport: HttpTransport,
    private readonly token: string,
    apiBase: string = DEFAULT_API_BASE
  ) {
    this.apiBase = apiBase.replace(/\/$/, '')
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: ACCEPT,
      'X-GitHub-Api-Version': API_VERSION,
      ...extra
    }
  }

  private parse<T>(body: string, context: string): T {
    try {
      return JSON.parse(body) as T
    } catch {
      throw new GitHubApiError(0, `GitHub ${context}: malformed response`)
    }
  }

  /** List the user's repos (for the repo picker), most-recently-updated first. */
  async listRepos(): Promise<GitHubRepo[]> {
    const res = await this.transport.send({
      method: 'GET',
      url: `${this.apiBase}/user/repos?per_page=100&sort=updated`,
      headers: this.headers()
    })
    if (res.status === 401) throw new GitHubApiError(401, 'GitHub token unauthorized (check the token/scope)')
    if (res.status < 200 || res.status >= 300) {
      throw new GitHubApiError(res.status, `GitHub listRepos failed (HTTP ${res.status})`)
    }
    const raw = this.parse<RawRepo[]>(res.body, 'listRepos')
    return raw.map((r) => ({
      fullName: r.full_name ?? '',
      name: r.name ?? '',
      owner: r.owner?.login ?? '',
      defaultBranch: r.default_branch ?? 'main',
      private: r.private ?? false
    }))
  }

  /**
   * Fetch a file's base64 content + blob sha, or null on 404 (file not there
   * yet — the caller treats that as "no secrets stored"). The sha is required to
   * do a conflict-safe update via putFile.
   */
  async getFile(owner: string, repo: string, path: string, ref?: string): Promise<GitHubFile | null> {
    let url = `${this.apiBase}/repos/${owner}/${repo}/contents/${encodePath(path)}`
    if (ref) url += `?ref=${encodeURIComponent(ref)}`
    const res = await this.transport.send({ method: 'GET', url, headers: this.headers() })
    if (res.status === 404) return null
    if (res.status === 401) throw new GitHubApiError(401, 'GitHub token unauthorized')
    if (res.status < 200 || res.status >= 300) {
      throw new GitHubApiError(res.status, `GitHub getFile failed (HTTP ${res.status})`)
    }
    const data = this.parse<RawContent>(res.body, 'getFile')
    return {
      // GitHub wraps base64 content at 60 cols — strip the newlines.
      contentBase64: (data.content ?? '').replace(/\n/g, ''),
      sha: data.sha ?? ''
    }
  }

  /**
   * Create or update a file via the contents API. Passing `sha` makes the update
   * conflict-safe + idempotent (GitHub rejects a stale sha). Simpler than the
   * mobile GraphQL createCommitOnBranch for a single-file store.
   */
  async putFile(args: {
    owner: string
    repo: string
    path: string
    contentBase64: string
    message: string
    branch?: string
    sha?: string
  }): Promise<{ sha: string; commitSha: string }> {
    const body: Record<string, unknown> = {
      message: args.message,
      content: args.contentBase64
    }
    if (args.branch) body['branch'] = args.branch
    if (args.sha) body['sha'] = args.sha

    const res = await this.transport.send({
      method: 'PUT',
      url: `${this.apiBase}/repos/${args.owner}/${args.repo}/contents/${encodePath(args.path)}`,
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    })
    if (res.status === 401) throw new GitHubApiError(401, 'GitHub token unauthorized')
    if (res.status === 404) throw new GitHubApiError(404, 'GitHub repo or path not found')
    if (res.status < 200 || res.status >= 300) {
      throw new GitHubApiError(res.status, `GitHub putFile failed (HTTP ${res.status})`)
    }
    const data = this.parse<PutResult>(res.body, 'putFile')
    return { sha: data.content?.sha ?? '', commitSha: data.commit?.sha ?? '' }
  }

  /**
   * Verify the token can reach a repo (test-connection). Returns the repo
   * full_name on success; throws GitHubApiError(401/404) so the caller can
   * surface a precise result.
   */
  async checkAccess(owner: string, repo: string): Promise<string> {
    const res = await this.transport.send({
      method: 'GET',
      url: `${this.apiBase}/repos/${owner}/${repo}`,
      headers: this.headers()
    })
    if (res.status === 401) throw new GitHubApiError(401, 'GitHub token unauthorized')
    if (res.status === 404) throw new GitHubApiError(404, 'GitHub repo not found or no access')
    if (res.status < 200 || res.status >= 300) {
      throw new GitHubApiError(res.status, `GitHub checkAccess failed (HTTP ${res.status})`)
    }
    const data = this.parse<RawRepo>(res.body, 'checkAccess')
    return data.full_name ?? `${owner}/${repo}`
  }
}

// Encode each path segment but keep the slashes (the contents API path is a repo
// path like `.whisperio/secrets.json.enc`).
function encodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}
