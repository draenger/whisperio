import { createOverlayWindow, destroyOverlay } from './overlayWindow'
import { registerHotkey, unregisterHotkey, getActiveHotkey, reRegisterHotkeys, pauseHotkeys, resumeHotkeys } from './hotkeyManager'
import { ensureAccessibilityPermission } from './autoPaste'

export { reRegisterHotkeys, pauseHotkeys, resumeHotkeys }

export function initDictation(): void {
  createOverlayWindow()
  registerHotkey()
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
  unregisterHotkey()
  destroyOverlay()
}
