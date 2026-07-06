import { net } from 'electron'

/**
 * GitHub client: OAuth **device flow** + the Contents API used to read/write the
 * encrypted secret blob. Everything here runs in the main process, so:
 *   - the access token never enters the renderer / CSP-sandboxed web context;
 *   - we use the system browser for authorization (device flow) instead of an
 *     embedded webview, sidestepping the redirect/webview hardening in index.ts.
 *
 * Device flow is chosen over PKCE web-flow specifically because it needs no
 * loopback redirect server and no embedded browser window — the user approves in
 * their real browser and we poll for the token.
 *
 * ── CONFIG (STUB) ──────────────────────────────────────────────────────────
 * A real GitHub OAuth App **client_id** must be provisioned and injected via the
 * WHISPERIO_GITHUB_CLIENT_ID env var (or wired into the build). The device-flow
 * logic below is complete and real; only this identifier is a placeholder.
 * The OAuth App must have "Device flow" enabled and request the `repo` scope.
 */
export const GITHUB_CLIENT_ID = process.env['WHISPERIO_GITHUB_CLIENT_ID'] || ''
/** `repo` grants read/write to the user's repositories (incl. private). */
const OAUTH_SCOPE = 'repo'

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const API_BASE = 'https://api.github.com'
const USER_AGENT = 'Whisperio'

export function isClientConfigured(): boolean {
  return GITHUB_CLIENT_ID.trim().length > 0
}

interface JsonResponse {
  status: number
  body: unknown
}

/** Minimal promise wrapper over Electron `net.request` returning parsed JSON. */
function requestJson(opts: {
  method: string
  url: string
  headers?: Record<string, string>
  body?: unknown
}): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    const request = net.request({ method: opts.method, url: opts.url })
    request.setHeader('Accept', 'application/json')
    request.setHeader('User-Agent', USER_AGENT)
    for (const [k, v] of Object.entries(opts.headers ?? {})) request.setHeader(k, v)

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      request.abort()
      reject(new Error('GitHub request timed out after 30s'))
    }, 30_000)

    const done = <T>(fn: (v: T) => void) => (v: T): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      fn(v)
    }

    request.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (c: Buffer) => chunks.push(c))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8')
        let parsed: unknown = null
        try {
          parsed = text ? JSON.parse(text) : null
        } catch {
          parsed = { raw: text }
        }
        done(resolve)({ status: response.statusCode ?? 0, body: parsed })
      })
      response.on('error', done(reject))
    })
    request.on('error', done(reject))

    if (opts.body !== undefined) {
      let bodyStr: string
      if (opts.headers?.['Content-Type'] === 'application/x-www-form-urlencoded') {
        bodyStr = new URLSearchParams(opts.body as Record<string, string>).toString()
      } else {
        request.setHeader('Content-Type', 'application/json')
        bodyStr = JSON.stringify(opts.body)
      }
      request.write(bodyStr)
    }
    request.end()
  })
}

/* ── Device flow ── */

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export async function startDeviceFlow(): Promise<DeviceCode> {
  if (!isClientConfigured()) {
    throw new Error(
      'GitHub OAuth client id is not configured (set WHISPERIO_GITHUB_CLIENT_ID).'
    )
  }
  const { status, body } = await requestJson({
    method: 'POST',
    url: DEVICE_CODE_URL,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: { client_id: GITHUB_CLIENT_ID, scope: OAUTH_SCOPE }
  })
  const b = body as Record<string, string> | null
  if (status !== 200 || !b?.['device_code']) {
    throw new Error(`Failed to start GitHub device flow (HTTP ${status})`)
  }
  return {
    deviceCode: b['device_code'],
    userCode: b['user_code'],
    verificationUri: b['verification_uri'],
    expiresIn: Number(b['expires_in'] ?? 900),
    interval: Number(b['interval'] ?? 5)
  }
}

export type PollResult =
  | { status: 'authorized'; token: string }
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'error'; message: string }

