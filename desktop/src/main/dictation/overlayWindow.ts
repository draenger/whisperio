import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/** One overlay window per display, keyed by display ID */
const overlayWindows: Map<number, BrowserWindow> = new Map()
/** Track which windows have finished loading */
const overlayReadyState: Map<number, boolean> = new Map()
/** Promises that resolve when each window finishes loading */
const overlayReadyPromises: Map<number, Promise<void>> = new Map()
const overlayReadyResolvers: Map<number, () => void> = new Map()

/**
 * Returns the first active overlay window (for backwards compat with IPC).
 */
export function getOverlayWindow(): BrowserWindow | null {
  for (const win of overlayWindows.values()) {
    if (!win.isDestroyed()) return win
  }
  return null
}

/**
 * Send an IPC message to ALL overlay windows.
 */
export function broadcastToOverlays(channel: string, ...args: unknown[]): void {
  for (const win of overlayWindows.values()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
}

/**
 * Send an IPC message to only the FIRST (primary) overlay window.
 * Used for recording commands so only one window actually records audio.
 */
export function sendToPrimaryOverlay(channel: string, ...args: unknown[]): void {
  for (const win of overlayWindows.values()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
      return
    }
  }
}

/**
 * Get or recreate all overlay windows, ensuring they're fully loaded.
 * Returns the first active window, or null if creation fails.
 */
export async function ensureOverlayReady(): Promise<BrowserWindow | null> {
  const displays = screen.getAllDisplays()
  const existingIds = new Set(overlayWindows.keys())
  const currentIds = new Set(displays.map((d) => d.id))

  // Create windows for any displays that don't have one yet
  for (const display of displays) {
    if (!existingIds.has(display.id) || overlayWindows.get(display.id)?.isDestroyed()) {
      console.log(`[Whisperio] Overlay window missing for display ${display.id} — creating`)
      createOverlayForDisplay(display)
    }
  }

  // Wait for all windows to finish loading
  const promises: Promise<void>[] = []
  for (const [id, ready] of overlayReadyState.entries()) {
    if (!ready && currentIds.has(id)) {
      const promise = overlayReadyPromises.get(id)
      if (promise) promises.push(promise)
    }
  }
  if (promises.length > 0) {
    console.log('[Whisperio] Waiting for overlay windows to finish loading...')
    await Promise.all(promises)
  }

  return getOverlayWindow()
}

/**
 * Create one overlay window for a specific display, positioned at bottom-center.
 */
function createOverlayForDisplay(display: Electron.Display): BrowserWindow {
  const existing = overlayWindows.get(display.id)
  if (existing && !existing.isDestroyed()) {
    return existing
  }

  const readyPromise = new Promise<void>((resolve) => {
    overlayReadyResolvers.set(display.id, resolve)
  })
  overlayReadyPromises.set(display.id, readyPromise)
  overlayReadyState.set(display.id, false)

  const win = new BrowserWindow({
    width: 420,
    height: 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    // focusable must be true on Windows for getUserMedia to work
    focusable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  // Position at bottom-center of this display's work area
  positionOverlayOnDisplay(win, display)

  const url = is.dev && process.env['ELECTRON_RENDERER_URL']
    ? `${process.env['ELECTRON_RENDERER_URL']}/dictation/overlay.html`
    : null
  const filePath = join(__dirname, '../renderer/dictation/overlay.html')

  if (url) {
    console.log(`[Whisperio] Loading overlay for display ${display.id} from URL: ${url}`)
    win.loadURL(url).catch((err) => {
      console.error(`[Whisperio] Failed to load overlay URL for display ${display.id}:`, err)
    })
  } else {
    console.log(`[Whisperio] Loading overlay for display ${display.id} from file: ${filePath}`)
    win.loadFile(filePath).catch((err) => {
      console.error(`[Whisperio] Failed to load overlay file for display ${display.id}:`, err)
    })
  }

  win.webContents.on('did-finish-load', () => {
    overlayReadyState.set(display.id, true)
    console.log(`[Whisperio] Overlay window for display ${display.id} loaded successfully`)
    const resolve = overlayReadyResolvers.get(display.id)
    if (resolve) {
      resolve()
      overlayReadyResolvers.delete(display.id)
    }
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    overlayReadyState.set(display.id, false)
    console.error(
      `[Whisperio] Overlay for display ${display.id} failed to load: ${errorCode} ${errorDescription}`
    )
  })

  win.on('closed', () => {
    overlayWindows.delete(display.id)
    overlayReadyState.delete(display.id)
    overlayReadyPromises.delete(display.id)
    overlayReadyResolvers.delete(display.id)
  })

  overlayWindows.set(display.id, win)
  return win
}

/**
 * Position the overlay at the bottom-center of the given display's work area.
 */
function positionOverlayOnDisplay(win: BrowserWindow, display: Electron.Display): void {
  const { x: wx, y: wy, width, height } = display.workArea
  const overlayWidth = 420
  const x = Math.round(wx + (width - overlayWidth) / 2)
  const y = wy + height - 140
  win.setPosition(x, y)
}

/**
 * Create overlay windows for ALL displays.
 */
export function createOverlayWindow(): void {
  const displays = screen.getAllDisplays()
  for (const display of displays) {
    createOverlayForDisplay(display)
  }

  // Dynamically add/remove overlays when displays change
  screen.on('display-added', (_event, newDisplay) => {
    console.log(`[Whisperio] Display added: ${newDisplay.id} — creating overlay`)
    createOverlayForDisplay(newDisplay)
  })

  screen.on('display-removed', (_event, oldDisplay) => {
    console.log(`[Whisperio] Display removed: ${oldDisplay.id} — destroying overlay`)
    const win = overlayWindows.get(oldDisplay.id)
    if (win && !win.isDestroyed()) {
      win.close()
    }
    overlayWindows.delete(oldDisplay.id)
    overlayReadyState.delete(oldDisplay.id)
    overlayReadyPromises.delete(oldDisplay.id)
    overlayReadyResolvers.delete(oldDisplay.id)
  })
}

export function showOverlay(): void {
  for (const [displayId, win] of overlayWindows.entries()) {
    if (win.isDestroyed()) continue
    // Reposition to the correct display (in case work area changed)
    const display = screen.getAllDisplays().find((d) => d.id === displayId)
    if (display) {
      positionOverlayOnDisplay(win, display)
    }
    // showInactive keeps focus on the user's window.
    // setAlwaysOnTop with 'screen-saver' level ensures the overlay is visible
    // above everything. moveTop forces a repaint on Windows.
    win.showInactive()
    win.setAlwaysOnTop(true, 'screen-saver')
    win.moveTop()
  }
}

export function hideOverlay(): void {
  for (const win of overlayWindows.values()) {
    if (!win.isDestroyed()) {
      win.hide()
    }
  }
}

export function destroyOverlay(): void {
  for (const win of overlayWindows.values()) {
    if (!win.isDestroyed()) {
      win.close()
    }
  }
  overlayWindows.clear()
  overlayReadyState.clear()
  overlayReadyPromises.clear()
  overlayReadyResolvers.clear()
}
