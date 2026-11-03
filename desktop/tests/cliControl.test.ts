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

import {
  parseUrlCommand, parseControlArgv, hasUrlArg, createOpenUrlHandler, createUrlDispatcher,
  isUrlCommandAllowed, shouldRegisterProtocol
} from '../src/main/cliControl'

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
  ])('rejects %j', (u) => {
    expect(parseUrlCommand(u)).toBeNull()
  })
  it('rejects non-strings', () => {
    expect(parseUrlCommand(undefined)).toBeNull()
    expect(parseUrlCommand(42)).toBeNull()
  })
})

describe('parseControlArgv URL-origin hardening', () => {
  it('URL as last entry is accepted and marked viaUrl', () => {
    expect(parseCliCommand(['C:\\W.exe', 'whisperio://toggle/'])).toBe('toggle')
    expect(parseControlArgv(['x', 'whisperio://start'])).toEqual({ cmd: 'start', viaUrl: true })
    expect(parseControlArgv(['x', '--start'])).toEqual({ cmd: 'start', viaUrl: false })
  })
  it('any whisperio: entry makes the call URL-originated: flags are never honoured', () => {
    expect(parseControlArgv(['x', '--send', 'whisperio://stop'])).toEqual({ cmd: 'stop', viaUrl: true })
    expect(parseControlArgv(['x', '--stop', 'whisperio://evil'])).toBeNull()
    expect(parseCliCommand(['x', 'whisperio://evil', '--stop'])).toBeNull()
    expect(parseCliCommand(['x', 'whisperio://evil'])).toBeNull()
  })
  it('URL not in last position is rejected', () => {
    expect(parseControlArgv(['x', 'whisperio://stop', '--foo'])).toBeNull()
  })
  it('more than one URL entry is rejected', () => {
    expect(parseControlArgv(['x', 'whisperio://stop', 'whisperio://cancel'])).toBeNull()
    expect(parseControlArgv(['x', 'whisperio://stop', 'whisperio://stop'])).toBeNull()
  })
  it('hasUrlArg detects any whisperio: entry', () => {
    expect(hasUrlArg(['x', 'WHISPERIO:foo'])).toBe(true)
    expect(hasUrlArg(['x', '--stop'])).toBe(false)
  })
})

describe('URL command policy', () => {
  it('stop/cancel always; toggle/start need allowStart; send never', () => {
    expect(isUrlCommandAllowed('stop', false)).toBe(true)
    expect(isUrlCommandAllowed('cancel', false)).toBe(true)
    expect(isUrlCommandAllowed('toggle', false)).toBe(false)
    expect(isUrlCommandAllowed('start', false)).toBe(false)
    expect(isUrlCommandAllowed('toggle', true)).toBe(true)
    expect(isUrlCommandAllowed('start', true)).toBe(true)
    expect(isUrlCommandAllowed('send', true)).toBe(false)
  })
  it('protocol registered only when allowed and (packaged or dev env)', () => {
    expect(shouldRegisterProtocol({ isPackaged: true, allowUrlControl: true })).toBe(true)
    expect(shouldRegisterProtocol({ isPackaged: true, allowUrlControl: false })).toBe(false)
    expect(shouldRegisterProtocol({ isPackaged: false, allowUrlControl: true })).toBe(false)
    expect(shouldRegisterProtocol({ isPackaged: false, devEnv: '1', allowUrlControl: true })).toBe(true)
    expect(shouldRegisterProtocol({ isPackaged: false, devEnv: 'yes', allowUrlControl: true })).toBe(false)
  })
})