/** Single poll of the token endpoint. Caller loops on `pending`/`slow_down`. */
export async function pollForToken(deviceCode: string): Promise<PollResult> {
  const { body } = await requestJson({
    method: 'POST',
    url: ACCESS_TOKEN_URL,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: {
      client_id: GITHUB_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    }
  })
  const b = body as Record<string, string> | null
  if (b?.['access_token']) return { status: 'authorized', token: b['access_token'] }
  switch (b?.['error']) {
    case 'authorization_pending':
      return { status: 'pending' }
    case 'slow_down':
      return { status: 'slow_down', interval: Number(b['interval'] ?? 10) }
    case 'expired_token':
      return { status: 'expired' }
    case 'access_denied':
      return { status: 'denied' }
    default:
      return { status: 'error', message: b?.['error_description'] || b?.['error'] || 'Unknown error' }
  }
}

/* ── Authenticated API ── */

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

export interface GithubUser {
  login: string
  avatarUrl: string
}

export async function getAuthenticatedUser(token: string): Promise<GithubUser> {
  const { status, body } = await requestJson({
    method: 'GET',
    url: `${API_BASE}/user`,
    headers: authHeaders(token)
  })
  const b = body as Record<string, string> | null
  if (status !== 200 || !b?.['login']) throw new Error(`GitHub /user failed (HTTP ${status})`)
  return { login: b['login'], avatarUrl: b['avatar_url'] ?? '' }
}

export interface RepoSummary {
  fullName: string // owner/name
  private: boolean
  defaultBranch: string
}

export async function listRepos(token: string): Promise<RepoSummary[]> {
  const repos: RepoSummary[] = []
  // Fetch up to a few pages of the user's most-recently-updated repos.
  for (let page = 1; page <= 3; page++) {
    const { status, body } = await requestJson({
      method: 'GET',
      url: `${API_BASE}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator&visibility=all&page=${page}`,
      headers: authHeaders(token)
    })
    if (status !== 200 || !Array.isArray(body)) {
      if (page === 1) throw new Error(`GitHub repo list failed (HTTP ${status})`)
      break
    }
    for (const r of body as Array<Record<string, unknown>>) {
      repos.push({
        fullName: String(r['full_name']),
        private: Boolean(r['private']),
        defaultBranch: String(r['default_branch'] ?? 'main')
      })
    }
    if ((body as unknown[]).length < 100) break
  }
  return repos
}

export interface RemoteBlob {
  contentBase64: string
  sha: string
}

/** Read a file's raw base64 content + blob sha, or null if it doesn't exist. */
export async function readRemoteBlob(
  token: string,
  fullName: string,
  path: string,
  branch?: string
): Promise<RemoteBlob | null> {
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : ''
  const { status, body } = await requestJson({
    method: 'GET',
    url: `${API_BASE}/repos/${fullName}/contents/${encodeURIComponent(path)}${ref}`,
    headers: authHeaders(token)
  })
  if (status === 404) return null
  const b = body as Record<string, string> | null
  if (status !== 200 || !b?.['content']) throw new Error(`GitHub read failed (HTTP ${status})`)
  // Contents API returns base64 with embedded newlines.
  return { contentBase64: b['content'].replace(/\n/g, ''), sha: b['sha'] }
}

/** Create or update a file with base64 content. Pass the current sha to update. */
export async function writeRemoteBlob(
  token: string,
  fullName: string,
  path: string,
  contentBase64: string,
  message: string,
  sha?: string,
  branch?: string
): Promise<{ sha: string }> {
  const payload: Record<string, string> = { message, content: contentBase64 }
  if (sha) payload['sha'] = sha
  if (branch) payload['branch'] = branch
  const { status, body } = await requestJson({
    method: 'PUT',
    url: `${API_BASE}/repos/${fullName}/contents/${encodeURIComponent(path)}`,
    headers: authHeaders(token),
    body: payload
  })
  const b = body as { content?: { sha?: string } } | null
  if (status !== 200 && status !== 201) throw new Error(`GitHub write failed (HTTP ${status})`)
  return { sha: b?.content?.sha ?? '' }
}
