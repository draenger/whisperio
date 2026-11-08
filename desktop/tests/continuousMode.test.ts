import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ContinuousController,
  registerContinuousController,
  isContinuousActive,
  toggleContinuousMode,
  type ContinuousDeps,
  type ContinuousSettings
} from '../src/main/dictation/continuousMode'
import type { WindowRef } from '../src/shared/continuous/targetGate'

const WIN_A: WindowRef = { id: 'a' }
const WIN_B: WindowRef = { id: 'b' }

function setup(over: Partial<ContinuousSettings> = {}) {
  const settings: ContinuousSettings = {
    continuousAutoSend: true,
    continuousSilenceMs: 1200,
    continuousMinUtteranceMs: 500,
    continuousPinTarget: false,
    continuousThresholdDbfs: -45,
    continuousEchoGuardMs: 0,
    ...over
  }
  const events: string[] = []
  let active: WindowRef | null = WIN_A
  const deps: ContinuousDeps = {
    getSettings: () => settings,
    getActiveWindow: async () => active,
    paste: async (t) => { events.push(`paste:${t}`) },
    sendEnter: () => { events.push('enter') },
    beep: () => { events.push('beep') },
    notifyRenderer: (m) => { events.push(`ui:${m.channel}`) }
  }
  const c = new ContinuousController(deps)
  return { c, events, settings, setActive: (w: WindowRef | null) => { active = w } }
}

const flush = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms) }

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); registerContinuousController(null) })

