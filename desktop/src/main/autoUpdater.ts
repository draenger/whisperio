import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow, Notification } from 'electron'
import { setUpdateReady } from './tray'

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
}

let state: UpdaterState = {
  status: 'idle',
  currentVersion: app.getVersion()
}

// Avoid spamming the same notification on every 4h re-check
let notifiedAvailableFor: string | null = null
let notifiedDownloadedFor: string | null = null

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

/** Trigger a manual update check (returns immediately; progress arrives via updater:status). */
export function checkForUpdatesManual(): void {
  if (!autoUpdater.isUpdaterActive()) return
  setState({ status: 'checking', error: undefined })
  autoUpdater.checkForUpdates().catch((err) => {
    // Fail soft — a failed check / missing artifact must never throw a raw error at
    // the user. Log the detail, show "no update available".
    console.error('[Whisperio] Update check failed:', err?.message ?? String(err))
    setState({ status: 'not-available', version: undefined, percent: undefined, error: undefined })
  })
}

/** Quit and install a downloaded update. Safe to call only when status === 'downloaded'. */
export function installUpdate(): boolean {
  if (state.status !== 'downloaded') return false
  // isSilent=false (show installer progress), isForceRunAfter=true (relaunch after install)
  autoUpdater.quitAndInstall(false, true)
  return true
}

export function initAutoUpdater(): void {
  if (!autoUpdater.isUpdaterActive()) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking', error: undefined })
  })

  autoUpdater.on('update-not-available', () => {
    setState({ status: 'not-available', version: undefined, percent: undefined })
  })

  autoUpdater.on('update-available', (info) => {
    console.log(`[Whisperio] Update available: v${info.version}`)
    setState({ status: 'available', version: info.version, percent: 0, error: undefined })
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

  autoUpdater.on('error', (err) => {
    // Fail soft: log for debugging, but surface it as "no update" rather than a
    // scary error in the UI (covers 404 / missing artifact / offline).
    console.error('[Whisperio] Auto-update error:', err?.message ?? String(err))
    setState({ status: 'not-available', version: undefined, percent: undefined, error: undefined })
  })

  // Check for updates after 10s, then every 4 hours
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 10_000)

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 4 * 60 * 60 * 1000)
}
