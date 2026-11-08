// Headset-button controller + learn session. No electron imports: every OS /
// Electron effect is injected (see headsetButtonRuntime.ts for the real deps).
import {
  matchesHidReport,
  triggerFromLearnEvent,
  describeTrigger,
  type ButtonAction,
  type ButtonTrigger,
  type HidReport,
  type LearnEvent
} from '../buttonTrigger'

export const LEARN_TIMEOUT_MS = 10_000
const DEBOUNCE_MS = 500

export const LEARN_TIMEOUT_MESSAGE =
  'Nic nie dotarło. Przez Bluetooth (profil HFP) Windows może nie przekazywać tego przycisku aplikacjom — spróbuj wybrać urządzenie HID Jabra albo użyj innego przycisku/skrótu.'

export const MEDIA_KEY_SWALLOW_NOTE =
  'Klawisze (w tym multimedialne) są przechwytywane globalnie — bez przechwytywania nie da się ich obserwować (brak niskopoziomowego hooka), więc takie przypisanie zawsze blokuje klawisz dla innych aplikacji.'

export interface ButtonConfig {
  buttonTrigger: ButtonTrigger | null
  buttonTriggerSwallow: boolean
  buttonAction: ButtonAction
}

export interface ButtonDeps {
  /** First/second press of the dictate-and-send toggle (hotkeyManager.buttonToggle). */
  dictateToggle: () => void | Promise<void>
  /** continuousMode.toggleContinuousMode */
  continuousToggle: () => void
  registerAccelerator: (accelerator: string, cb: () => void) => boolean
  unregisterAccelerator: (accelerator: string) => void
  now: () => number
  log: (msg: string) => void
}

export interface HeadsetButton {
  apply(cfg: ButtonConfig): void
  handleHidReport(report: HidReport): boolean
  handleAppCommand(id: number): boolean
  setPaused(paused: boolean): void
  dispose(): void
}

export function createHeadsetButton(deps: ButtonDeps): HeadsetButton {
  let cfg: ButtonConfig = { buttonTrigger: null, buttonTriggerSwallow: false, buttonAction: 'dictate-and-send' }
  let registered: string | null = null
  let paused = false
  let lastPress = -Infinity

  function unregister(): void {
    if (registered) {
      deps.unregisterAccelerator(registered)
      registered = null
    }
  }

  function press(origin: string): void {
    if (paused) return
    const t = deps.now()
    if (t - lastPress < DEBOUNCE_MS) {
      deps.log(`[headset-button] ${origin} debounced`)
      return
    }
    lastPress = t
    deps.log(`[headset-button] press via ${origin} -> ${cfg.buttonAction}`)
    try {
      const r = cfg.buttonAction === 'continuous-toggle' ? deps.continuousToggle() : deps.dictateToggle()
      if (r && typeof (r as Promise<void>).catch === 'function') {
        ;(r as Promise<void>).catch((err) => deps.log(`[headset-button] action failed: ${(err as Error)?.message}`))
      }
    } catch (err) {
      deps.log(`[headset-button] action failed: ${(err as Error)?.message}`)
    }
  }

  return {
    apply(next) {
      unregister()
      cfg = next
      const t = next.buttonTrigger
      if (t?.kind !== 'accelerator') return
      if (!next.buttonTriggerSwallow) {
        // No non-consuming global key observer exists in this build.
        deps.log(`[headset-button] ${t.accelerator} not registered: swallow=false is unsupported for keys. ${MEDIA_KEY_SWALLOW_NOTE}`)
        return
      }
      try {
        if (deps.registerAccelerator(t.accelerator, () => press(`key ${t.accelerator}`))) {
          registered = t.accelerator
        } else {
          deps.log(`[headset-button] failed to register ${t.accelerator} (taken by another app?)`)
        }
      } catch (err) {
        deps.log(`[headset-button] invalid accelerator ${t.accelerator}: ${(err as Error)?.message}`)
      }
    },
    handleHidReport(report) {
      if (!matchesHidReport(cfg.buttonTrigger, report)) return false
      press('hid')
      return true
    },
    handleAppCommand(id) {
      const t = cfg.buttonTrigger
      if (t?.kind !== 'appcommand' || t.id !== id) return false
      press(`appcommand ${id}`)
      return true
    },
    setPaused(p) {
      paused = p
    },
    dispose() {
      unregister()
    }
  }
}

// ---------------------------------------------------------------------------
// Learn session
// ---------------------------------------------------------------------------

export type LearnResult =
  | { ok: true; trigger: ButtonTrigger; description: string }
  | { ok: false; reason: 'timeout' | 'cancelled'; message: string }

export interface LearnDeps {
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (h: unknown) => void
  log: (msg: string) => void
  /** Start probing global keys (media keys, F13-F24); returns a stop fn. */
  startProbes: (feed: (ev: LearnEvent) => void) => () => void
  onResult: (r: LearnResult) => void
  timeoutMs?: number
}

export interface LearnSession {
  start(): void
  feed(ev: LearnEvent): void
  cancel(): void
  isActive(): boolean
}

export function createLearnSession(deps: LearnDeps): LearnSession {
  let active = false
  let timer: unknown = null
  let stopProbes: (() => void) | null = null

  function finish(r: LearnResult): void {
    if (!active) return
    active = false
    if (timer !== null) deps.clearTimer(timer)
    timer = null
    try {
      stopProbes?.()
    } finally {
      stopProbes = null
    }
    deps.onResult(r)
  }

  const session: LearnSession = {
    start() {
      if (active) return
      active = true
      deps.log('[button-learn] started; waiting for any event (note: WM_APPCOMMAND / app-command reach only a focused Whisperio window, a limitation of Windows)')
      stopProbes = deps.startProbes((ev) => session.feed(ev))
      timer = deps.setTimer(() => {
        deps.log('[button-learn] timeout: nothing arrived. ' + LEARN_TIMEOUT_MESSAGE)
        finish({ ok: false, reason: 'timeout', message: LEARN_TIMEOUT_MESSAGE })
      }, deps.timeoutMs ?? LEARN_TIMEOUT_MS)
    },
    feed(ev) {
      if (!active) return
      deps.log(`[button-learn] event ${JSON.stringify(ev)}`)
      const trigger = triggerFromLearnEvent(ev)
      if (!trigger) {
        deps.log('[button-learn] event ignored (not usable as a trigger)')
        return
      }
      const description = describeTrigger(trigger)
      deps.log(`[button-learn] captured ${description}`)
      finish({ ok: true, trigger, description })
    },
    cancel() {
      finish({ ok: false, reason: 'cancelled', message: 'Anulowano.' })
    },
    isActive: () => active
  }
  return session
}
