import { describe, it, expect, vi } from 'vitest'
import { parseCliCommand, dispatchCliCommand } from '../src/main/cliControl'

describe('parseCliCommand', () => {
  it('parses packaged argv shape', () => {
    expect(parseCliCommand(['C:\App\Whisperio.exe', '--toggle'])).toBe('toggle')
  })
  it('parses dev argv shape', () => {
    expect(parseCliCommand(['electron.exe', '.', '--stop'])).toBe('stop')
  })
  it.each(['toggle', 'start', 'stop', 'cancel', 'send'])('recognizes --%s', (c) => {
    expect(parseCliCommand(['x', `--${c}`])).toBe(c)
  })
  it('is case-insensitive', () => {
    expect(parseCliCommand(['x', '--TOGGLE'])).toBe('toggle')
  })
  it('ignores Chromium/Electron switches', () => {
    expect(parseCliCommand(['x', '--enable-features=x', '--no-sandbox', '--start'])).toBe('start')
    expect(parseCliCommand(['x', '--enable-features=toggle', '--toggle=1'])).toBeNull()
  })
  it('ignores unknown flags and paths that merely contain a flag', () => {
    expect(parseCliCommand(['x', '--foo', '/opt/--toggle/app'])).toBeNull()
  })
  it('first recognized flag wins', () => {
    expect(parseCliCommand(['x', '--cancel', '--toggle'])).toBe('cancel')
  })
  it('returns null for empty argv', () => {
    expect(parseCliCommand([])).toBeNull()
  })
})

describe('dispatchCliCommand', () => {
  it.each(['toggle', 'start', 'stop', 'cancel', 'send'] as const)('maps %s to api.%s only', (c) => {
    const api = { toggle: vi.fn(), start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), send: vi.fn() }
    dispatchCliCommand(c, api)
    for (const k of Object.keys(api) as (keyof typeof api)[]) {
      expect(api[k]).toHaveBeenCalledTimes(k === c ? 1 : 0)
    }
  })
})

describe('parseCliCommand robustness', () => {
  it('trims surrounding whitespace in an argument', () => {
    expect(parseCliCommand(['x', '  --Send  '])).toBe('send')
  })
  it('skips non-string argv entries instead of throwing', () => {
    expect(parseCliCommand(['x', undefined, null, 42, {}, '--stop'] as unknown as string[])).toBe('stop')
  })
  it('never matches inherited Object.prototype keys (bare words in argv)', () => {
    for (const word of ['constructor', '__proto__', 'tostring', 'valueof', 'hasownproperty']) {
      expect(parseCliCommand(['x', word])).toBeNull()
    }
  })
  it('rejects near-miss spellings', () => {
    for (const a of ['-toggle', 'toggle', '--toggl', '--starts', '--', '']) {
      expect(parseCliCommand(['x', a])).toBeNull()
    }
  })
  it('does not accept a flag value form like --send=1 or --stop:now', () => {
    expect(parseCliCommand(['x', '--send=1', '--stop:now'])).toBeNull()
  })
})

describe('dispatchCliCommand robustness', () => {
  it('does not wait on or surface the api return value (fire-and-forget)', () => {
    const api = {
      toggle: vi.fn(() => new Promise(() => {})), // never resolves
      start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), send: vi.fn()
    }
    expect(() => dispatchCliCommand('toggle', api)).not.toThrow()
    expect(api.toggle).toHaveBeenCalledTimes(1)
  })
  it('an unknown command calls nothing', () => {
    const api = { toggle: vi.fn(), start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), send: vi.fn() }
    dispatchCliCommand('bogus' as never, api)
    for (const k of Object.keys(api) as (keyof typeof api)[]) expect(api[k]).not.toHaveBeenCalled()
  })
  it('a synchronous throw from the api propagates to the caller', () => {
    const api = {
      toggle: vi.fn(() => { throw new Error('boom') }),
      start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), send: vi.fn()
    }
    expect(() => dispatchCliCommand('toggle', api)).toThrow('boom')
  })
})

import { parseUrlCommand, parseControlArgv, createOpenUrlHandler } from '../src/main/cliControl'

describe('whisperio:// URL parsing', () => {
  it.each([
    ['whisperio://toggle', 'toggle'],
    ['whisperio://toggle/', 'toggle'],
    ['WHISPERIO://Toggle', 'toggle'],
    ['whisperio://toggle?x=1', 'toggle'],
    ['whisperio://send#frag', 'send'],
    ['whisperio://stop/?a=b#c', 'stop'],
    ['  whisperio://cancel  ', 'cancel'],
    ['whisperio://start', 'start']
  ])('accepts %s', (u, c) => {
    expect(parseUrlCommand(u)).toBe(c)
  })
  it.each([
    'whisperio://evil', 'whisperio://', 'whisperio:///toggle', 'http://toggle', 'javascript:toggle',
    'whisperio://toggle/extra', 'whisperio://toggle:80', 'whisperio://user@toggle', 'whisperio://constructor',
    'whisperio://toggle%20', 'whisperio:toggle', 'xwhisperio://toggle', 'whisperio://toggle\nx'
  ])('rejects %s', (u) => {
    expect(parseUrlCommand(u)).toBeNull()
  })
  it('rejects non-strings', () => {
    expect(parseUrlCommand(undefined)).toBeNull()
    expect(parseUrlCommand(42)).toBeNull()
  })
  it('parseCliCommand accepts a URL argv entry and flags still work', () => {
    expect(parseCliCommand(['C:\W.exe', 'whisperio://toggle/'])).toBe('toggle')
    expect(parseCliCommand(['x', 'whisperio://evil', '--stop'])).toBe('stop')
    expect(parseCliCommand(['x', 'whisperio://evil'])).toBeNull()
  })
  it('parseControlArgv marks the source', () => {
    expect(parseControlArgv(['x', 'whisperio://start'])).toEqual({ cmd: 'start', viaUrl: true })
    expect(parseControlArgv(['x', '--start'])).toEqual({ cmd: 'start', viaUrl: false })
  })
})

describe('createOpenUrlHandler (macOS open-url)', () => {
  const mk = (ready: boolean, allowed: boolean) => {
    const api = { toggle: vi.fn(), start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), send: vi.fn() }
    const log = vi.fn()
    const h = createOpenUrlHandler({ isReady: () => ready, isAllowed: () => allowed, api, log })
    const ev = { preventDefault: vi.fn() }
    return { api, log, h, ev }
  }
  it('dispatches when ready and allowed', () => {
    const { api, h, ev } = mk(true, true)
    h(ev, 'whisperio://toggle?x=1')
    expect(api.toggle).toHaveBeenCalledTimes(1)
    expect(ev.preventDefault).toHaveBeenCalled()
  })
  it('ignores when the flag is off', () => {
    const { api, h, ev, log } = mk(true, false)
    h(ev, 'whisperio://toggle')
    expect(Object.values(api).every((f) => f.mock.calls.length === 0)).toBe(true)
    expect(log.mock.calls[0][0]).not.toContain('whisperio://')
  })
  it('ignores a cold-start URL (before ready)', () => {
    const { api, h, ev } = mk(false, true)
    h(ev, 'whisperio://start')
    expect(api.start).not.toHaveBeenCalled()
  })
  it('ignores invalid URLs', () => {
    const { api, h, ev } = mk(true, true)
    h(ev, 'whisperio://evil'); h(ev, 'http://toggle')
    expect(Object.values(api).every((f) => f.mock.calls.length === 0)).toBe(true)
  })
})
