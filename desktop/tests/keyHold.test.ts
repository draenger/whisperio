import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  parseAccelerator,
  winVirtualKey,
  macKeyCode,
  watchKeyRelease,
  createKeyStateReader,
  _resetKeyHoldWarnings
} from '../src/main/dictation/keyHold'

describe('parseAccelerator', () => {
  it('splits modifiers and main key', () => {
    expect(parseAccelerator('Ctrl+Shift+Space')).toEqual({ modifiers: ['ctrl', 'shift'], key: 'SPACE' })
  })
  it('normalises aliases', () => {
    expect(parseAccelerator('CommandOrControl+Alt+d')).toEqual({ modifiers: ['ctrl', 'alt'], key: 'D' })
    expect(parseAccelerator('Cmd+F12')).toEqual({ modifiers: ['meta'], key: 'F12' })
  })
  it('handles the literal plus key', () => {
    expect(parseAccelerator('Ctrl++')?.key).toBe('+')
    expect(parseAccelerator('Alt+Plus')?.key).toBe('+')
  })
  it('rejects empty, modifier-only, and double main keys', () => {
    expect(parseAccelerator('')).toBeNull()
    expect(parseAccelerator('Ctrl+Shift')).toBeNull()
    expect(parseAccelerator('A+B')).toBeNull()
  })
})

describe('key mapping', () => {
  it('maps Windows virtual keys', () => {
    expect(winVirtualKey('A')).toBe(0x41)
    expect(winVirtualKey('5')).toBe(0x35)
    expect(winVirtualKey('F1')).toBe(0x70)
    expect(winVirtualKey('F24')).toBe(0x87)
    expect(winVirtualKey('SPACE')).toBe(0x20)
    expect(winVirtualKey(';')).toBe(0xba)
    expect(winVirtualKey('F25')).toBeNull()
    expect(winVirtualKey('NOPE')).toBeNull()
  })
  it('maps macOS keycodes', () => {
    expect(macKeyCode('SPACE')).toBe(49)
    expect(macKeyCode('A')).toBe(0)
    expect(macKeyCode('F1')).toBe(122)
    expect(macKeyCode('NOPE')).toBeNull()
  })
})

describe('watchKeyRelease', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetKeyHoldWarnings()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fires onRelease once when the key goes up', () => {
    let down = true
    const onRelease = vi.fn()
    watchKeyRelease('Ctrl+Space', onRelease, { isKeyDown: () => down })
    vi.advanceTimersByTime(200)
    expect(onRelease).not.toHaveBeenCalled()
    down = false
    vi.advanceTimersByTime(100)
    expect(onRelease).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('cancel stops the watcher without firing', () => {
    let down = true
    const onRelease = vi.fn()
    const cancel = watchKeyRelease('Ctrl+Space', onRelease, { isKeyDown: () => down })!
    cancel()
    down = false
    vi.advanceTimersByTime(1000)
    expect(onRelease).not.toHaveBeenCalled()
  })

  it('fires at max duration if the key never reads as released', () => {
    const onRelease = vi.fn()
    watchKeyRelease('Ctrl+Space', onRelease, { isKeyDown: () => true, maxDurationMs: 5000 })
    vi.advanceTimersByTime(4900)
    expect(onRelease).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('treats a throwing key-state read as released', () => {
    const onRelease = vi.fn()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    watchKeyRelease('Ctrl+Space', onRelease, {
      isKeyDown: () => {
        throw new Error('boom')
      }
    })
    vi.advanceTimersByTime(50)
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('returns null for unsupported platform (toggle fallback) and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(watchKeyRelease('Ctrl+Space', vi.fn(), { platform: 'linux' })).toBeNull()
    expect(watchKeyRelease('Ctrl+Space', vi.fn(), { platform: 'linux' })).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('returns null for unparseable accelerator and unmapped key', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(watchKeyRelease('', vi.fn(), { isKeyDown: () => true })).toBeNull()
    expect(createKeyStateReader('NOPE', 'win32')).toBeNull()
    expect(createKeyStateReader('NOPE', 'darwin')).toBeNull()
  })
})
