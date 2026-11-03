import { describe, it, expect, vi } from 'vitest'
import {
  ClipboardRestoreCoordinator,
  clampRestoreDelay,
  DEFAULT_RESTORE_DELAY_MS,
  type ClipboardLike
} from '../src/main/dictation/clipboardRestore'

describe('restore delay + timing', () => {
  it('clamps the setting to 300..3000, default 700', () => {
    expect(DEFAULT_RESTORE_DELAY_MS).toBe(700)
    expect(clampRestoreDelay(10)).toBe(300)
    expect(clampRestoreDelay(99999)).toBe(3000)
    expect(clampRestoreDelay(1200.4)).toBe(1200)
    expect(clampRestoreDelay(undefined)).toBe(700)
    expect(clampRestoreDelay(NaN)).toBe(700)
  })

  function setup() {
    vi.useFakeTimers()
    const state = { text: 'orig' }
    const cb = {
      readText: () => state.text,
      writeText: (t: string) => { state.text = t },
      readHTML: () => '', readRTF: () => '', readImage: () => ({ isEmpty: () => true }),
      availableFormats: () => [],
      write: (d: { text?: string }) => { state.text = d.text ?? '' }
    } as unknown as ClipboardLike
    const timers = {
      set: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)
    }
    return { state, cb, c: new ClipboardRestoreCoordinator(cb, timers) }
  }

  it('does not restore before the delay, restores after', () => {
    const { state, cb, c } = setup()
    const h = c.begin('dict'); cb.writeText('dict')
    const done = vi.fn()
    c.schedule(h, 700, done)
    vi.advanceTimersByTime(699)
    expect(state.text).toBe('dict'); expect(done).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(state.text).toBe('orig'); expect(done).toHaveBeenCalledWith('restored')
    vi.useRealTimers()
  })
  it('skips if the clipboard changed', () => {
    const { state, cb, c } = setup()
    const h = c.begin('dict'); cb.writeText('dict')
    const done = vi.fn()
    c.schedule(h, 700, done)
    state.text = 'user copied'
    vi.advanceTimersByTime(700)
    expect(state.text).toBe('user copied'); expect(done).toHaveBeenCalledWith('skipped-changed')
    vi.useRealTimers()
  })
  it('polls canRestore, restores once true, gives up after the window', () => {
    const { state, cb, c } = setup()
    let ok = false
    let h = c.begin('dict'); cb.writeText('dict')
    const done = vi.fn()
    c.schedule(h, 700, done, () => ok)
    vi.advanceTimersByTime(1000)
    expect(done).not.toHaveBeenCalled()
    ok = true
    vi.advanceTimersByTime(100)
    expect(done).toHaveBeenCalledWith('restored'); expect(state.text).toBe('orig')

    ok = false
    h = c.begin('d2'); cb.writeText('d2')
    const done2 = vi.fn()
    c.schedule(h, 700, done2, () => ok)
    vi.advanceTimersByTime(700 + 1500 + 100)
    expect(done2).toHaveBeenCalledWith('skipped-timeout'); expect(state.text).toBe('d2')
    vi.useRealTimers()
  })
})
