import { shell } from 'electron'
import { loadSettings, saveSettings, type AppSettings } from './settingsManager'
import {
  isVaultAvailable,
  sealForRepo,
  openFromRepo,
  saveGithubToken,
  loadGithubToken,
  hasGithubToken,
  clearGithubToken
} from './secretVault'
import {
  isClientConfigured,
  startDeviceFlow,
  pollForToken,
  getAuthenticatedUser,
  listRepos,
  readRemoteBlob,
  writeRemoteBlob,
  type RepoSummary
} from './githubStore'

/**
 * Orchestrates the "connect GitHub → pick repo → sync secrets" feature.
 *
 * The only bytes that ever reach the repo are the AES-256-GCM envelope produced
 * by the local, Keychain-wrapped data key (see secretVault/secretCrypto). The
 * plaintext secrets and the data key never leave this machine, and the GitHub
 * token is stored Keychain-wrapped, never in settings.json.
 */

/** The settings fields that are actual secrets and get encrypted into the repo. */
const SECRET_KEYS = ['openaiApiKey', 'elevenlabsApiKey'] as const
type SecretKey = (typeof SECRET_KEYS)[number]

/** Path of the encrypted blob inside the user's chosen repo. */
const SECRET_PATH = 'whisperio/secrets.enc.json'

/** In-memory device-flow session (never persisted). */
interface DeviceFlowSession {
  deviceCode: string
  interval: number
  expiresAt: number
}
let activeFlow: DeviceFlowSession | null = null

export interface SyncStatus {
  clientConfigured: boolean
  vaultAvailable: boolean
  connected: boolean
  user: string
  repo: string
  branch: string
}

export function getStatus(): SyncStatus {
  const s = loadSettings()
  return {
    clientConfigured: isClientConfigured(),
    vaultAvailable: isVaultAvailable(),
    connected: hasGithubToken(),
    user: s.githubUser ?? '',
    repo: s.githubRepo ?? '',
    branch: s.githubBranch ?? ''
  }
}

export interface ConnectPrompt {
  userCode: string
  verificationUri: string
  expiresIn: number
}

/**
 * Kick off device flow: request a code, open the system browser to the
 * verification page, and hand the user-facing code back to the renderer. The
 * device_code itself stays in the main process.
 */
export async function beginConnect(): Promise<ConnectPrompt> {
  if (!isVaultAvailable()) {
    throw new Error('OS Keychain is unavailable — cannot store secrets securely. Connection blocked.')
  }
  const code = await startDeviceFlow()
  activeFlow = {
    deviceCode: code.deviceCode,
    interval: code.interval,
    expiresAt: Date.now() + code.expiresIn * 1000
  }
  // Open the real browser — device flow needs no embedded webview / redirect.
  await shell.openExternal(code.verificationUri).catch(() => {})
  return {
    userCode: code.userCode,
    verificationUri: code.verificationUri,
    expiresIn: code.expiresIn
  }
}

export type ConnectPoll =
  | { status: 'authorized'; user: string }
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'error'; message: string }

/**
 * Poll once for the token. On success the token is Keychain-wrapped and the
 * user's login cached (non-secret) for display. The renderer drives the loop,
 * respecting the returned cadence.
 */
export async function pollConnect(): Promise<ConnectPoll> {
  if (!activeFlow) return { status: 'error', message: 'No active connection attempt' }
  if (Date.now() > activeFlow.expiresAt) {
    activeFlow = null
    return { status: 'expired' }
  }
  const result = await pollForToken(activeFlow.deviceCode)
  switch (result.status) {
    case 'authorized': {
      saveGithubToken(result.token)
      activeFlow = null
      let login = ''
      try {
        login = (await getAuthenticatedUser(result.token)).login
      } catch {
        /* token is valid even if the profile call hiccups */
      }
      saveSettings({ githubUser: login })
      return { status: 'authorized', user: login }
    }
    case 'slow_down':
      activeFlow.interval = result.interval
      return { status: 'pending' }
    case 'pending':
      return { status: 'pending' }
    case 'expired':
      activeFlow = null
      return { status: 'expired' }
    case 'denied':
      activeFlow = null
      return { status: 'denied' }
    default:
      return { status: 'error', message: result.message }
  }
}

function requireToken(): string {
  const token = loadGithubToken()
  if (!token) throw new Error('Not connected to GitHub')
  return token
}

export async function listRepositories(): Promise<RepoSummary[]> {
  return listRepos(requireToken())
}

/** Persist the chosen repo (non-secret selection). */
export function selectRepo(fullName: string, branch: string): SyncStatus {
  saveSettings({ githubRepo: fullName, githubBranch: branch })
  return getStatus()
}

export function disconnect(): SyncStatus {
  clearGithubToken()
  saveSettings({ githubUser: '', githubRepo: '', githubBranch: '' })
  activeFlow = null
  return getStatus()
}

function collectSecrets(settings: AppSettings): Record<SecretKey, string> {
  const out = {} as Record<SecretKey, string>
  for (const k of SECRET_KEYS) out[k] = settings[k] ?? ''
  return out
}

export interface SyncResult {
  ok: true
  path: string
  keys: string[]
}

/**
 * Encrypt the local secrets client-side and commit ONLY the ciphertext envelope
 * to the chosen repo. Never writes plaintext.
 */
export async function pushSecrets(): Promise<SyncResult> {
  const token = requireToken()
  const settings = loadSettings()
  const repo = settings.githubRepo
  if (!repo) throw new Error('No repository selected')
  const branch = settings.githubBranch || undefined

  const payload = {
    schema: 'whisperio.secrets/1',
    updatedAt: new Date().toISOString(),
    secrets: collectSecrets(settings)
  }
  // Seal (AES-256-GCM under the local Keychain-held key), then base64 for the
  // Contents API. The repo only ever sees the sealed envelope.
  const sealed = sealForRepo(JSON.stringify(payload))
  const contentBase64 = Buffer.from(sealed, 'utf-8').toString('base64')

  const existing = await readRemoteBlob(token, repo, SECRET_PATH, branch)
  await writeRemoteBlob(
    token,
    repo,
    SECRET_PATH,
    contentBase64,
    `chore(whisperio): update encrypted secrets ${payload.updatedAt}`,
    existing?.sha,
    branch
  )
  return { ok: true, path: SECRET_PATH, keys: [...SECRET_KEYS] }
}

/**
 * Pull the ciphertext envelope from the repo, decrypt locally, and merge the
 * recovered secret fields back into settings.
 */
export async function pullSecrets(): Promise<SyncResult> {
  const token = requireToken()
  const settings = loadSettings()
  const repo = settings.githubRepo
  if (!repo) throw new Error('No repository selected')
  const branch = settings.githubBranch || undefined

  const blob = await readRemoteBlob(token, repo, SECRET_PATH, branch)
  if (!blob) throw new Error('No encrypted secrets found in the selected repository yet')

  const sealed = Buffer.from(blob.contentBase64, 'base64').toString('utf-8')
  const plaintext = openFromRepo(sealed)
  const parsed = JSON.parse(plaintext) as { secrets?: Partial<Record<SecretKey, string>> }
  const recovered = parsed.secrets ?? {}

  const patch: Partial<AppSettings> = {}
  for (const k of SECRET_KEYS) {
    if (typeof recovered[k] === 'string') patch[k] = recovered[k]
  }
  saveSettings(patch)
  return { ok: true, path: SECRET_PATH, keys: Object.keys(patch) }
}
