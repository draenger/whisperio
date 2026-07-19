import { globalShortcut, ipcMain, clipboard } from 'electron'
import {
  showOverlay,
  hideOverlay,
  ensureOverlayReady,
  broadcastToOverlays,
  sendToPrimaryOverlay
} from './overlayWindow'
import { autoPaste, captureTargetWindow, restoreTargetWindow, sendEnter } from './autoPaste'
import { loadSettings } from '../settingsManager'
// COMMAND mode (v1.7): rewrite the clipboard per a spoken instruction instead
// of inserting the spoken words — reuses the same LLM candidate chain as
// transcript cleanup (buildCleanupCandidates/selectProvider), it just runs a
// different prompt (llm/prompts.ts's buildCommandMessages via
// postprocess.ts's rewriteSelection). transcribe.ts's NotConfiguredError
// (thrown when no LLM provider is reachable) is caught generically below and
// surfaced via handleCommandError — see that class's doc comment for why
// command mode can't just fail soft the way transcript cleanup does.
import { rewriteClipboardForCommand } from '../transcribe'
import { handleCommandError } from '../errorHandler'

export type DictationState = 'idle' | 'recording' | 'transcribing' | 'pasting' | 'command'

// Try these hotkeys in order — first successful registration wins
const HOTKEY_CANDIDATES = [
  'Ctrl+Shift+Space',
  'Alt+Shift+Space',
  'Ctrl+Alt+D'
]

let activeHotkey: string | null = null
let activeSendHotkey: string | null = null
let activeOutputHotkey: string | null = null
let activeCommandHotkey: string | null = null

let state: DictationState = 'idle'

/**
 * Monotonic id for the current dictation session. Incremented every time a new
 * recording starts AND every time a session is cancelled / force-reset / times
 * out. The id is handed to the renderer at deactivate and echoed back with the
 * transcription result; `handleResult` drops any result whose id no longer
 * matches — so a transcription that resolves AFTER the user gave up (force-reset
 * and moved to another window) can never auto-paste stale (possibly sensitive)
 * text into the wrong app.
 */
let currentSessionId = 0

/** Start a fresh session and return its id. */
function startSession(): number {
  return ++currentSessionId
}

/** Invalidate any in-flight session so a late result is dropped. */
function invalidateSession(): void {
  currentSessionId++
}

/** When true, press Enter after pasting the result */
let sendEnterOnResult = false

/** When true, the in-flight session was started via the COMMAND hotkey — its
 * transcript is a spoken REWRITE INSTRUCTION for the clipboard, not text to
 * insert. Read (and reset) by handleResult() below, set by activateCommand(). */
let activeSessionIsCommand = false

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
        // Invalidate so a result that arrives after this timeout is dropped
        // rather than auto-pasted into whatever now has focus.
        invalidateSession()
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
      startSession()
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
      // Tag the result the renderer is about to produce with this session id.
      sendToPrimaryOverlay('dictation:deactivate', currentSessionId)
    } else if (state === 'transcribing' || state === 'pasting' || state === 'command') {
      // Stuck in transcribing/pasting, or a COMMAND-mode session is in
      // progress — force reset so the user can try again.
      // Invalidate so the abandoned transcription's result is dropped, not pasted.
      console.warn(`[Whisperio] Force-resetting from stuck "${state}" state`)
      invalidateSession()
      activeSessionIsCommand = false
      unregisterEscape()
      setState('idle')
      hideOverlay()
      restoreTargetWindow()
    }
  } catch (err) {
    console.error('[Whisperio] Error in activate():', err)
    // Force reset to idle so the user can try again
    invalidateSession()
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
      startSession()
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
      sendToPrimaryOverlay('dictation:deactivate', currentSessionId)
    } else if (state === 'transcribing' || state === 'pasting' || state === 'command') {
      console.warn(`[Whisperio] Force-resetting from stuck "${state}" state`)
      invalidateSession()
      activeSessionIsCommand = false
      unregisterEscape()
      setState('idle')
      hideOverlay()
      restoreTargetWindow()
    }
  } catch (err) {
    console.error('[Whisperio] Error in activateOutput():', err)
    invalidateSession()
    state = 'idle'
    hideOverlay()
  }
}

/**
 * COMMAND mode (v1.7): a dedicated hotkey (settings.commandHotkey) that
 * records a spoken INSTRUCTION and rewrites the current clipboard text with
 * it, instead of inserting the spoken words the way activate()/
 * activateAndSend() do. Shares the exact same recording pipeline as normal
 * dictation — 'dictation:activate' triggers the renderer's regular mic
 * capture, and 'dictation:deactivate' + 'dictation:result' hand the
 * transcript back the same way — only the STATE (`'command'` instead of
 * `'recording'`) and what handleResult() does with the transcript differ.
 */
