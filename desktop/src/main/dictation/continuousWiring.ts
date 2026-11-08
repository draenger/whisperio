// Electron wiring for continuous mode: builds the controller with real deps,
// owns the global shortcut. Kept separate from continuousMode.ts so the core
// stays Electron-free.
import { globalShortcut, shell } from 'electron'
import { loadSettings } from '../settingsManager'
import { getActiveWindowRef } from '../context'
import { autoPaste, sendEnter } from './autoPaste'
import { sendToPrimaryOverlay } from './overlayWindow'
import { playCue } from './buttonCues'
import {
  ContinuousController,
  registerContinuousController,
  type ContinuousSettings
} from './continuousMode'

let controller: ContinuousController | null = null
let registeredHotkey: string | null = null
let stateListener: ((active: boolean) => void) | null = null

function readSettings(): ContinuousSettings {
  const s = loadSettings()
  return {
    continuousAutoSend: s.continuousAutoSend,
    continuousSilenceMs: s.continuousSilenceMs,
    continuousMinUtteranceMs: s.continuousMinUtteranceMs,
    continuousPinTarget: s.continuousPinTarget,
    continuousThresholdDbfs: s.continuousThresholdDbfs,
    continuousEchoGuardMs: s.continuousEchoGuardMs
  }
}

export function getContinuousController(): ContinuousController {
  if (!controller) {
    controller = new ContinuousController({
      getSettings: readSettings,
      getActiveWindow: getActiveWindowRef,
      paste: async (text) => {
        await autoPaste(text)
        playCue('sent')
      },
      sendEnter: () => sendEnter(),
      beep: () => {
        shell.beep()
        playCue('held')
      },
      notifyRenderer: (msg) => {
        if (msg.channel === 'continuous:start') sendToPrimaryOverlay('continuous:start', msg.settings)
        else if (msg.channel === 'continuous:stop') sendToPrimaryOverlay('continuous:stop')
        else sendToPrimaryOverlay('continuous:state', msg.state)
      },
      onStateChange: (active) => {
        sendToPrimaryOverlay('continuous:state', { active })
        stateListener?.(active)
      },
      log: (m) => console.log(`[Whisperio] ${m}`)
    })
    registerContinuousController(controller)
  }
  return controller
}

/** Tray subscribes here to refresh its checkbox/tooltip. */
export function setContinuousStateListener(fn: ((active: boolean) => void) | null): void {
  stateListener = fn
}

/** (Re)register the continuous hotkey from settings. Safe to call repeatedly. */
export function registerContinuousHotkey(): void {
  const c = getContinuousController()
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey)
    registeredHotkey = null
  }
  const accel = loadSettings().continuousHotkey
  if (!accel) return
  try {
    if (globalShortcut.register(accel, () => void c.toggle())) {
      registeredHotkey = accel
    } else {
      console.warn(`[Whisperio] Continuous hotkey ${accel} could not be registered`)
    }
  } catch (err) {
    console.warn('[Whisperio] Continuous hotkey invalid:', err instanceof Error ? err.message : err)
  }
}

export function unregisterContinuousHotkey(): void {
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey)
    registeredHotkey = null
  }
  controller?.stop()
}
