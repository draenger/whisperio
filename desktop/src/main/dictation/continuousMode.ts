// Continuous / hands-free dictation controller. Electron-free: every side
// effect is injected so the logic is unit-testable (tests/continuousMode.test.ts).
//
// Collision policy: while continuous mode is active the normal dictation
// hotkeys are IGNORED (hotkeyManager checks isContinuousActive()); the user
// stops continuous mode first (hotkey, tray, or the spoken "stop nasluch").
import { filterTranscript } from '../../shared/continuous/hallucinationFilter'
import { parseVoiceCommand } from '../../shared/continuous/voiceCommands'
import { TargetGate, type WindowRef } from '../../shared/continuous/targetGate'

export interface ContinuousSettings {
  continuousAutoSend: boolean
  continuousSilenceMs: number
  continuousMinUtteranceMs: number
  continuousPinTarget: boolean
  continuousThresholdDbfs: number
  continuousEchoGuardMs: number
}

export type ContinuousRendererMessage =
  | { channel: 'continuous:start'; settings: ContinuousSettings }
  | { channel: 'continuous:stop' }
  | { channel: 'continuous:state'; state: { active: boolean; echoGuardMs?: number } }

export interface ContinuousDeps {
  getSettings(): ContinuousSettings
  getActiveWindow(): Promise<WindowRef | null>
  paste(text: string): Promise<void>
  sendEnter(): void
  beep(): void
  notifyRenderer(msg: ContinuousRendererMessage): void
  onStateChange?(active: boolean): void
  log?(msg: string): void
}

const ENTER_DELAY_MS = 100
const DRAIN_INTERVAL_MS = 1000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class ContinuousController {
  private active = false
  private gate = new TargetGate()
  private drainTimer: ReturnType<typeof setInterval> | null = null
  /** Serializes paste work so utterances land in spoken order. */
  private chain: Promise<void> = Promise.resolve()
  private epoch = 0

  constructor(private readonly deps: ContinuousDeps) {}

  isActive(): boolean {
    return this.active
  }

  get queued(): readonly string[] {
    return this.gate.queue
  }

  async start(): Promise<void> {
    if (this.active) return
    this.active = true
    const epoch = ++this.epoch
    const settings = this.deps.getSettings()
    this.gate = new TargetGate()
    if (settings.continuousPinTarget) {
      const win = await this.deps.getActiveWindow().catch(() => null)
      if (epoch !== this.epoch || !this.active) return // stopped while pinning
      this.gate.pin(win)
      if (!win) this.deps.log?.('[continuous] pin requested but no active window; not pinned')
    }
    this.deps.notifyRenderer({ channel: 'continuous:start', settings })
    this.deps.onStateChange?.(true)
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    this.epoch++
    this.stopDrainTimer()
    const dropped = this.gate.queue.length
    if (dropped > 0) this.deps.log?.(`[continuous] stopped with ${dropped} unsent item(s) discarded`)
    this.gate.clear()
    this.gate.pin(null)
    this.deps.notifyRenderer({ channel: 'continuous:stop' })
    this.deps.onStateChange?.(false)
  }

  async toggle(): Promise<void> {
    if (this.active) this.stop()
    else await this.start()
  }

  async onTranscript(text: string, durationMs: number): Promise<void> {
    if (!this.active) return
    const settings = this.deps.getSettings()
    const verdict = filterTranscript(text, durationMs, settings.continuousMinUtteranceMs)
    if (!verdict.accept) {
      this.deps.log?.(`[continuous] ignored transcript (${verdict.reason})`)
      return
    }
    const cmd = parseVoiceCommand(verdict.text)
    if (cmd === 'stop') {
      this.stop()
      return
    }
    if (cmd === 'cancel') {
      if (this.gate.cancelLast() === null) this.deps.beep()
      return
    }
    await this.enqueue(async () => {
      if (!this.active) return
      const active = await this.deps.getActiveWindow().catch(() => null)
      // The gate pastes whenever the window matches, even with older items
      // queued, so flush those first to preserve spoken order.
      for (const queued of this.gate.drain(active)) await this.pasteOne(queued)
      if (!this.active) return
      const decision = this.gate.submit(verdict.text, active)
      if (decision.action === 'paste') {
        await this.pasteOne(decision.text)
      } else {
        this.deps.beep()
        this.startDrainTimer()
      }
    })
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.chain.then(job).catch((err) => {
      this.deps.log?.(`[continuous] paste failed: ${err instanceof Error ? err.message : String(err)}`)
    })
    this.chain = run
    return run
  }

  private async pasteOne(text: string): Promise<void> {
    const settings = this.deps.getSettings()
    await this.deps.paste(text)
    if (settings.continuousAutoSend) {
      await sleep(ENTER_DELAY_MS)
      this.deps.sendEnter()
    }
    if (settings.continuousEchoGuardMs > 0) {
      this.deps.notifyRenderer({
        channel: 'continuous:state',
        state: { active: true, echoGuardMs: settings.continuousEchoGuardMs }
      })
    }
  }

  private startDrainTimer(): void {
    if (this.drainTimer) return
    this.drainTimer = setInterval(() => void this.drainQueued(), DRAIN_INTERVAL_MS)
  }

  private stopDrainTimer(): void {
    if (this.drainTimer) clearInterval(this.drainTimer)
    this.drainTimer = null
  }

  private async drainQueued(): Promise<void> {
    if (!this.active || this.gate.queue.length === 0) {
      this.stopDrainTimer()
      return
    }
    await this.enqueue(async () => {
      if (!this.active) return
      const active = await this.deps.getActiveWindow().catch(() => null)
      for (const queued of this.gate.drain(active)) await this.pasteOne(queued)
      if (this.gate.queue.length === 0) this.stopDrainTimer()
    })
  }
}

let instance: ContinuousController | null = null

export function registerContinuousController(c: ContinuousController | null): void {
  instance = c
}

export function isContinuousActive(): boolean {
  return instance?.isActive() ?? false
}

/** Entry point for other lanes (e.g. a learned headset button). */
export function toggleContinuousMode(): Promise<void> {
  return instance ? instance.toggle() : Promise.resolve()
}