describe('createUrlDispatcher', () => {
  const mk = (o: { allow?: boolean; start?: boolean; locked?: boolean } = {}) => {
    const api = { toggle: vi.fn(), start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), send: vi.fn() }
    const log = vi.fn()
    let t = 10_000
    const d = createUrlDispatcher({
      isAllowed: () => o.allow ?? true, isStartAllowed: () => o.start ?? true,
      isLocked: () => o.locked ?? false, now: () => t, api, log
    })
    return { api, log, d, tick: (ms: number) => { t += ms } }
  }
  const total = (api: Record<string, ReturnType<typeof vi.fn>>) => Object.values(api).reduce((n, f) => n + f.mock.calls.length, 0)

  it('allowUrlControl off ignores everything, including stop', () => {
    const { api, d, log } = mk({ allow: false })
    for (const c of ['stop', 'cancel', 'toggle', 'start', 'send'] as const) expect(d(c)).toBe(false)
    expect(total(api)).toBe(0)
    expect(log.mock.calls.every((c) => !String(c[0]).includes('://'))).toBe(true)
  })
  it('send is never dispatched, even with every flag on', () => {
    const { api, d } = mk()
    expect(d('send')).toBe(false)
    expect(api.send).not.toHaveBeenCalled()
  })
  it('toggle/start blocked unless allowUrlStart; stop/cancel pass', () => {
    const { api, d } = mk({ start: false })
    expect(d('toggle')).toBe(false)
    expect(d('start')).toBe(false)
    expect(d('stop')).toBe(true)
    expect(d('cancel')).toBe(true)
    expect(api.stop).toHaveBeenCalledTimes(1)
    expect(api.cancel).toHaveBeenCalledTimes(1)
    expect(total(api)).toBe(2)
  })
  it('start-class ignored while screen locked, stop/cancel still pass', () => {
    const { api, d } = mk({ locked: true })
    expect(d('start')).toBe(false)
    expect(d('toggle')).toBe(false)
    expect(d('stop')).toBe(true)
    expect(api.start).not.toHaveBeenCalled()
  })
  it('rate-limits start-class within 1s; stop/cancel always pass; resumes after 1s', () => {
    const { api, d, tick } = mk()
    expect(d('toggle')).toBe(true)
    tick(500)
    expect(d('toggle')).toBe(false)
    expect(d('stop')).toBe(true)
    expect(d('stop')).toBe(true)
    expect(d('cancel')).toBe(true)
    tick(600)
    expect(d('start')).toBe(true)
    expect(api.toggle).toHaveBeenCalledTimes(1)
    expect(api.start).toHaveBeenCalledTimes(1)
  })
})

describe('createOpenUrlHandler (macOS open-url)', () => {
  const mk = (ready: boolean) => {
    const dispatch = vi.fn()
    const h = createOpenUrlHandler({ isReady: () => ready, dispatch })
    return { dispatch, h, ev: { preventDefault: vi.fn() } }
  }
  it('dispatches a valid URL when ready', () => {
    const { dispatch, h, ev } = mk(true)
    h(ev, 'whisperio://toggle?x=1')
    expect(dispatch).toHaveBeenCalledWith('toggle')
    expect(ev.preventDefault).toHaveBeenCalled()
  })
  it('ignores a cold-start URL (before ready)', () => {
    const { dispatch, h, ev } = mk(false)
    h(ev, 'whisperio://stop')
    expect(dispatch).not.toHaveBeenCalled()
  })
  it('ignores invalid URLs', () => {
    const { dispatch, h, ev } = mk(true)
    h(ev, 'whisperio://evil'); h(ev, 'http://toggle')
    expect(dispatch).not.toHaveBeenCalled()
  })
  it('end to end with the gate: flag off blocks, on allows stop', () => {
    const api = { toggle: vi.fn(), start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), send: vi.fn() }
    let allow = false
    const d = createUrlDispatcher({ isAllowed: () => allow, isStartAllowed: () => false, isLocked: () => false, api })
    const h = createOpenUrlHandler({ isReady: () => true, dispatch: d })
    h({ preventDefault() {} }, 'whisperio://stop')
    expect(api.stop).not.toHaveBeenCalled()
    allow = true
    h({ preventDefault() {} }, 'whisperio://stop')
    expect(api.stop).toHaveBeenCalledTimes(1)
  })
})
