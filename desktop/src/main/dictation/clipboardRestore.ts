/**
 * Optional "restore previous clipboard after paste".
 *
 * Kept free of Electron imports (the clipboard is injected) so the logic is
 * unit-testable; autoPaste.ts is excluded from coverage because it is native.
 *
 * Race guard: restoring blindly after a fixed delay can clobber something the
 * user (or another app) copied in the meantime, or — if done too early — swap
 * the clipboard before the target app has read it so the WRONG text is pasted.
 * Here the restore only happens if the clipboard still holds exactly the text
 * we pasted; the caller additionally waits a delay after the paste keystroke.
 *
 * An empty snapshot (nothing restorable on the clipboard before dictation)
 * leaves the dictated text on the clipboard — there is nothing to put back,
 * and clearing it could race the paste just the same.
 */

export interface ClipboardImageLike {
  isEmpty(): boolean
}

export interface ClipboardLike {
  readText(): string
  writeText(text: string): void
  readHTML(): string
  readRTF(): string
  readImage(): ClipboardImageLike
  /** Write several formats atomically (Electron `clipboard.write`). */
  write(data: { text?: string; html?: string; rtf?: string; image?: ClipboardImageLike }): void
  availableFormats(): string[]
}

export interface ClipboardSnapshot {
  text?: string
  html?: string
  rtf?: string
  image?: ClipboardImageLike
}

export type RestoreStatus = 'restored' | 'skipped-changed' | 'skipped-empty-snapshot'

export const DEFAULT_RESTORE_DELAY_MS = 400

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}

export function isSnapshotEmpty(s: ClipboardSnapshot): boolean {
  return !s.text && !s.html && !s.rtf && !s.image
}

/** Capture text/html/rtf/image (non-empty only). Never throws. */
export function snapshotClipboard(cb: ClipboardLike): ClipboardSnapshot {
  const snap: ClipboardSnapshot = {}
  const text = safe(() => cb.readText())
  if (text) snap.text = text
  const html = safe(() => cb.readHTML())
  if (html) snap.html = html
  const rtf = safe(() => cb.readRTF())
  if (rtf) snap.rtf = rtf
  const image = safe(() => cb.readImage())
  if (image && safe(() => !image.isEmpty())) snap.image = image
  return snap
}

/**
 * Restore `snapshot` only if the clipboard still contains exactly `pastedText`.
 * Never throws.
 */
export function restoreClipboardIfUnchanged(
  cb: ClipboardLike,
  snapshot: ClipboardSnapshot,
  pastedText: string
): RestoreStatus {
  if (isSnapshotEmpty(snapshot)) return 'skipped-empty-snapshot'
  try {
    if (cb.readText() !== pastedText) return 'skipped-changed'
    cb.write(snapshot)
    return 'restored'
  } catch (err) {
    console.warn('[Whisperio] clipboard restore failed:', (err as Error)?.message)
    return 'skipped-changed'
  }
}