describe('ContinuousController', () => {
  it('pastes an accepted transcript then presses Enter after 100ms', async () => {
    const { c, events } = setup()
    await c.start()
    const p = c.onTranscript('hello there world', 2000)
    await flush(50)
    expect(events).toContain('paste:hello there world')
    expect(events).not.toContain('enter')
    await flush(100)
    await p
    expect(events.filter((e) => e.startsWith('paste') || e === 'enter')).toEqual(['paste:hello there world', 'enter'])
  })

  it('does not press Enter when auto-send is off', async () => {
    const { c, events } = setup({ continuousAutoSend: false })
    await c.start()
    const p = c.onTranscript('hello there world', 2000)
    await flush(500)
    await p
    expect(events).toContain('paste:hello there world')
    expect(events).not.toContain('enter')
  })

  it('ignores hallucinated / empty / too-short transcripts', async () => {
    const { c, events } = setup()
    await c.start()
    await c.onTranscript('', 2000)
    await c.onTranscript('   ', 2000)
    await c.onTranscript('Thanks for watching!', 2000)
    await c.onTranscript('real words here', 100) // shorter than minUtterance
    await flush(500)
    expect(events.some((e) => e.startsWith('paste'))).toBe(false)
  })

  it('ignores transcripts that arrive while inactive', async () => {
    const { c, events } = setup()
    await c.onTranscript('hello there world', 2000)
    await flush(500)
    expect(events).toEqual([])
  })

  it("the spoken 'stop' command stops without pasting it", async () => {
    const { c, events } = setup()
    await c.start()
    await c.onTranscript('stop nasłuch', 1500)
    expect(c.isActive()).toBe(false)
    expect(events).toContain('ui:continuous:stop')
    expect(events.some((e) => e.startsWith('paste'))).toBe(false)
  })

  it("'cancel' removes the last queued item; with nothing queued it beeps", async () => {
    const { c, events, setActive } = setup({ continuousPinTarget: true })
    await c.start() // pinned to A
    setActive(WIN_B)
    await c.onTranscript('first item here', 2000)
    await c.onTranscript('second item here', 2000)
    expect(c.queued).toEqual(['first item here', 'second item here'])
    events.length = 0
    await c.onTranscript('anuluj', 800)
    expect(c.queued).toEqual(['first item here'])
    expect(events).not.toContain('beep')
    await c.onTranscript('anuluj', 800)
    expect(c.queued).toEqual([])
    await c.onTranscript('anuluj', 800)
    expect(events).toContain('beep')
    expect(events.some((e) => e.startsWith('paste'))).toBe(false)
  })

  it('pinned mismatch holds + beeps; returning to target drains in order, Enter after each', async () => {
    const { c, events, setActive } = setup({ continuousPinTarget: true })
    await c.start()
    setActive(WIN_B)
    await c.onTranscript('one one one', 2000)
    await c.onTranscript('two two two', 2000)
    expect(events.filter((e) => e === 'beep')).toHaveLength(2)
    expect(events.some((e) => e.startsWith('paste'))).toBe(false)
    expect(c.queued).toHaveLength(2)

    await flush(1100) // still on B: timer must not paste
    expect(events.some((e) => e.startsWith('paste'))).toBe(false)

    setActive(WIN_A)
    await flush(1100)
    await flush(500)
    expect(events.filter((e) => e.startsWith('paste') || e === 'enter')).toEqual([
      'paste:one one one', 'enter', 'paste:two two two', 'enter'
    ])
    expect(c.queued).toEqual([])
  })

  it('a new utterance on the target flushes older queued items first (order preserved)', async () => {
    const { c, events, setActive } = setup({ continuousPinTarget: true, continuousAutoSend: false })
    await c.start()
    setActive(WIN_B)
    await c.onTranscript('older older older', 2000)
    setActive(WIN_A)
    await c.onTranscript('newer newer newer', 2000)
    expect(events.filter((e) => e.startsWith('paste'))).toEqual(['paste:older older older', 'paste:newer newer newer'])
  })

  it('does not pin when disabled: pastes into any window', async () => {
    const { c, events, setActive } = setup({ continuousAutoSend: false })
    await c.start()
    setActive(WIN_B)
    await c.onTranscript('anywhere is fine', 2000)
    expect(events).toContain('paste:anywhere is fine')
  })

  it('stop discards queued items and halts the drain timer', async () => {
    const { c, events, setActive } = setup({ continuousPinTarget: true })
    await c.start()
    setActive(WIN_B)
    await c.onTranscript('left behind text', 2000)
    c.stop()
    setActive(WIN_A)
    await flush(3000)
    expect(events.some((e) => e.startsWith('paste'))).toBe(false)
    expect(c.queued).toEqual([])
  })

  it('tells the renderer to start with settings and echo guard after each paste', async () => {
    const { c, events } = setup({ continuousEchoGuardMs: 800, continuousAutoSend: false })
    await c.start()
    expect(events).toContain('ui:continuous:start')
    await c.onTranscript('guard this please', 2000)
    expect(events).toContain('ui:continuous:state')
  })

  it('toggle starts then stops; module toggleContinuousMode delegates to the registered instance', async () => {
    const { c } = setup()
    registerContinuousController(c)
    expect(isContinuousActive()).toBe(false)
    await toggleContinuousMode()
    expect(isContinuousActive()).toBe(true)
    await toggleContinuousMode()
    expect(isContinuousActive()).toBe(false)
  })

  it('toggleContinuousMode is a safe no-op before wiring', async () => {
    registerContinuousController(null)
    await expect(toggleContinuousMode()).resolves.toBeUndefined()
  })

  it('a stop during pin lookup does not leave it running', async () => {
    const { c } = setup({ continuousPinTarget: true })
    const starting = c.start()
    c.stop()
    await starting
    expect(c.isActive()).toBe(false)
  })

  it('serializes overlapping transcripts so they paste in spoken order', async () => {
    const { c, events } = setup({ continuousAutoSend: false })
    await c.start()
    const p1 = c.onTranscript('first spoken line', 2000)
    const p2 = c.onTranscript('second spoken line', 2000)
    await flush(500)
    await Promise.all([p1, p2])
    expect(events.filter((e) => e.startsWith('paste'))).toEqual(['paste:first spoken line', 'paste:second spoken line'])
  })
})
