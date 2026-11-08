import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createHeadsetButton,
  createLearnSession,
  LEARN_TIMEOUT_MESSAGE,
  type ButtonConfig,
  type LearnResult
} from '../src/main/dictation/headsetButton'
import { createFocusController, type FocusTarget } from '../src/main/dictation/focusTarget'

describe('headset button controller', () => {
  let now = 1000
  const deps = {
    dictateToggle: vi.fn(),
    continuousToggle: vi.fn(),
    registerAccelerator: vi.fn(() => true),
    unregisterAccelerator: vi.fn(),
    now: () => now,
    log: vi.fn()
  }
  const hid: ButtonConfig = {
    buttonTrigger: { kind: 'hid', vendorId: 1, productId: 2, reportId: 3, pattern: [1], mask: [1] },
    buttonTriggerSwallow: false,
    buttonAction: 'dictate-and-send'
  }
  beforeEach(() => {
    vi.clearAllMocks()
    now = 1000
    deps.registerAccelerator.mockReturnValue(true)
  })

  it('HID: only a matching report triggers the dictate toggle', () => {
    const b = createHeadsetButton(deps)
    b.apply(hid)
    expect(b.handleHidReport({ vendorId: 1, productId: 2, reportId: 3, data: [0] })).toBe(false)
    expect(b.handleHidReport({ vendorId: 9, productId: 2, reportId: 3, data: [1] })).toBe(false)
    expect(deps.dictateToggle).not.toHaveBeenCalled()
    expect(b.handleHidReport({ vendorId: 1, productId: 2, reportId: 3, data: [1] })).toBe(true)
    expect(deps.dictateToggle).toHaveBeenCalledTimes(1)
  })

  it('debounces duplicate reports but allows the next real press', () => {
    const b = createHeadsetButton(deps)
    b.apply(hid)
    const r = { vendorId: 1, productId: 2, reportId: 3, data: [1] }
    b.handleHidReport(r)
    now += 100
    b.handleHidReport(r)
    expect(deps.dictateToggle).toHaveBeenCalledTimes(1)
    now += 600
    b.handleHidReport(r)
    expect(deps.dictateToggle).toHaveBeenCalledTimes(2)
  })

  it('continuous-toggle action calls toggleContinuousMode, not the dictate toggle', () => {
    const b = createHeadsetButton(deps)
    b.apply({ ...hid, buttonAction: 'continuous-toggle' })
    b.handleHidReport({ vendorId: 1, productId: 2, reportId: 3, data: [1] })
    expect(deps.continuousToggle).toHaveBeenCalledTimes(1)
    expect(deps.dictateToggle).not.toHaveBeenCalled()
  })

  it('a rejecting async action does not become an unhandled rejection', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    deps.dictateToggle.mockReturnValueOnce(Promise.reject(new Error('boom')) as never)
    const b = createHeadsetButton(deps)
    b.apply(hid)
    b.handleHidReport({ vendorId: 1, productId: 2, reportId: 3, data: [1] })
    await new Promise((r) => setTimeout(r, 10))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('action failed: boom'))
  })

  it('accelerator + swallow registers globalShortcut; swallow=false does NOT (Spotify safety)', () => {
    const b = createHeadsetButton(deps)
    const media: ButtonConfig = { buttonTrigger: { kind: 'accelerator', accelerator: 'MediaPlayPause' }, buttonTriggerSwallow: false, buttonAction: 'dictate-and-send' }
    b.apply(media)
    expect(deps.registerAccelerator).not.toHaveBeenCalled()
    b.apply({ ...media, buttonTriggerSwallow: true })
    expect(deps.registerAccelerator).toHaveBeenCalledWith('MediaPlayPause', expect.any(Function))
    const cb = deps.registerAccelerator.mock.calls[0][1] as () => void
    cb()
    expect(deps.dictateToggle).toHaveBeenCalledTimes(1)
  })

  it('re-applying unregisters the old accelerator (no leaked key grab); clearing releases it', () => {
    const b = createHeadsetButton(deps)
    b.apply({ buttonTrigger: { kind: 'accelerator', accelerator: 'F13' }, buttonTriggerSwallow: true, buttonAction: 'dictate-and-send' })
    b.apply({ buttonTrigger: { kind: 'accelerator', accelerator: 'F14' }, buttonTriggerSwallow: true, buttonAction: 'dictate-and-send' })
    expect(deps.unregisterAccelerator).toHaveBeenCalledWith('F13')
    b.apply({ ...hid })
    expect(deps.unregisterAccelerator).toHaveBeenCalledWith('F14')
    b.dispose()
  })

  it('a failed registration is logged, not thrown, and is not later "unregistered"', () => {
    deps.registerAccelerator.mockReturnValue(false)
    const b = createHeadsetButton(deps)
    b.apply({ buttonTrigger: { kind: 'accelerator', accelerator: 'F13' }, buttonTriggerSwallow: true, buttonAction: 'dictate-and-send' })
    b.dispose()
    expect(deps.unregisterAccelerator).not.toHaveBeenCalled()
  })

  it('appcommand: matches only its id; paused suppresses presses', () => {
    const b = createHeadsetButton(deps)
    b.apply({ buttonTrigger: { kind: 'appcommand', id: 46 }, buttonTriggerSwallow: false, buttonAction: 'dictate-and-send' })
    expect(b.handleAppCommand(47)).toBe(false)
    b.setPaused(true)
    b.handleAppCommand(46)
    expect(deps.dictateToggle).not.toHaveBeenCalled()
    b.setPaused(false)
    b.handleAppCommand(46)
    expect(deps.dictateToggle).toHaveBeenCalledTimes(1)
  })
})

