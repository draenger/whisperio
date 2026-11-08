// Electron wiring for the headset button: globalShortcut registration, WM_APPCOMMAND
// hook, WebHID permission + device picker, learn-session IPC. The decision logic
// lives in headsetButton.ts / buttonTrigger.ts (unit-tested, dependency-injected).
import { app, BrowserWindow, globalShortcut, ipcMain, type Session } from 'electron'
import { loadSettings, saveSettings } from '../settingsManager'
import {
  appCommandFromLParam,
  type HidReport,
  type LearnEvent
} from '../buttonTrigger'
import {
  createHeadsetButton,
  createLearnSession,
  type HeadsetButton,
  type LearnResult,
  type LearnSession
} from './headsetButton'
import { buttonToggle } from './hotkeyManager'
import { toggleContinuousMode } from './continuousMode'
import { broadcastToOverlays } from './overlayWindow'
import { getFocusController } from './focusTarget'
import { playCue } from './buttonCues'
import { notifyInfo } from '../errorHandler'
import { getSettingsWindow } from '../settingsWindow'

const WM_APPCOMMAND = 0x0319
const PROBE_KEYS = [
  'MediaPlayPause',
  'MediaNextTrack',
  'MediaPreviousTrack',
  'MediaStop',
  'VolumeMute',
  ...Array.from({ length: 12 }, (_, i) => `F${13 + i}`)
]

const logRing: string[] = []
function log(msg: string): void {
  console.log(`[Whisperio] ${msg}`)
  logRing.push(`${new Date().toISOString()} ${msg}`)
  if (logRing.length > 300) logRing.shift()
}

let button: HeadsetButton | null = null
let learn: LearnSession | null = null
let learnSender: Electron.WebContents | null = null

export function applyHeadsetButton(): void {
  if (!button) return
  const s = loadSettings()
  button.apply({
    buttonTrigger: s.buttonTrigger,
    buttonTriggerSwallow: s.buttonTriggerSwallow,
    buttonAction: s.buttonAction
  })
  broadcastToOverlays('button:config-changed')
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function parseLearnEvent(raw: unknown): LearnEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, 64) : undefined)
  if (r.source === 'keyboard') {
    return { source: 'keyboard', key: str(r.key), code: str(r.code), keyCode: isInt(r.keyCode) ? r.keyCode : undefined }
  }
  if (r.source === 'hid') {
    if (!isInt(r.vendorId) || !isInt(r.productId) || !isInt(r.reportId) || !Array.isArray(r.data)) return null
    const data = r.data.slice(0, 64).map((b) => (isInt(b) ? b & 0xff : 0))
    return {
      source: 'hid',
      vendorId: r.vendorId,
      productId: r.productId,
      reportId: r.reportId,
      usagePage: isInt(r.usagePage) ? r.usagePage : undefined,
      usage: isInt(r.usage) ? r.usage : undefined,
      data
    }
  }
  return null
}

function startProbes(feed: (ev: LearnEvent) => void): () => void {
  const ok: string[] = []
  for (const key of PROBE_KEYS) {
    try {
      // Skip keys already owned by a live Whisperio hotkey.
      if (globalShortcut.isRegistered(key)) continue
      if (globalShortcut.register(key, () => feed({ source: 'globalShortcut', accelerator: key }))) ok.push(key)
      else log(`[button-learn] probe ${key} could not be registered (taken by another app)`)
    } catch (err) {
      log(`[button-learn] probe ${key} error: ${(err as Error)?.message}`)
    }
  }
  return () => {
    for (const k of ok) {
      try {
        globalShortcut.unregister(k)
      } catch {
        /* already gone */
      }
    }
  }
}

function onLearnResult(r: LearnResult): void {
  button?.setPaused(false)
  if (r.ok) {
    const patch: Parameters<typeof saveSettings>[0] = { buttonTrigger: r.trigger }
    // Keys can only be observed by consuming them (globalShortcut): force swallow on.
    if (r.trigger.kind === 'accelerator') patch.buttonTriggerSwallow = true
    try {
      saveSettings(patch)
    } catch (err) {
      log(`[button-learn] save failed: ${(err as Error)?.message}`)
    }
    applyHeadsetButton()
  }
  if (learnSender && !learnSender.isDestroyed()) learnSender.send('button:learn-result', r)
  learnSender = null
}

let pendingHidChoice: ((id?: string) => void) | null = null

