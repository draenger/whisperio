/**
 * Transcription watchdog. Replaces the fixed 60 s safety timer that dropped
 * valid fallback / long-provider results (providers may legitimately take
 * 45 s each, AssemblyAI polls up to 300 s, LLM cleanup has no timeout).
 *
 * Fires `onFire` when EITHER
 *  - no activity was noted for `idleMs` (a hung chain), or
 *  - `maxMs` elapsed since start() (absolute cap).
 * Activity = noteTranscriptionActivity(), called by transcribe.ts when each
 * provider attempt / cleanup starts. Deliberately dependency-free so
 * transcribe.ts can import it without a cycle with hotkeyManager.
 */

export const WATCHDOG_IDLE_MS = 60_000
export const WATCHDOG_MAX_MS = 6 * 60_000

export interface Watchdog {
  start(): void
  touch(): void
  stop(): void
}

export function createWatchdog(opts: {
  idleMs?: number
  maxMs?: number
  onFire: (reason: 'idle' | 'max') => void
}): Watchdog {
  const idleMs = opts.idleMs ?? WATCHDOG_IDLE_MS
  const maxMs = opts.maxMs ?? WATCHDOG_MAX_MS
  let startedAt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let reason: 'idle' | 'max' = 'idle'

  function clear(): void {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function arm(): void {
    clear()
    const remaining = maxMs - (Date.now() - startedAt)
    const delay = Math.min(idleMs, remaining)
    reason = remaining <= idleMs ? 'max' : 'idle'
    timer = setTimeout(
      () => {
        timer = null
        opts.onFire(reason)
      },
      Math.max(0, delay)
    )
  }

  return {
    start() {
      startedAt = Date.now()
      arm()
    },
    touch() {
      if (timer) arm()
    },
    stop: clear
  }
}

// --- activity bus (transcribe.ts -> hotkeyManager) ---
const listeners = new Set<() => void>()

/** Called by transcribe.ts whenever genuine transcription work (re)starts. */
export function noteTranscriptionActivity(): void {
  for (const l of listeners) l()
}

export function onTranscriptionActivity(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
