// Context-aware tone (v1.5 Work Item B).
//
// PRIVACY CONTRACT — hard moat, do not weaken:
//   This module is the ONLY place in the whole app that touches `active-win`.
//   It reads the foreground process name and, only when the caller explicitly
//   opts in (see GetActiveContextOptions.includeWindowTitle below), the
//   window title. It NEVER touches screen pixels — no desktopCapturer, no
//   Electron's `screen` module, no nativeImage, no getUserMedia — and the
//   ONLY external module this file imports is `active-win` (plus types).
//   tests/context.test.ts's privacy test parses this file's source and
//   enforces both of those facts mechanically, not just by convention/review.
//
// macOS note (researched against active-win's own README): activeWindow()
// takes `accessibilityPermission` / `screenRecordingPermission` booleans,
// each defaulting to `true`, each independently gating an OS permission
// PROMPT on macOS 10.15+. `accessibilityPermission` only affects whether the
// browser-tab `url` field is populated — we never read that field, so it's
// always passed as `false` here, full stop. `screenRecordingPermission` is
// what gates `title` — when `false`, `title` always comes back `''` and NO
// permission prompt fires. Since resolveToneProfile() below matches on
// `processName` only (window titles aren't matched against yet — kept on the
// context for display/future extension), the title-less default is already
// enough to drive tone mapping. `includeWindowTitle` only ever becomes `true`
// when the user explicitly clicks "Enable window-title matching" in Settings
// (see ContextTonePanel.tsx / main/index.ts's context:enableWindowTitleMatching
// handler) — that one user gesture is the only place this module is ever
// asked to trigger the Screen Recording prompt.
import activeWindow from 'active-win'
import type { ToneProfileId } from './llm/prompts'

export interface DictationContext {
  processName: string
  windowTitle: string
}

export interface GetActiveContextOptions {
  /** See the file header's macOS note. Default false — never triggers the
   * Screen Recording permission prompt. */
  includeWindowTitle?: boolean
}

// Fail-soft + log-once: a permissions gap or an unsupported platform must
// never break dictation, and must never spam stdout on every single
// dictation attempt.
let loggedFailureOnce = false

/**
 * Best-effort snapshot of the foreground app at the moment this is called.
 * Resolves to `null` on ANY error (missing permission, unsupported platform,
 * no active window, native binding failure) — this never throws, and callers
 * treat `null` exactly like "no context available" (resolveToneProfile below
 * falls back to 'neutral'), never as a fatal error that could break dictation.
 */
export async function getActiveContext(
  opts: GetActiveContextOptions = {}
): Promise<DictationContext | null> {
  try {
    const win = await activeWindow({
      accessibilityPermission: false,
      screenRecordingPermission: !!opts.includeWindowTitle
    })
    if (!win) return null
    return {
      processName: win.owner?.name ?? '',
      windowTitle: win.title ?? ''
    }
  } catch (err) {
    if (!loggedFailureOnce) {
      loggedFailureOnce = true
      console.info(
        '[Whisperio] Active-window lookup unavailable (missing permission or unsupported platform) — ' +
        'context-aware tone falls back to neutral for this and future dictations:',
        err instanceof Error ? err.message : String(err)
      )
    }
    return null
  }
}

/**
 * Map a captured context to a tone profile via the user's toneMap
 * (settingsManager.ts's DEFAULT_TONE_MAP, user-editable in Settings).
 * Matching is a case-insensitive SUBSTRING check of `toneMap`'s keys against
 * the lowercased `processName` only — window titles aren't matched against
 * today (see the file header's macOS note). Iterates `toneMap` in insertion
 * order and returns the first match, so a user-added override earlier in the
 * map wins over a later/default entry. A missing/empty context, or no match,
 * resolves to 'neutral'.
 */
export function resolveToneProfile(
  ctx: DictationContext | null,
  toneMap: Record<string, ToneProfileId>
): ToneProfileId {
  if (!ctx || !ctx.processName) return 'neutral'
  const name = ctx.processName.toLowerCase()
  for (const [key, profile] of Object.entries(toneMap)) {
    if (key && name.includes(key.toLowerCase())) return profile
  }
  return 'neutral'
}
