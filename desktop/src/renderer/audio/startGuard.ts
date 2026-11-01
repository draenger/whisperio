/**
 * Pure helpers for useDictation's async start path (no DOM / React deps).
 *
 * StartGuard: a generation counter. Every start() takes a token; stop/cancel
 * (and any newer start) invalidate all outstanding tokens. After each await in
 * the start path the caller checks `isCurrent(token)` and, if superseded,
 * releases whatever it just acquired and bails — so a quick stop/cancel while
 * getUserMedia is pending can no longer leave the mic on.
 */
export class StartGuard {
  private generation = 0

  /** Begin a new start; invalidates any earlier in-flight start. */
  begin(): number {
    return ++this.generation
  }

  /** Invalidate every in-flight start (call from stop / cancel). */
  invalidate(): void {
    this.generation++
  }

  isCurrent(token: number): boolean {
    return token === this.generation
  }
}

/** getUserMedia failures that mean "the selected device is gone". */
export function isDeviceGoneError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null | undefined)?.name
  return name === 'OverconstrainedError' || name === 'NotFoundError'
}

/**
 * Decide what to do after getUserMedia rejected.
 * - 'retry-default': a specific device was requested and it is gone -> retry once without deviceId
 * - 'report': anything else (or the default device itself failed) -> surface an error
 */
export function decideAfterGetUserMediaFailure(
  err: unknown,
  usedSpecificDevice: boolean
): 'retry-default' | 'report' {
  return usedSpecificDevice && isDeviceGoneError(err) ? 'retry-default' : 'report'
}
