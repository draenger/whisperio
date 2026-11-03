import { describe, it, expect, vi, afterEach } from 'vitest'
import { createWatchdog } from '../src/main/dictation/watchdog'

describe('watchdog', () => {
  afterEach(() => vi.useRealTimers())

  it('fires idle when no activity', () => {
    vi.useFakeTimers()
    const onFire = vi.fn()
    createWatchdog({ idleMs: 100, maxMs: 1000, onFire }).start()
    vi.advanceTimersByTime(100)
    expect(onFire).toHaveBeenCalledWith('idle')
  })

  it('touch extends; max cap wins', () => {
    vi.useFakeTimers()
    const onFire = vi.fn()
    const w = createWatchdog({ idleMs: 100, maxMs: 250, onFire })
    w.start()
    vi.advanceTimersByTime(90)
    w.touch()
    vi.advanceTimersByTime(90)
    w.touch()
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(70)
    expect(onFire).toHaveBeenCalledWith('max')
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('stop cancels and touch after stop is a no-op', () => {
    vi.useFakeTimers()
    const onFire = vi.fn()
    const w = createWatchdog({ idleMs: 100, maxMs: 1000, onFire })
    w.start()
    w.stop()
    w.touch()
    vi.advanceTimersByTime(5000)
    expect(onFire).not.toHaveBeenCalled()
  })
})
