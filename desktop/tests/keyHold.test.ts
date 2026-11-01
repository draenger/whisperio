import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  parseAccelerator,
  winVirtualKey,
  macKeyCode,
  watchKeyRelease,
  createKeyStateReader,
  _resetKeyHoldWarnings,
  _setKeyHoldDeps
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

describe('backend loading is cached', () => {
  beforeEach(() => _resetKeyHoldWarnings())

  it('failed load is attempted and warned once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // koffi.load of a Windows dll fails off-Windows / or koffi missing: either way null
    const first = createKeyStateReader('A', 'darwin')
    const second = createKeyStateReader('B', 'darwin')
    if (first === null) {
      expect(second).toBeNull()
      expect(warn).toHaveBeenCalledTimes(1)
    }
    warn.mockRestore()
  })
})

describe('keyHold gap coverage', () => {
  beforeEach(() => {
    _resetKeyHoldWarnings()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('parseAccelerator: non-string, whitespace, trailing plus, duplicate modifiers, case', () => {
    expect(parseAccelerator(undefined as unknown as string)).toBeNull()
    expect(parseAccelerator('   ')).toBeNull()
    expect(parseAccelerator('Ctrl+Shift+')).toBeNull() // modifier-only after trimming empties
    expect(parseAccelerator('Ctrl+Control+Alt+x')).toEqual({ modifiers: ['ctrl', 'alt'], key: 'X' })
    expect(parseAccelerator(' ctrl + shift + esc ')).toEqual({ modifiers: ['ctrl', 'shift'], key: 'ESCAPE' })
    expect(parseAccelerator('Super+Return')).toEqual({ modifiers: ['meta'], key: 'ENTER' })
    expect(parseAccelerator('Option+Left')).toEqual({ modifiers: ['alt'], key: 'LEFT' })
    expect(parseAccelerator('F5')).toEqual({ modifiers: [], key: 'F5' })
  })

  it('winVirtualKey: numpad, F-range bounds, named, punctuation, lowercase rejected', () => {
    expect(winVirtualKey('NUM0')).toBe(0x60)
    expect(winVirtualKey('NUM9')).toBe(0x69)
    expect(winVirtualKey('NUMADD')).toBe(0x6b)
    expect(winVirtualKey('F0')).toBeNull()
    expect(winVirtualKey('F12')).toBe(0x7b)
    expect(winVirtualKey('PAGEDOWN')).toBe(0x22)
    expect(winVirtualKey('LEFT')).toBe(0x25)
    expect(winVirtualKey('+')).toBe(0xbb)
    expect(winVirtualKey("'")).toBe(0xde)
    expect(winVirtualKey('a')).toBeNull()
    expect(winVirtualKey('')).toBeNull()
  })

  it('macKeyCode: spot-check letters, digits, punctuation, arrows and high F keys', () => {
    expect(macKeyCode('Z')).toBe(6)
    expect(macKeyCode('0')).toBe(29)
    expect(macKeyCode('5')).toBe(23)
    expect(macKeyCode('+')).toBe(24)
    expect(macKeyCode('UP')).toBe(126)
    expect(macKeyCode('F20')).toBe(90)
    expect(macKeyCode('F24')).toBeNull()
  })

  it('cancel after the release already fired is harmless, and onRelease stays at one call', () => {
    vi.useFakeTimers()
    const onRelease = vi.fn()
    const cancel = watchKeyRelease('A', onRelease, { isKeyDown: () => false })!
    vi.advanceTimersByTime(100)
    expect(onRelease).toHaveBeenCalledTimes(1)
    expect(() => cancel()).not.toThrow()
    vi.advanceTimersByTime(60_000)
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('cancel clears the max-duration timer too (no late fire)', () => {
    vi.useFakeTimers()
    const onRelease = vi.fn()
    const cancel = watchKeyRelease('A', onRelease, { isKeyDown: () => true, maxDurationMs: 1000 })!
    cancel()
    vi.advanceTimersByTime(5000)
    expect(onRelease).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('honours a custom pollMs and does not poll faster than it', () => {
    vi.useFakeTimers()
    const isKeyDown = vi.fn(() => true)
    const cancel = watchKeyRelease('A', vi.fn(), { isKeyDown, pollMs: 100 })!
    vi.advanceTimersByTime(99)
    expect(isKeyDown).toHaveBeenCalledTimes(0)
    vi.advanceTimersByTime(1)
    expect(isKeyDown).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(300)
    expect(isKeyDown).toHaveBeenCalledTimes(4)
    cancel()
  })

  it('uses the default 10 minute cap when maxDurationMs is not given', () => {
    vi.useFakeTimers()
    const onRelease = vi.fn()
    watchKeyRelease('A', onRelease, { isKeyDown: () => true })
    vi.advanceTimersByTime(10 * 60 * 1000 - 1)
    expect(onRelease).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('does not fire again via the max timer after a normal release', () => {
    vi.useFakeTimers()
    let down = true
    const onRelease = vi.fn()
    watchKeyRelease('A', onRelease, { isKeyDown: () => down, maxDurationMs: 1000 })
    down = false
    vi.advanceTimersByTime(30)
    vi.advanceTimersByTime(5000)
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('unparseable accelerator warns once with the offending text', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(watchKeyRelease('A+B', vi.fn())).toBeNull()
    expect(watchKeyRelease('A+B', vi.fn())).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('A+B')
  })

  it('unsupported key on a supported platform warns once and names the key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(createKeyStateReader('NOPE', 'win32')).toBeNull()
    expect(createKeyStateReader('NOPE', 'win32')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('NOPE')
  })

  it('unsupported platform: reader is null and warning names the platform', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(createKeyStateReader('A', 'linux')).toBeNull()
    expect(String(warn.mock.calls[0][0])).toContain('linux')
  })

  it.skipIf(process.platform === 'darwin')('darwin backend load failure off-macOS returns null, warns once, and is cached', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(createKeyStateReader('A', 'darwin')).toBeNull()
    expect(createKeyStateReader('B', 'darwin')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('failed to load')
  })

  it.skipIf(process.platform !== 'win32')('win32 real backend: an unpressed key (F24) reads as up and triggers release', () => {
    const reader = createKeyStateReader('F24', 'win32')
    // koffi may be unavailable in some environments; then the contract is null
    if (reader) {
      expect(reader()).toBe(false)
      const cb = vi.fn()
      vi.useFakeTimers()
      const cancel = watchKeyRelease('Ctrl+F24', cb, { platform: 'win32', pollMs: 10 })!
      vi.advanceTimersByTime(20)
      expect(cb).toHaveBeenCalledTimes(1)
      cancel()
    } else {
      expect(reader).toBeNull()
    }
  })
})

describe('layout-aware Windows mapping (VkKeyScanExW)', () => {
  beforeEach(() => _resetKeyHoldWarnings())

  it('uses the scanner for OEM punctuation and letters when available', () => {
    const scan = vi.fn((ch: string) => (ch === ';' ? 0xbc : ch === 'z' ? 0x5a : null))
    expect(winVirtualKey(';', scan)).toBe(0xbc) // QWERTZ: ';' lives on VK_OEM_COMMA
    expect(winVirtualKey('Z', scan)).toBe(0x5a)
    expect(scan).toHaveBeenCalledWith(';')
  })
  it('punctuation the layout cannot type -> null (toggle), not a wrong static key', () => {
    expect(winVirtualKey(';', () => null)).toBeNull()
  })
  it('falls back to the static table with no scanner / failing scanner / unscannable letter', () => {
    expect(winVirtualKey(';', null)).toBe(0xba)
    expect(winVirtualKey('A', () => null)).toBe(0x41)
    expect(
      winVirtualKey('5', () => {
        throw new Error('x')
      })
    ).toBe(0x35)
  })
  it('named keys never go through the scanner', () => {
    const scan = vi.fn(() => 1)
    expect(winVirtualKey('SPACE', scan)).toBe(0x20)
    expect(winVirtualKey('F5', scan)).toBe(0x74)
    expect(scan).not.toHaveBeenCalled()
  })
  it('createKeyStateReader resolves via the injected scanner on win32', () => {
    const scan = vi.fn(() => 0xbc)
    const raw = vi.fn(() => true)
    _setKeyHoldDeps({ loadWinScanner: () => scan })
    // inject a fake backend via the cache path is not possible; just verify the scanner is consulted
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    createKeyStateReader(';', 'win32')
    expect(scan).toHaveBeenCalledWith(';')
    void raw
  })
})

describe('macOS Input Monitoring detection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetKeyHoldWarnings()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  const run = (down: boolean): ReturnType<typeof vi.fn> => {
    const onRelease = vi.fn()
    watchKeyRelease('Ctrl+Space', onRelease, { platform: 'darwin', isKeyDown: () => down })
    vi.advanceTimersByTime(100)
    return onRelease
  }

  it('first-poll-up twice in a row -> no release, one notification, then toggle fallback', () => {
    const notify = vi.fn()
    _setKeyHoldDeps({ notify, checkInputMonitoring: () => 2 })
    expect(run(false)).toHaveBeenCalledTimes(1) // 1st: could be a genuine quick tap
    expect(run(false)).not.toHaveBeenCalled() // 2nd: assume broken, stay recording
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][1]).toContain('Input Monitoring')
    // degraded: hold unavailable for later sessions, no extra notification
    expect(createKeyStateReader('SPACE', 'darwin')).toBeNull()
    expect(watchKeyRelease('Ctrl+Space', vi.fn(), { platform: 'darwin' })).toBeNull()
    expect(notify).toHaveBeenCalledTimes(1)
  })
  it('a session that reads key down on first poll resets the streak', () => {
    const notify = vi.fn()
    _setKeyHoldDeps({ notify })
    run(false)
    let down = true
    const onRelease = vi.fn()
    watchKeyRelease('Ctrl+Space', onRelease, { platform: 'darwin', isKeyDown: () => down })
    vi.advanceTimersByTime(30)
    down = false
    vi.advanceTimersByTime(30)
    expect(onRelease).toHaveBeenCalledTimes(1)
    expect(run(false)).toHaveBeenCalledTimes(1)
    expect(notify).not.toHaveBeenCalled()
  })
  it('IOHIDCheckAccess denied -> toggle fallback and one notification', () => {
    const notify = vi.fn()
    _setKeyHoldDeps({ notify, checkInputMonitoring: () => 1 })
    expect(createKeyStateReader('SPACE', 'darwin')).toBeNull()
    expect(createKeyStateReader('SPACE', 'darwin')).toBeNull()
    expect(notify).toHaveBeenCalledTimes(1)
  })
  it('granted / unknown / unavailable do not notify or block', () => {
    const notify = vi.fn()
    for (const v of [0, 2, null] as const) {
      _setKeyHoldDeps({ notify, checkInputMonitoring: () => v })
      // backend load is real koffi on a non-mac host -> may be null; only assert no notification
      createKeyStateReader('SPACE', 'darwin')
    }
    expect(notify).not.toHaveBeenCalled()
  })
  it('first-poll heuristic is not applied off macOS (Windows)', () => {
    const notify = vi.fn()
    _setKeyHoldDeps({ notify })
    expect(run2('win32')).toHaveBeenCalledTimes(1)
    expect(run2('win32')).toHaveBeenCalledTimes(1)
    expect(notify).not.toHaveBeenCalled()
  })
  it('linux unchanged: null, no notification', () => {
    const notify = vi.fn()
    _setKeyHoldDeps({ notify })
    expect(watchKeyRelease('Ctrl+Space', vi.fn(), { platform: 'linux' })).toBeNull()
    expect(notify).not.toHaveBeenCalled()
  })
  function run2(platform: NodeJS.Platform): ReturnType<typeof vi.fn> {
    const onRelease = vi.fn()
    watchKeyRelease('Ctrl+Space', onRelease, { platform, isKeyDown: () => false })
    vi.advanceTimersByTime(100)
    return onRelease
  }
})
