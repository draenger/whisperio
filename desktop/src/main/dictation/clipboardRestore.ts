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

export type RestoreStatus = 'restored' | 'skipped-changed' | 'skipped-empty-snapshot' | 'skipped-timeout'

export const DEFAULT_RESTORE_DELAY_MS = 700
export const MIN_RESTORE_DELAY_MS = 300
export const MAX_RESTORE_DELAY_MS = 3000
/** Extra time (after the minimum delay) we keep polling for `canRestore`. */
export const RESTORE_POLL_WINDOW_MS = 1500
export const RESTORE_POLL_INTERVAL_MS = 100

/** Clamp the `clipboardRestoreDelayMs` setting to 300..3000 (default 700). */
export function clampRestoreDelay(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_RESTORE_DELAY_MS
  return Math.min(MAX_RESTORE_DELAY_MS, Math.max(MIN_RESTORE_DELAY_MS, Math.round(v)))
}

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
  pastedText: string,
  onRestored?: (snapshot: ClipboardSnapshot) => void
): RestoreStatus {
  if (isSnapshotEmpty(snapshot)) return 'skipped-empty-snapshot'
  try {
    if (cb.readText() !== pastedText) return 'skipped-changed'
    cb.write(snapshot)
    // Best effort: keep the restored (possibly secret) content out of
    // clipboard history / cloud sync.
    onRestored?.(snapshot)
    return 'restored'
  } catch (err) {
    console.warn('[Whisperio] clipboard restore failed:', (err as Error)?.message)
    return 'skipped-changed'
  }
}

export interface RestoreTimers<H = unknown> {
  set(fn: () => void, ms: number): H
  clear(handle: H): void
}

export interface PasteHandle {
  id: number
  snapshot: ClipboardSnapshot
}

interface Pending {
  id: number
  snapshot: ClipboardSnapshot
  pastedText: string
  armed: boolean
  timer: unknown
}

/**
 * Tracks the single outstanding "restore previous clipboard" so overlapping
 * pastes (dictate-and-send then another dictation, command mode) keep the
 * user's ORIGINAL clipboard instead of snapshotting the first dictated text.
 *
 * begin() -> write+paste -> schedule(). A new begin() while one is pending
 * cancels its timer and reuses its original snapshot, provided the clipboard
 * still holds that paste's text (otherwise the user copied something new, and
 * a fresh snapshot is taken).
 */
export class ClipboardRestoreCoordinator {
  private pending: Pending | null = null
  private nextId = 1

  constructor(
    private readonly cb: ClipboardLike,
    private readonly timers: RestoreTimers,
    /** Called right after a successful restore write (mark it transient). */
    private readonly afterRestore?: (snapshot: ClipboardSnapshot) => void
  ) {}

  /** Call BEFORE writing `text` to the clipboard. */
  begin(text: string): PasteHandle {
    let snapshot: ClipboardSnapshot
    const prev = this.pending
    if (prev) {
      if (prev.timer !== null) this.timers.clear(prev.timer)
      this.pending = null
      const current = safe(() => this.cb.readText())
      snapshot = current === prev.pastedText ? prev.snapshot : snapshotClipboard(this.cb)
    } else {
      snapshot = snapshotClipboard(this.cb)
    }
    const id = this.nextId++
    this.pending = { id, snapshot, pastedText: text, armed: false, timer: null }
    return { id, snapshot }
  }

  /** Arm the delayed restore after the paste keystroke was sent. */
  /**
   * There is no OS "paste happened" event, so this is a heuristic: restore no
   * earlier than `delayMs` after the paste keystroke, and only if the clipboard
   * still holds our text. If `canRestore` is given, keep polling (every 100 ms,
   * up to 1.5 s past the delay) until it returns true; on timeout the dictated
   * text is left on the clipboard (the safe failure) instead of restoring.
   */
  schedule(
    handle: PasteHandle,
    delayMs: number,
    onDone?: (status: RestoreStatus) => void,
    canRestore?: () => boolean
  ): void {
    const p = this.pending
    if (!p || p.id !== handle.id) return // superseded by a newer paste
    p.armed = true
    const deadline = delayMs + RESTORE_POLL_WINDOW_MS
    let elapsed = delayMs
    const finish = (status: RestoreStatus): void => {
      this.pending = null
      onDone?.(status)
    }
    const tick = (): void => {
      if (this.pending !== p) return
      if (safe(() => this.cb.readText()) !== p.pastedText) return finish('skipped-changed')
      if (canRestore && !safe(canRestore)) {
        if (elapsed >= deadline) return finish('skipped-timeout')
        elapsed += RESTORE_POLL_INTERVAL_MS
        p.timer = this.timers.set(tick, RESTORE_POLL_INTERVAL_MS)
        return
      }
      finish(restoreClipboardIfUnchanged(this.cb, p.snapshot, p.pastedText, this.afterRestore))
    }
    p.timer = this.timers.set(tick, delayMs)
  }

  /** Paste aborted (text intentionally left on the clipboard): forget it. */
  cancel(handle: PasteHandle): void {
    if (this.pending?.id === handle.id) this.pending = null
  }

  /** On quit: restore an armed pending restore right away (best effort). */
  flush(): RestoreStatus | null {
    const p = this.pending
    if (!p) return null
    this.pending = null
    if (p.timer !== null) this.timers.clear(p.timer)
    if (!p.armed) return null
    return restoreClipboardIfUnchanged(this.cb, p.snapshot, p.pastedText, this.afterRestore)
  }
}

/** Flush the module-level coordinator used by autoPaste (set by autoPaste.ts). */
let shared: ClipboardRestoreCoordinator | null = null
export function setSharedCoordinator(c: ClipboardRestoreCoordinator): void {
  shared = c
}
export function flushPendingClipboardRestore(): RestoreStatus | null {
  return shared ? shared.flush() : null
}
