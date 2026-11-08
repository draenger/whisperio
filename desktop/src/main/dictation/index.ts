import { createOverlayWindow, destroyOverlay } from './overlayWindow'
import { registerHotkey, unregisterHotkey, getActiveHotkey, reRegisterHotkeys as reRegisterNormalHotkeys, pauseHotkeys, resumeHotkeys, cliToggle, cliSend, cliStart, cliStop, cliCancel } from './hotkeyManager'
import { ensureAccessibilityPermission } from './autoPaste'
import { flushPendingClipboardRestore } from './clipboardRestore'
import { registerContinuousHotkey, unregisterContinuousHotkey } from './continuousWiring'

export { pauseHotkeys, resumeHotkeys, cliToggle, cliSend, cliStart, cliStop, cliCancel }

/** registerHotkey() clears every global shortcut, so the continuous one is re-added after it. */
export function reRegisterHotkeys(): void {
  reRegisterNormalHotkeys()
  registerContinuousHotkey()
}

export function initDictation(): void {
  createOverlayWindow()
  registerHotkey()
  registerContinuousHotkey()
  // macOS: prompt for Accessibility up front so auto-paste (⌘V) works after dictation.
  ensureAccessibilityPermission(true)
  const key = getActiveHotkey()
  if (key) {
    console.log(`[Whisperio] Module initialized — ${key} to activate`)
  } else {
    console.error('[Whisperio] Module initialized but NO hotkey registered!')
  }
}

export function cleanupDictation(): void {
  // Best effort: put the user's clipboard back before quitting.
  flushPendingClipboardRestore()
  unregisterContinuousHotkey()
  unregisterHotkey()
  destroyOverlay()
}
