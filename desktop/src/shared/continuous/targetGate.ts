/** Pinned-window safety: only paste into the window dictation started in; queue the rest. */

export interface WindowRef {
  id: number | string
  title?: string
  owner?: string
}
export type Decision =
  | { action: 'paste'; text: string }
  | { action: 'hold'; reason: 'target-mismatch' | 'no-active-window' }

export class TargetGate {
  private readonly maxQueue: number
  private _pinned: WindowRef | null = null
  private _queue: string[] = []

  constructor(opts?: { maxQueue?: number }) {
    const m = opts?.maxQueue
    this.maxQueue = m !== undefined && m >= 1 ? Math.floor(m) : 20
  }

  pin(win: WindowRef | null): void {
    this._pinned = win
  }

  get pinned(): WindowRef | null {
    return this._pinned
  }

  private matches(active: WindowRef | null): boolean {
    return this._pinned === null || (active !== null && active.id === this._pinned.id)
  }

  submit(text: string, active: WindowRef | null): Decision {
    if (this.matches(active)) return { action: 'paste', text }
    this._queue.push(text)
    while (this._queue.length > this.maxQueue) this._queue.shift()
    return { action: 'hold', reason: active === null ? 'no-active-window' : 'target-mismatch' }
  }

  drain(active: WindowRef | null): string[] {
    if (!this.matches(active)) return []
    const out = this._queue
    this._queue = []
    return out
  }

  cancelLast(): string | null {
    return this._queue.pop() ?? null
  }

  get queue(): readonly string[] {
    return this._queue
  }

  clear(): void {
    this._queue = []
  }
}
