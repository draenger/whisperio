import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow, Notification } from 'electron'
import { setUpdateReady } from './tray'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { PINNED_UPDATE_SIGNERS, createUpdateVerifier } from './updateSignature/updateVerifier'
import { verifyAuthenticode } from './updateSignature/authenticode'

export const RELEASES_URL = 'https://github.com/draenger/whisperio/releases'

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdaterState {
  status: UpdaterStatus
  currentVersion: string
  version?: string
  percent?: number
  bytesPerSecond?: number
  error?: string
  /** Set when the update cannot be installed automatically; the UI offers a Releases-page link. */
  manualDownloadUrl?: string
}

let state: UpdaterState = {
  status: 'idle',
  currentVersion: app.getVersion()
}

// Avoid spamming the same notification on every 4h re-check
let notifiedAvailableFor: string | null = null
let notifiedDownloadedFor: string | null = null
let downloadedFile: string | null = null
// True when this platform/build must not install updates itself (Linux AppImage has no signature
// verification; Windows without the verifier hook). The user is pointed at the Releases page.
let manualOnly = false

function broadcast(): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('updater:status', state)
    }
  })
}

function setState(patch: Partial<UpdaterState>): void {
  state = { ...state, ...patch }
  broadcast()
}

export function getUpdateState(): UpdaterState {
  return state
}

// --- Rejected-version memory ------------------------------------------------------------------
// A downloaded update whose signature is rejected must not be re-downloaded every 4h. The version
// is remembered in userData (not settings: it is not user-editable state).
function rejectedFile(): string {
  return join(app.getPath('userData'), 'rejected-update.json')
}
function readRejectedVersion(): string | null {
  try {
    const v = JSON.parse(readFileSync(rejectedFile(), 'utf-8'))?.version
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}
function rememberRejectedVersion(version: string | undefined): void {
  if (!version) return
  try {
    writeFileSync(rejectedFile(), JSON.stringify({ version }), 'utf-8')
  } catch (e) {
    console.error('[Whisperio] Could not persist rejected update version:', e instanceof Error ? e.message : String(e))
  }
}

function unverifiedMessage(version: string | undefined): string {
  return `Version ${version ?? '(unknown)'} couldn't be verified - download it from the Releases page: ${RELEASES_URL}`
}

/** Shared handler for the updater 'error' event and a rejected checkForUpdates() promise. */
function handleUpdaterError(err: unknown): void {
  const e = err as { code?: string; message?: string } | null
  console.error('[Whisperio] Auto-update error:', e?.message ?? String(err))
  if (e?.code === 'ERR_UPDATER_INVALID_SIGNATURE') {
    const fromMessage = /New version (\S+) is not signed/.exec(e.message ?? '')?.[1]
    const version = fromMessage ?? state.version
    rememberRejectedVersion(version)
    setState({
      status: 'error',
      version,
      percent: undefined,
      error: unverifiedMessage(version),
      manualDownloadUrl: RELEASES_URL
    })
    return
  }
  // Fail soft for everything else (404 / missing artifact / offline): show "no update".
  setState({ status: 'not-available', version: undefined, percent: undefined, error: undefined, manualDownloadUrl: undefined })
}

/** Trigger a manual update check (returns immediately; progress arrives via updater:status). */
export function checkForUpdatesManual(): void {
  if (!autoUpdater.isUpdaterActive()) return
  setState({ status: 'checking', error: undefined })
  autoUpdater.checkForUpdates().catch((err) => {
    // Fail soft for ordinary failures; a signature rejection is surfaced (see handleUpdaterError).
    handleUpdaterError(err)
  })
}

/** Quit and install a downloaded update. Safe to call only when status === 'downloaded'. */
export async function installUpdate(): Promise<boolean> {
  if (state.status !== 'downloaded') return false
  // Windows: re-verify the exact file we are about to run, right before install (the download
  // sits in the cache between the updater's check and now). Fail closed.
  if (process.platform === 'win32') {
    const r = downloadedFile
      ? await verifyAuthenticode(downloadedFile, PINNED_UPDATE_SIGNERS)
      : ({ ok: false, reason: 'downloaded installer path unknown' } as const)
    if (!r.ok) {
      console.error(`[Whisperio] Refusing to install update: ${r.reason}`)
      rememberRejectedVersion(state.version)
      setState({ status: 'error', percent: undefined, error: unverifiedMessage(state.version), manualDownloadUrl: RELEASES_URL })
      return false
    }
  }
  // isSilent=false (show installer progress), isForceRunAfter=true (relaunch after install)
  autoUpdater.quitAndInstall(false, true)
  return true
}

const CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let handlersRegistered = false
let checksEnabled = true
let initialTimer: ReturnType<typeof setTimeout> | null = null
let intervalTimer: ReturnType<typeof setInterval> | null = null

function stopScheduledChecks(): void {
  if (initialTimer) clearTimeout(initialTimer)
  if (intervalTimer) clearInterval(intervalTimer)
  initialTimer = null
  intervalTimer = null
}

function startScheduledChecks(): void {
  stopScheduledChecks()
  // Check for updates after 10s, then every 4 hours
  initialTimer = setTimeout(() => {
    initialTimer = null
    autoUpdater.checkForUpdates().catch(() => {})
  }, CHECK_DELAY_MS)
  intervalTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, CHECK_INTERVAL_MS)
}

