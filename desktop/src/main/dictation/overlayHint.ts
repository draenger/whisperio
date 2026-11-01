/** Pure helpers for the hold-to-talk overlay hint (no electron imports). */

export type HotkeyMode = 'toggle' | 'hold'

/** Hold-to-talk needs a native key-state backend: Windows and macOS only. */
export function isHoldSupported(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin'
}

/** True when the dictate hotkeys actually run in hold mode on this platform
 * (Linux silently falls back to toggle). */
export function isHoldEffective(mode: HotkeyMode, platform: NodeJS.Platform): boolean {
  return mode === 'hold' && isHoldSupported(platform)
}

/** Hint shown in the recording overlay. Mirrors DictationOverlay.tsx. */
export function stopHint(mode: HotkeyMode, hotkey: string, platform: NodeJS.Platform): string {
  return isHoldEffective(mode, platform)
    ? `Release ${hotkey} to transcribe · Escape to cancel`
    : `Press ${hotkey} to stop · Escape to cancel`
}