/** Replace the old deny-all device handler: WebHID only for our own windows. */
export function installHidAccess(ses: Session, isInternal: (url: string | undefined) => boolean): void {
  ses.setDevicePermissionHandler((details) => details.deviceType === 'hid' && isInternal(details.origin))
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault()
    const win = getSettingsWindow()
    pendingHidChoice?.()
    if (!win || win.isDestroyed()) {
      pendingHidChoice = null
      callback()
      return
    }
    pendingHidChoice = callback
    win.webContents.send(
      'hid:select-request',
      details.deviceList.map((d) => ({ deviceId: d.deviceId, name: d.name, vendorId: d.vendorId, productId: d.productId }))
    )
  })
}

let pinTimer: ReturnType<typeof setTimeout> | null = null

/** Tray: "Przypnij bieżące okno". The tray click itself steals focus, so pin shortly after the menu closes. */
export function pinCurrentWindowSoon(delayMs = 3000): void {
  notifyInfo('Whisperio', `Za ${Math.round(delayMs / 1000)} s przypnę aktywne okno jako cel wklejania.`)
  if (pinTimer) clearTimeout(pinTimer)
  pinTimer = setTimeout(() => {
    pinTimer = null
    getFocusController()
      .pinForeground()
      .then((t) => {
        if (t) {
          log(`[headset-button] pinned window handle=${t.handle} pid=${t.pid}`)
          playCue('held')
        } else {
          notifyInfo('Whisperio', 'Nie udało się przypiąć okna (aktywne okno to Whisperio albo brak okna).')
        }
      })
      .catch((err) => log(`[headset-button] pin failed: ${(err as Error)?.message}`))
  }, delayMs)
}

export function initHeadsetButton(): void {
  button = createHeadsetButton({
    dictateToggle: () => buttonToggle(),
    continuousToggle: () => toggleContinuousMode(),
    registerAccelerator: (a, cb) => globalShortcut.register(a, cb),
    unregisterAccelerator: (a) => globalShortcut.unregister(a),
    now: () => Date.now(),
    log
  })
  learn = createLearnSession({
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    log,
    startProbes,
    onResult: onLearnResult
  })

  const onAppCommand = (id: number): void => {
    learn?.feed({ source: 'appcommand', id })
    button?.handleAppCommand(id)
  }
  if (process.platform === 'win32') {
    // WM_APPCOMMAND is delivered only to a window that has focus (Windows
    // limitation) — useful for learning/diagnosis, not for a headset button
    // pressed while another app is active.
    app.on('browser-window-created', (_e, win: BrowserWindow) => {
      try {
        win.hookWindowMessage(WM_APPCOMMAND, (_wParam, lParam) => {
          const id = appCommandFromLParam(lParam)
          if (id) onAppCommand(id)
        })
      } catch (err) {
        log(`[button-learn] hookWindowMessage failed: ${(err as Error)?.message}`)
      }
    })
  }

  ipcMain.handle('button:learn-start', (event) => {
    if (learn?.isActive()) return false
    learnSender = event.sender
    button?.setPaused(true)
    learn?.start()
    return true
  })
  ipcMain.on('button:learn-cancel', () => learn?.cancel())
  ipcMain.on('button:learn-event', (_e, raw: unknown) => {
    const ev = parseLearnEvent(raw)
    if (ev) learn?.feed(ev)
  })
  ipcMain.on('button:hid-report', (_e, raw: unknown) => {
    const r = raw as Partial<HidReport> | null
    if (!r || !isInt(r.vendorId) || !isInt(r.productId) || !isInt(r.reportId) || !Array.isArray(r.data)) return
    button?.handleHidReport({
      vendorId: r.vendorId,
      productId: r.productId,
      reportId: r.reportId,
      data: r.data.slice(0, 64).map((b) => (isInt(b) ? b & 0xff : 0))
    })
  })
  ipcMain.handle('button:clear', () => {
    saveSettings({ buttonTrigger: null })
    applyHeadsetButton()
  })
  ipcMain.handle('button:get-log', () => logRing.slice())
  ipcMain.handle('button:pin-current', () => pinCurrentWindowSoon())
  ipcMain.on('hid:select-reply', (_e, id: unknown) => {
    const cb = pendingHidChoice
    pendingHidChoice = null
    cb?.(typeof id === 'string' && id ? id : undefined)
  })

  applyHeadsetButton()
}

/** Used when other code calls globalShortcut.unregisterAll() (hotkey re-registration). */
export function reapplyHeadsetButton(): void {
  applyHeadsetButton()
}

export function disposeHeadsetButton(): void {
  button?.dispose()
  learn?.cancel()
}