/**
 * Enable/disable the periodic (and initial) update check at runtime — driven by the
 * `checkForUpdates` setting (privacy policy section 6). Disabling cancels pending timers;
 * enabling (re)starts them. No-op before initAutoUpdater() or when the updater is inactive.
 */
export function setUpdateChecksEnabled(enabled: boolean): void {
  checksEnabled = enabled
  if (!handlersRegistered) return
  if (enabled) startScheduledChecks()
  else stopScheduledChecks()
}

export function initAutoUpdater(enabled = true): void {
  if (!autoUpdater.isUpdaterActive()) return

  // Downloads are started explicitly from the 'update-available' handler (so a previously
  // rejected version is never re-downloaded), hence autoDownload=false. Never install silently on
  // quit for platforms whose CI builds are not code-signed (Windows NSIS, Linux AppImage); macOS
  // builds are signed + notarized.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = process.platform === 'darwin'
  manualOnly = false

  // Linux AppImage updates are unauthenticated (TLS + sha512 from the same feed only; no detached
  // signatures yet): never install automatically, point the user at the Releases page. Accepted
  // risk until detached signatures exist (docs/release-runbook.md, section 1.4).
  if (process.platform === 'linux') manualOnly = true

  // Windows: replace electron-updater's script-shell Get-AuthenticodeSignature check with the
  // pure-Node verifier pinned to our release cert, so a downloaded installer that is unsigned or
  // signed by anyone else is rejected (the updater emits 'error'; nothing is installed). The
  // stock check is skipped entirely when app-update.yml lacks publisherName, so override both.
  if (process.platform === 'win32') {
    if ('verifyUpdateCodeSignature' in autoUpdater) {
      const verify = createUpdateVerifier(PINNED_UPDATE_SIGNERS, (m) => console.log(m))
      ;(autoUpdater as unknown as { verifyUpdateCodeSignature: typeof verify }).verifyUpdateCodeSignature = verify
      ;(autoUpdater as unknown as { verifySignature: (f: string) => Promise<string | null> }).verifySignature = (f) =>
        verify([], f)
    } else {
      // Fail closed: without the hook electron-updater cannot be told to verify our pin.
      console.error('[Whisperio] electron-updater has no verifyUpdateCodeSignature hook; automatic update download disabled')
      manualOnly = true
    }
  }

  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking', error: undefined })
  })

  autoUpdater.on('update-not-available', () => {
    setState({ status: 'not-available', version: undefined, percent: undefined, manualDownloadUrl: undefined })
  })

  autoUpdater.on('update-available', (info) => {
    console.log(`[Whisperio] Update available: v${info.version}`)
    if (readRejectedVersion() === info.version) {
      // Signature of this exact version was rejected before: do not download it again.
      console.warn(`[Whisperio] Skipping v${info.version}: its signature was previously rejected`)
      setState({ status: 'error', version: info.version, percent: undefined, error: unverifiedMessage(info.version), manualDownloadUrl: RELEASES_URL })
      return
    }
    if (manualOnly) {
      setState({ status: 'available', version: info.version, percent: undefined, error: undefined, manualDownloadUrl: RELEASES_URL })
      if (notifiedAvailableFor !== info.version && Notification.isSupported()) {
        notifiedAvailableFor = info.version
        new Notification({
          title: 'Whisperio Update',
          body: `Version ${info.version} is available - download it from the Releases page.`
        }).show()
      }
      return
    }
    setState({ status: 'available', version: info.version, percent: 0, error: undefined, manualDownloadUrl: undefined })
    autoUpdater.downloadUpdate().catch(() => { /* reported through the 'error' event */ })
    if (notifiedAvailableFor !== info.version && Notification.isSupported()) {
      notifiedAvailableFor = info.version
      new Notification({
        title: 'Whisperio Update',
        body: `Version ${info.version} is downloading...`
      }).show()
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    setState({
      status: 'downloading',
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[Whisperio] Update downloaded: v${info.version}`)
    downloadedFile = (info as { downloadedFile?: string }).downloadedFile ?? null
    setState({ status: 'downloaded', version: info.version, percent: 100, error: undefined })
    setUpdateReady(info.version, () => installUpdate())
    if (notifiedDownloadedFor !== info.version && Notification.isSupported()) {
      notifiedDownloadedFor = info.version
      new Notification({
        title: 'Whisperio Update Ready',
        body: `Version ${info.version} is ready — restart Whisperio to install.`
      }).show()
    }
    // Legacy channel kept for any existing listeners
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('updater:ready', info.version)
      }
    })
  })

  autoUpdater.on('error', (err) => handleUpdaterError(err))

  handlersRegistered = true
  checksEnabled = enabled
  if (checksEnabled) startScheduledChecks()
}