async function activateCommand(): Promise<void> {
  try {
    console.log(`[Whisperio] Command hotkey pressed — current state: ${state}`)
    if (state === 'idle') {
      // First tap — capture target window, ensure overlay, start recording
      captureTargetWindow()
      const overlay = await ensureOverlayReady()
      if (!overlay) {
        console.error('[Whisperio] Overlay window not available — cannot activate command mode')
        return
      }
      startSession()
      activeSessionIsCommand = true
      setState('command')
      showOverlay()
      // Command mode records mic input exactly like normal dictation — the
      // spoken words are the rewrite INSTRUCTION, not text to insert.
      sendToPrimaryOverlay('dictation:activate')
      broadcastToOverlays('dictation:overlay-info', {
        sourceName: 'System Default',
        stopHotkey: activeCommandHotkey || 'hotkey',
        recordingType: 'input' as const
      })
      if (!globalShortcut.isRegistered('Escape')) {
        globalShortcut.register('Escape', cancel)
      }
    } else if (state === 'command') {
      // Second tap — stop recording, transcribe the spoken instruction
      unregisterEscape()
      setState('transcribing')
      sendToPrimaryOverlay('dictation:deactivate', currentSessionId)
    } else if (state === 'recording' || state === 'transcribing' || state === 'pasting') {
      // Another dictation mode is stuck/in-progress — force reset so the user
      // can try again rather than silently ignoring the command hotkey.
      console.warn(`[Whisperio] Force-resetting from stuck "${state}" state (command hotkey)`)
      invalidateSession()
      activeSessionIsCommand = false
      unregisterEscape()
      setState('idle')
      hideOverlay()
      restoreTargetWindow()
    }
  } catch (err) {
    console.error('[Whisperio] Error in activateCommand():', err)
    invalidateSession()
    activeSessionIsCommand = false
    state = 'idle'
    hideOverlay()
  }
}

function cancel(): void {
  // Invalidate so any in-flight transcription's result is dropped rather than
  // pasted after the user cancelled.
  invalidateSession()
  sendEnterOnResult = false
  activeSessionIsCommand = false
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

async function handleResult(
  _event: Electron.IpcMainInvokeEvent,
  text: string,
  sessionId?: number
): Promise<void> {
  // Drop results from a session the user already cancelled / force-reset / that
  // timed out. Without this, a slow transcription that resolves after the user
  // moved on would auto-paste (and possibly Enter) stale, potentially sensitive
  // text into whatever window now has focus. Checked FIRST so a stale result
  // can't consume the current session's sendEnterOnResult flag.
  if (typeof sessionId === 'number' && sessionId !== currentSessionId) {
    console.warn(
      `[Whisperio] Dropping stale transcription result (session ${sessionId} ≠ current ${currentSessionId})`
    )
    return
  }
  const shouldSend = sendEnterOnResult
  sendEnterOnResult = false
  const isCommand = activeSessionIsCommand
  activeSessionIsCommand = false
  unregisterEscape()
  if (!text || !text.trim()) {
    setState('idle')
    hideOverlay()
    restoreTargetWindow()
    return
  }
  if (isCommand) {
    await handleCommandResult(text.trim())
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

/**
 * COMMAND mode's half of handleResult(): `spokenInstruction` is the just-
 * transcribed command (e.g. "make this more formal"), NOT text to insert.
 * Rewrites the current clipboard contents with it via the app's existing
 * LLM/AI-cleanup client (transcribe.ts's rewriteClipboardForCommand, which
 * reuses the same provider chain as transcript cleanup) and pastes the
 * REWRITTEN result — never the spoken words themselves.
 */
async function handleCommandResult(spokenInstruction: string): Promise<void> {
  try {
    setState('pasting')
    hideOverlay()
    restoreTargetWindow()

    const clipboardText = clipboard.readText()
    if (!clipboardText || !clipboardText.trim()) {
      console.warn('[Whisperio] Command mode: clipboard is empty — nothing to rewrite')
      handleCommandError(new Error('Clipboard is empty. Copy some text, then use the command hotkey to rewrite it.'))
      return
    }

    const result = await rewriteClipboardForCommand(clipboardText, spokenInstruction)
    if (!result.ok) {
      // Fail-soft, same discipline as transcript cleanup: never paste
      // something the model didn't actually produce. The clipboard is left
      // exactly as the user had it.
      console.warn('[Whisperio] Command mode: rewrite failed or was rejected — clipboard left unchanged')
      handleCommandError(new Error('Rewrite failed — the clipboard text was left unchanged. Try again.'))
      return
    }

    await autoPaste(result.text)
  } catch (err) {
    // NotConfiguredError (no LLM provider set up) lands here — surfaced to
    // the overlay/user via errorHandler.ts's handleCommandError rather than
    // silently pasting the spoken words or the untouched clipboard.
    handleCommandError(err instanceof Error ? err : new Error(String(err)))
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

  // Register COMMAND-mode hotkey (defaults to Ctrl+Shift+C — see
  // settingsManager.ts's DEFAULT_SETTINGS.commandHotkey; empty string opts out)
  if (settings.commandHotkey) {
    try {
      const registered = globalShortcut.register(settings.commandHotkey, activateCommand)
      if (registered) {
        activeCommandHotkey = settings.commandHotkey
        console.log(`[Whisperio] Command hotkey ${activeCommandHotkey} registered`)
      } else {
        console.warn(`[Whisperio] Command hotkey ${settings.commandHotkey} failed to register`)
      }
    } catch (err) {
      console.error(`[Whisperio] Invalid command hotkey "${settings.commandHotkey}":`, err)
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
  if (activeCommandHotkey) {
    globalShortcut.unregister(activeCommandHotkey)
    activeCommandHotkey = null
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
  if (activeCommandHotkey) globalShortcut.unregister(activeCommandHotkey)
  console.log('[Whisperio] Hotkeys paused for recording')
}

export function resumeHotkeys(): void {
  if (activeHotkey) globalShortcut.register(activeHotkey, activate)
  if (activeSendHotkey) globalShortcut.register(activeSendHotkey, activateAndSend)
  if (activeOutputHotkey) globalShortcut.register(activeOutputHotkey, activateOutput)
  if (activeCommandHotkey) globalShortcut.register(activeCommandHotkey, activateCommand)
  console.log('[Whisperio] Hotkeys resumed')
}

export function getActiveHotkey(): string | null {
  return activeHotkey
}

export function getActiveSendHotkey(): string | null {
  return activeSendHotkey
}

export function getActiveCommandHotkey(): string | null {
  return activeCommandHotkey
}
