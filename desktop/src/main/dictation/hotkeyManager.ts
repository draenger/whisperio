import { globalShortcut, ipcMain } from 'electron'
import {
  showOverlay,
  hideOverlay,
  ensureOverlayReady,
  broadcastToOverlays,
  sendToPrimaryOverlay
} from './overlayWindow'
import { autoPaste, captureTargetWindow, restoreTargetWindow, sendEnter } from './autoPaste'
import { loadSettings } from '../settingsManager'

export type DictationState = 'idle' | 'recording' | 'transcribing' | 'pasting'

// Try these hotkeys in order — first successful registration wins
const HOTKEY_CANDIDATES = [
  'Ctrl+Shift+Space',
  'Alt+Shift+Space',
  'Ctrl+Alt+D'
]

let activeHotkey: string | null = null
let activeSendHotkey: string | null = null
let activeOutputHotkey: string | null = null

let state: DictationState = 'idle'

/** When true, press Enter after pasting the result */
let sendEnterOnResult = false

/** Safety timer — resets from 'transcribing' if no result comes back */
let transcribeTimeout: ReturnType<typeof setTimeout> | null = null
const TRANSCRIBE_TIMEOUT_MS = 60_000

export function getState(): DictationState {
  return state
}

function setState(newState: DictationState): void {
  console.log(`[Whisperio] State: ${state} → ${newState}`)
  state = newState
  broadcastToOverlays('dictation:state-changed', newState)

  // Start/clear safety timeout for transcribing state
  if (transcribeTimeout) {
    clearTimeout(transcribeTimeout)
    transcribeTimeout = null
  }
  if (newState === 'transcribing') {
    transcribeTimeout = setTimeout(() => {
      if (state === 'transcribing') {
        console.error('[Whisperio] Transcription timed out after 60s — force-resetting to idle')
        setState('idle')
        hideOverlay()
        restoreTargetWindow()
      }
    }, TRANSCRIBE_TIMEOUT_MS)
  }
}

async function activate(): Promise<void> {
  try {
    console.log(`[Whisperio] Hotkey pressed — current state: ${state}`)
    if (state === 'idle') {
      // First tap — capture target window, ensure overlay, start recording
      captureTargetWindow()
      const overlay = await ensureOverlayReady()
      if (!overlay) {
        console.error('[Whisperio] Overlay window not available — cannot activate')
        return
      }
      setState('recording')
      showOverlay()
      // Only the primary overlay records audio; all overlays show visual state
      sendToPrimaryOverlay('dictation:activate')
      // Send overlay info (audio source + hotkey) to all overlays
      broadcastToOverlays('dictation:overlay-info', {
        sourceName: 'System Default',
        stopHotkey: activeHotkey || 'hotkey',
        recordingType: 'input' as const
      })
      // Register Escape as temporary cancel shortcut
      if (!globalShortcut.isRegistered('Escape')) {
        globalShortcut.register('Escape', cancel)
      }
    } else if (state === 'recording') {
      // Second tap — stop recording, transcribe
      unregisterEscape()
      setState('transcribing')
      sendToPrimaryOverlay('dictation:deactivate')
    } else if (state === 'transcribing' || state === 'pasting') {
      // Stuck in transcribing/pasting — force reset so the user can try again
      console.warn(`[Whisperio] Force-resetting from stuck "${state}" state`)
      unregisterEscape()
      setState('idle')
      hideOverlay()
      restoreTargetWindow()
    }
  } catch (err) {
    console.error('[Whisperio] Error in activate():', err)
    // Force reset to idle so the user can try again
    state = 'idle'
    hideOverlay()
  }
}

async function activateAndSend(): Promise<void> {
  sendEnterOnResult = true
  await activate()
}

async function activateOutput(): Promise<void> {
  try {
    console.log(`[Whisperio] Output hotkey pressed — current state: ${state}`)
    if (state === 'idle') {
      captureTargetWindow()
      const overlay = await ensureOverlayReady()
      if (!overlay) {
        console.error('[Whisperio] Overlay window not available — cannot activate output recording')
        return
      }
      setState('recording')
      showOverlay()
      sendToPrimaryOverlay('dictation:activate-output')
      broadcastToOverlays('dictation:overlay-info', {
        sourceName: 'System Audio',
        stopHotkey: activeOutputHotkey || 'hotkey',
        recordingType: 'output' as const
      })
      if (!globalShortcut.isRegistered('Escape')) {
        globalShortcut.register('Escape', cancel)
      }
    } else if (state === 'recording') {
      unregisterEscape()
      setState('transcribing')
      sendToPrimaryOverlay('dictation:deactivate')
    } else if (state === 'transcribing' || state === 'pasting') {
      console.warn(`[Whisperio] Force-resetting from stuck "${state}" state`)
      unregisterEscape()
      setState('idle')
      hideOverlay()
      restoreTargetWindow()
    }
  } catch (err) {
    console.error('[Whisperio] Error in activateOutput():', err)
    state = 'idle'
    hideOverlay()
  }
}

function cancel(): void {
  sendEnterOnResult = false
  unregisterEscape()
  sendToPrimaryOverlay('dictation:cancel')
  setState('idle')
  hideOverlay()
  restoreTargetWindow()
}

function unregisterEscape(): void {
  if (globalShortcut.isRegistered('Escape')) {
    globalShortcut.unregister('Escape')
  }
}

