import { ipcMain, shell } from 'electron'
import { saveSettings } from '../settingsManager'
import { NetHttpTransport } from './httpTransport'
import { requestDeviceCode, pollForToken } from './deviceFlow'
import { GitHubClient, type GitHubRepo } from './githubClient'
import { getOrCreateMasterKey, isSecretStorageAvailable } from './keyProvider'
import { getToken, setToken, clearToken, hasToken } from './githubTokenStore'
import { loadConnection, saveConnection, clearConnection, type GitHubConnection } from './connectionStore'
import { SecretStore } from './secretStore'

// THIN wiring layer for the GitHub connect + encrypted secret store: it maps the
// `github:*` IPC channels onto the (unit-tested) pure logic + the (manually
// verified) runtime seams. Coverage-excluded like the rest of the IPC layer.

// The device flow needs a registered GitHub OAuth App's PUBLIC client_id (no
// secret, `repo` scope). Ship-time it comes from an env var so a fork can plug
// in its own app; when absent, the UI steers the user to the PAT-paste fallback.
const GITHUB_CLIENT_ID = process.env['WHISPERIO_GITHUB_CLIENT_ID'] || ''
const DEFAULT_SECRETS_PATH = '.whisperio/secrets.json.enc'

function buildClient(): GitHubClient {
  const token = getToken()
  if (!token) throw new Error('Not connected to GitHub. Connect an account first.')
  return new GitHubClient(new NetHttpTransport(), token)
}

function buildSecretStore(): SecretStore {
  const conn = loadConnection()
  if (!conn) throw new Error('No repository selected for the secret store.')
  const key = getOrCreateMasterKey()
  return new SecretStore(buildClient(), key, {
    owner: conn.owner,
    repo: conn.repo,
    branch: conn.defaultBranch,
    path: conn.secretsPath
  })
}

interface GitHubStatus {
  connected: boolean
  hasClientId: boolean
  secretStorageAvailable: boolean
  connection: GitHubConnection | null
}

export function registerGitHubIpc(): void {
  ipcMain.handle('github:status', (): GitHubStatus => ({
    connected: hasToken(),
    hasClientId: GITHUB_CLIENT_ID.length > 0,
    secretStorageAvailable: isSecretStorageAvailable(),
    connection: loadConnection()
  }))

  // Device flow — step 1. Opens the verification URL in the user's browser
  // (shell.openExternal is safe; the in-app will-navigate/window-open blocks stay
  // intact — no OAuth webview).
  ipcMain.handle('github:startDeviceFlow', async () => {
    if (!GITHUB_CLIENT_ID) {
      throw new Error(
        'No GitHub OAuth client id configured (WHISPERIO_GITHUB_CLIENT_ID). ' +
          'Paste a Personal Access Token instead, or set a client id to enable device flow.'
      )
    }
    const code = await requestDeviceCode(new NetHttpTransport(), GITHUB_CLIENT_ID)
    void shell.openExternal(code.verificationUri).catch(() => {})
    return code
  })

  // Device flow — step 2 (renderer polls on `interval`). On success the token is
  // stored via safeStorage, never in settings.json.
  ipcMain.handle('github:pollDeviceFlow', async (_e, deviceCode: string) => {
    if (!GITHUB_CLIENT_ID) throw new Error('No GitHub OAuth client id configured.')
    const result = await pollForToken(new NetHttpTransport(), GITHUB_CLIENT_ID, deviceCode)
    if (result.status === 'success') {
      setToken(result.accessToken)
    }
    return result
  })

  // PAT-paste fallback (as the mobile app allows). Validates against /user before
  // storing so a bad token is rejected up front.
  ipcMain.handle('github:pastePat', async (_e, token: string) => {
    const trimmed = (token || '').trim()
    if (!trimmed) throw new Error('Empty token.')
    const client = new GitHubClient(new NetHttpTransport(), trimmed)
    // listRepos throws GitHubApiError(401) on a bad token.
    await client.listRepos()
    setToken(trimmed)
    return { ok: true }
  })

  ipcMain.handle('github:listRepos', async (): Promise<GitHubRepo[]> => {
    return buildClient().listRepos()
  })

  ipcMain.handle('github:selectRepo', (_e, repo: GitHubRepo & { login?: string }) => {
    const conn: GitHubConnection = {
      login: repo.login ?? repo.owner,
      owner: repo.owner,
      repo: repo.name,
      defaultBranch: repo.defaultBranch || 'main',
      secretsPath: DEFAULT_SECRETS_PATH
    }
    saveConnection(conn)
    // Mirror the non-secret metadata into settings for status display.
    saveSettings({ githubConnection: { ...conn } })
    return conn
  })

  ipcMain.handle('github:testConnection', async () => {
    const conn = loadConnection()
    if (!conn) throw new Error('No repository selected.')
    const fullName = await buildClient().checkAccess(conn.owner, conn.repo)
    return { ok: true, fullName }
  })

  ipcMain.handle('github:disconnect', () => {
    clearToken()
    clearConnection()
    saveSettings({ githubConnection: undefined })
    return { ok: true }
  })

  // Encrypted secret store (client-side AES-GCM; only ciphertext is committed).
  ipcMain.handle('github:secretList', () => buildSecretStore().listSecretNames())
  ipcMain.handle('github:secretGet', (_e, name: string) => buildSecretStore().getSecret(name))
  ipcMain.handle('github:secretSet', async (_e, name: string, value: string) => {
    await buildSecretStore().setSecret(name, value)
    return { ok: true }
  })
  ipcMain.handle('github:secretDelete', async (_e, name: string) => {
    await buildSecretStore().deleteSecret(name)
    return { ok: true }
  })
}
