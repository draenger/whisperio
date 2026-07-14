import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Built main-process entry point (npm run build's electron-vite output —
// package.json's "main" field points here too). `test:e2e` rebuilds before
// running; `test:e2e:fast` assumes a build already exists.
const MAIN_ENTRY = join(__dirname, '..', 'out', 'main', 'index.js')

/**
 * Minimal shape of the settings.json fields these specs care about seeding.
 * Deliberately NOT imported from src/main/settingsManager.ts — that module
 * does `import { app } from 'electron'` at the top, which can't be required
 * from Playwright's plain-node test process (no Electron main-process context
 * here). Same "own local copy" pattern the renderer/preload code already uses
 * for this settings shape (see CleanupPanel.tsx's KONTRAKT note). Any field
 * left unset here falls back to settingsManager's DEFAULT_SETTINGS, since
 * loadSettings() merges `{ ...DEFAULT_SETTINGS, ...parsed }`.
 */
export type SeedSettings = Record<string, unknown>

/** Minimal shape of a recordingStore.ts RecordingEntry, for seeding index.json. */
export interface SeedRecording {
  id: string
  filename: string
  filepath: string
  timestamp: number
  duration: number
  status: 'completed' | 'failed' | 'pending'
  provider: string
  transcription?: string
  error?: string
  size: number
}

/** Minimal shape of usageTracker.ts's on-disk usage.json (providerId -> "YYYY-MM" -> bucket). */
export type SeedUsage = Record<string, Record<string, {
  requests: number
  inputTokens: number
  outputTokens: number
  audioSeconds: number
  estimatedCostUsd: number
  credits: number
}>>

export interface LaunchedApp {
  app: ElectronApplication
  userDataDir: string
}

/**
 * Write settings.json / recordings/index.json / usage.json into a fresh temp
 * userData dir BEFORE the app ever starts, so first read (loadSettings/
 * getRecordings/getUsage) already sees the seeded state — no IPC round-trip
 * needed to arrange fixture data. Mirrors the on-disk shapes
 * settingsManager.ts / recordingStore.ts / usageTracker.ts write themselves
 * (plain JSON, no envelope).
 */
function seedUserDataDir(
  dir: string,
  opts: { settings?: SeedSettings; recordings?: SeedRecording[]; usage?: SeedUsage }
): void {
  if (opts.settings) {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(opts.settings, null, 2), 'utf-8')
  }
  if (opts.recordings) {
    const recordingsDir = join(dir, 'recordings')
    mkdirSync(recordingsDir, { recursive: true })
    writeFileSync(
      join(recordingsDir, 'index.json'),
      JSON.stringify({ recordings: opts.recordings }, null, 2),
      'utf-8'
    )
  }
  if (opts.usage) {
    writeFileSync(join(dir, 'usage.json'), JSON.stringify(opts.usage, null, 2), 'utf-8')
  }
}

/**
 * Launch the real built app (out/main/index.js) with a disposable temp
 * userData dir (via WHISPERIO_USER_DATA_DIR — see src/main/index.ts), so
 * these click-tests can never read or clobber a real developer's
 * settings/recordings/usage. Each call gets its own directory: tests never
 * share app state, and can run serially without interfering with each other.
 */
export async function launchApp(opts: {
  settings?: SeedSettings
  recordings?: SeedRecording[]
  usage?: SeedUsage
} = {}): Promise<LaunchedApp> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'whisperio-e2e-'))
  seedUserDataDir(userDataDir, opts)

  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      WHISPERIO_USER_DATA_DIR: userDataDir
    }
  })

  return { app, userDataDir }
}

/** Closes the app and deletes its temp userData dir. Never throws — a failed
 * teardown must not mask the real test failure/success. */
export async function closeApp({ app, userDataDir }: LaunchedApp): Promise<void> {
  await app.close().catch(() => {})
  rmSync(userDataDir, { recursive: true, force: true })
}

/**
 * Opens (or focuses, if already open) the Settings window — the same path
 * the real app uses on macOS Dock-click / second-instance-launch (see
 * src/main/index.ts's `app.on('activate', ...)` and `'second-instance'`
 * handlers, both of which call `openSettingsWindow()`). The app is tray-based
 * with no persistent main window, so emitting 'activate' on the main-process
 * `app` object is the supported way to reach it headlessly, without needing
 * to simulate an actual tray-icon click (Electron doesn't expose one).
 */
export async function openSettingsWindow(electronApp: ElectronApplication): Promise<Page> {
  const existing = electronApp.windows().find((w) => w.url().includes('settings.html'))
  if (existing && !existing.isClosed()) {
    await electronApp.evaluate(({ app }) => app.emit('activate'))
    await existing.waitForLoadState('domcontentloaded')
    return existing
  }

  const windowPromise = electronApp.waitForEvent('window')
  await electronApp.evaluate(({ app }) => app.emit('activate'))
  const page = await windowPromise
  await page.waitForLoadState('domcontentloaded')
  // window.api (the contextBridge surface) is attached by the preload script
  // at document-start — by domcontentloaded it's guaranteed present, but wait
  // explicitly so a slow-starting renderer never races the first `page.evaluate`.
  await page.waitForFunction(() => typeof (window as unknown as { api?: unknown }).api !== 'undefined')
  return page
}

/** Clicks a sidebar nav tab in the Settings window by its visible label
 * (e.g. 'Providers', 'Recordings', 'Usage') and waits for the click to land. */
export async function openTab(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click()
}