async function handleResult(_event: Electron.IpcMainInvokeEvent, text: string): Promise<void> {
  const shouldSend = sendEnterOnResult
  sendEnterOnResult = false
  unregisterEscape()
  if (!text || !text.trim()) {
    setState('idle')
    hideOverlay()
    restoreTargetWindow()
    return
  }
  try {
    setState('pasting')
    hideOverlay()
    restoreTargetWindow()
    await autoPaste(text.trim())
    if (shouldSend) {
      // Small delay so the paste lands before Enter
      await new Promise((r) => setTimeout(r, 100))
      sendEnter()
      console.log('[Whisperio] Sent Enter after paste (dictate-and-send)')
    }
  } catch (err) {
    console.error('[Whisperio] Error during paste:', err)
  } finally {
    setState('idle')
  }
}

export function registerHotkey(): void {
  // Clear any stale shortcuts from previous crashed instances
  globalShortcut.unregisterAll()

  const settings = loadSettings()

  // Register main dictation hotkey
  if (settings.dictationHotkey) {
    // User configured a custom hotkey — try it first, fall back to candidates
    try {
      const registered = globalShortcut.register(settings.dictationHotkey, activate)
      if (registered) {
        activeHotkey = settings.dictationHotkey
        console.log(`[Whisperio] Custom dictation hotkey ${activeHotkey} registered`)
      } else {
        console.warn(`[Whisperio] Custom hotkey ${settings.dictationHotkey} failed — trying candidates`)
        registerFromCandidates()
      }
    } catch (err) {
      console.error(`[Whisperio] Invalid dictation hotkey "${settings.dictationHotkey}":`, err)
      registerFromCandidates()
    }
  } else {
    registerFromCandidates()
  }

  // Register dictate-and-send hotkey
  if (settings.dictateAndSendHotkey) {
    try {
      const registered = globalShortcut.register(settings.dictateAndSendHotkey, activateAndSend)
      if (registered) {
        activeSendHotkey = settings.dictateAndSendHotkey
        console.log(`[Whisperio] Dictate-and-send hotkey ${activeSendHotkey} registered`)
      } else {
        console.warn(`[Whisperio] Dictate-and-send hotkey ${settings.dictateAndSendHotkey} failed to register`)
      }
    } catch (err) {
      console.error(`[Whisperio] Invalid dictate-and-send hotkey "${settings.dictateAndSendHotkey}":`, err)
    }
  }

  // Register output recording hotkey
  if (settings.outputRecordingHotkey) {
    try {
      const registered = globalShortcut.register(settings.outputRecordingHotkey, activateOutput)
      if (registered) {
        activeOutputHotkey = settings.outputRecordingHotkey
        console.log(`[Whisperio] Output recording hotkey ${activeOutputHotkey} registered`)
      } else {
        console.warn(`[Whisperio] Output recording hotkey ${settings.outputRecordingHotkey} failed to register`)
      }
    } catch (err) {
      console.error(`[Whisperio] Invalid output recording hotkey "${settings.outputRecordingHotkey}":`, err)
    }
  }

  ipcMain.on('dictation:cancel', cancel)
  ipcMain.handle('dictation:result', handleResult)
}

function registerFromCandidates(): void {
  for (const hotkey of HOTKEY_CANDIDATES) {
    const registered = globalShortcut.register(hotkey, activate)
    if (registered) {
      activeHotkey = hotkey
      console.log(`[Whisperio] Global shortcut ${hotkey} registered successfully`)
      break
    } else {
      console.warn(`[Whisperio] ${hotkey} unavailable — trying next`)
    }
  }

  if (!activeHotkey) {
    console.error(
      '[Whisperio] ALL hotkey candidates failed to register: ' +
      HOTKEY_CANDIDATES.join(', ') +
      '. Close other apps that may claim these shortcuts.'
    )
  }
}

export function unregisterHotkey(): void {
  if (activeHotkey) {
    globalShortcut.unregister(activeHotkey)
    activeHotkey = null
  }
  if (activeSendHotkey) {
    globalShortcut.unregister(activeSendHotkey)
    activeSendHotkey = null
  }
  if (activeOutputHotkey) {
    globalShortcut.unregister(activeOutputHotkey)
    activeOutputHotkey = null
  }
  unregisterEscape()
  ipcMain.removeListener('dictation:cancel', cancel)
  ipcMain.removeHandler('dictation:result')
}

export function reRegisterHotkeys(): void {
  unregisterHotkey()
  registerHotkey()
}

export function pauseHotkeys(): void {
  if (activeHotkey) globalShortcut.unregister(activeHotkey)
  if (activeSendHotkey) globalShortcut.unregister(activeSendHotkey)
  if (activeOutputHotkey) globalShortcut.unregister(activeOutputHotkey)
  console.log('[Whisperio] Hotkeys paused for recording')
}

export function resumeHotkeys(): void {
  if (activeHotkey) globalShortcut.register(activeHotkey, activate)
  if (activeSendHotkey) globalShortcut.register(activeSendHotkey, activateAndSend)
  if (activeOutputHotkey) globalShortcut.register(activeOutputHotkey, activateOutput)
  console.log('[Whisperio] Hotkeys resumed')
}

export function getActiveHotkey(): string | null {
  return activeHotkey
}

export function getActiveSendHotkey(): string | null {
  return activeSendHotkey
}
