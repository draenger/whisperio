import { loadSettings, areSettingsUnavailable } from './settingsManager'

interface LoginItemApp {
  setLoginItemSettings(settings: { openAtLogin: boolean; path: string }): void
}

/**
 * Apply the launch-at-startup setting to the OS at boot. Skipped entirely
 * while settings.json is unreadable (locked): loadSettings() then returns
 * DEFAULTS, and acting on them would silently re-enable autostart the user
 * turned off. Returns true when the OS setting was applied.
 */
export function applyLaunchAtStartup(app: LoginItemApp, isPackaged: boolean, execPath: string): boolean {
  if (!isPackaged) return false
  const settings = loadSettings()
  if (areSettingsUnavailable()) {
    console.warn('[Whisperio] settings unavailable at startup; leaving launch-at-startup unchanged.')
    return false
  }
  app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup, path: execPath })
  return true
}

interface FatalApp {
  exit(code?: number): void
}
interface FatalDialog {
  showErrorBox(title: string, content: string): void
}

/**
 * A startup failure leaves the process holding the single-instance lock with
 * no tray/hotkeys/window, so it must be fatal and visible: log the full error
 * (startup errors are code errors, not settings values), show a dialog, exit 1.
 */
export function handleStartupFailure(err: unknown, dialog: FatalDialog, app: FatalApp): void {
  console.error('[Whisperio] startup failed:', err instanceof Error ? (err.stack ?? err.message) : err)
  const short = err instanceof Error ? err.message : String(err)
  try {
    dialog.showErrorBox('Whisperio failed to start', short.slice(0, 300))
  } finally {
    app.exit(1)
  }
}
