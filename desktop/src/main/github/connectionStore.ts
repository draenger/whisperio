import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs'
import { join } from 'path'

// Persist the NON-secret GitHub connection metadata: which account is connected
// and which repo/branch/path holds the encrypted secrets. The access token is
// deliberately NOT part of this shape — it lives only in githubTokenStore
// (safeStorage). Atomic temp+rename write and tolerant decode, matching
// settingsManager / recordingStore.

export interface GitHubConnection {
  login: string
  owner: string
  repo: string
  defaultBranch: string
  secretsPath: string
}

const FILE = 'github-connection.json'

function connectionPath(): string {
  return join(app.getPath('userData'), FILE)
}

export function loadConnection(): GitHubConnection | null {
  const filePath = connectionPath()
  if (!existsSync(filePath)) return null
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<GitHubConnection>
    if (!parsed.owner || !parsed.repo) return null
    return {
      login: parsed.login ?? '',
      owner: parsed.owner,
      repo: parsed.repo,
      defaultBranch: parsed.defaultBranch ?? 'main',
      secretsPath: parsed.secretsPath ?? '.whisperio/secrets.json.enc'
    }
  } catch {
    return null
  }
}

export function saveConnection(conn: GitHubConnection): GitHubConnection {
  const filePath = connectionPath()
  // Only ever persist the known non-secret fields — never let a token or other
  // secret ride along in this file.
  const safe: GitHubConnection = {
    login: conn.login,
    owner: conn.owner,
    repo: conn.repo,
    defaultBranch: conn.defaultBranch,
    secretsPath: conn.secretsPath
  }
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, JSON.stringify(safe, null, 2), 'utf-8')
  renameSync(tmpPath, filePath)
  return safe
}

export function clearConnection(): void {
  const filePath = connectionPath()
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath)
    } catch {
      /* best-effort */
    }
  }
}