describe('learn session', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function make() {
    const results: LearnResult[] = []
    const stop = vi.fn()
    const log = vi.fn()
    const s = createLearnSession({
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      log,
      startProbes: () => stop,
      onResult: (r) => results.push(r)
    })
    return { s, results, stop, log }
  }

  it('times out after 10 s with the honest Polish message, logs it, stops probes', () => {
    const { s, results, stop, log } = make()
    s.start()
    vi.advanceTimersByTime(9_999)
    expect(results).toHaveLength(0)
    vi.advanceTimersByTime(2)
    expect(results).toEqual([{ ok: false, reason: 'timeout', message: LEARN_TIMEOUT_MESSAGE }])
    expect(LEARN_TIMEOUT_MESSAGE).toContain('Przez Bluetooth (profil HFP)')
    expect(stop).toHaveBeenCalledTimes(1)
    expect(log.mock.calls.some((c) => String(c[0]).startsWith('[button-learn]') && String(c[0]).includes('timeout'))).toBe(true)
    expect(s.isActive()).toBe(false)
  })

  it('captures the first usable event, ignores unusable ones, logs raw details, cancels the timeout', () => {
    const { s, results, log } = make()
    s.start()
    s.feed({ source: 'keyboard', code: 'KeyA', key: 'a' }) // unusable
    s.feed({ source: 'hid', vendorId: 0x0b0e, productId: 5, reportId: 1, usagePage: 0x0b, usage: 0x20, data: [0, 0] }) // release
    expect(results).toHaveLength(0)
    s.feed({ source: 'hid', vendorId: 0x0b0e, productId: 5, reportId: 1, usagePage: 0x0b, usage: 0x20, data: [1, 0] })
    s.feed({ source: 'globalShortcut', accelerator: 'MediaPlayPause' }) // late: ignored
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ ok: true, trigger: { kind: 'hid', vendorId: 0x0b0e, pattern: [1, 0] } })
    const lines = log.mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => l.startsWith('[button-learn] event') && l.includes('"usagePage":11'))).toBe(true)
    vi.advanceTimersByTime(20_000)
    expect(results).toHaveLength(1) // timeout did not fire afterwards
  })

  it('events before start are ignored; cancel reports cancelled once', () => {
    const { s, results } = make()
    s.feed({ source: 'globalShortcut', accelerator: 'F13' })
    expect(results).toHaveLength(0)
    s.start()
    s.cancel()
    s.cancel()
    expect(results).toEqual([{ ok: false, reason: 'cancelled', message: 'Anulowano.' }])
  })

  it('probes can feed the session', () => {
    const results: LearnResult[] = []
    const s = createLearnSession({
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      log: vi.fn(),
      startProbes: (feed) => {
        feed({ source: 'globalShortcut', accelerator: 'VolumeMute' })
        return () => undefined
      },
      onResult: (r) => results.push(r)
    })
    s.start()
    expect(results[0]).toMatchObject({ ok: true, trigger: { kind: 'accelerator', accelerator: 'VolumeMute' } })
  })
})

describe('focus controller (pinned target)', () => {
  const A: FocusTarget = { handle: '100', pid: 10 }
  const B: FocusTarget = { handle: '200', pid: 20 }
  function make(fgSeq: (FocusTarget | null)[], activateWorks: boolean) {
    let fg: FocusTarget | null = fgSeq[0]
    const activate = vi.fn((t: FocusTarget) => {
      if (activateWorks) fg = t
    })
    const sleep = vi.fn(async () => undefined)
    const c = createFocusController({ ownPid: 1, getForeground: () => fg, activate, sleep })
    return { c, activate, sleep, setFg: (t: FocusTarget | null) => (fg = t) }
  }

  it('pins foreground, never our own window', async () => {
    const own = make([{ handle: '1', pid: 1 }], true)
    expect(await own.c.pinForeground()).toBeNull()
    expect(own.c.getPinned()).toBeNull()
    const m = make([A], true)
    expect(await m.c.pinForeground()).toEqual(A)
  })

  it('restore is a no-op success when already foreground or nothing pinned', async () => {
    const m = make([A], true)
    expect(await m.c.restore()).toBe(true) // nothing pinned
    await m.c.pinForeground()
    expect(await m.c.restore()).toBe(true)
    expect(m.activate).not.toHaveBeenCalled()
  })

  it('re-focuses a different foreground window and verifies it', async () => {
    const m = make([A], true)
    await m.c.pinForeground()
    m.setFg(B)
    expect(await m.c.restore()).toBe(true)
    expect(m.activate).toHaveBeenCalledWith(A)
  })

  it('reports failure when activate silently does nothing (verifies, does not trust the call)', async () => {
    const m = make([A], false)
    await m.c.pinForeground()
    m.setFg(B)
    expect(await m.c.restore()).toBe(false)
    expect(m.activate).toHaveBeenCalledTimes(3)
  })

  it('an activate that throws counts as failure, not a crash', async () => {
    let fg: FocusTarget | null = A
    const c = createFocusController({
      ownPid: 1,
      getForeground: () => fg,
      activate: () => {
        throw new Error('no perms')
      },
      sleep: async () => undefined
    })
    await c.pinForeground()
    fg = B
    expect(await c.restore()).toBe(false)
  })
})
