import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Module from 'module'

const h = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock('child_process', () => ({ execFile: h.execFile, default: { execFile: h.execFile } }))

import { createFocusController, getFocusController, type FocusTarget } from '../src/main/dictation/focusTarget'

const A: FocusTarget = { handle: '100', pid: 11 }
const B: FocusTarget = { handle: '200', pid: 22 }

describe('createFocusController', () => {
  function make(fgSeq: (FocusTarget | null)[], activate = vi.fn()) {
    let i = 0
    const getForeground = vi.fn(() => fgSeq[Math.min(i++, fgSeq.length - 1)])
    const sleep = vi.fn(async () => {})
    return { c: createFocusController({ ownPid: 1, getForeground, activate, sleep }), activate, getForeground, sleep }
  }

  it('never pins our own window or nothing', async () => {
    expect(await make([{ handle: '5', pid: 1 }]).c.pinForeground()).toBeNull()
    expect(await make([null]).c.pinForeground()).toBeNull()
  })

  it('restore() is true (nothing to enforce) when nothing is pinned', async () => {
    const { c, activate } = make([B])
    expect(await c.restore()).toBe(true)
    expect(activate).not.toHaveBeenCalled()
  })

  it('does not activate when pinned window is already foreground', async () => {
    const { c, activate } = make([A, A])
    await c.pinForeground()
    expect(await c.restore()).toBe(true)
    expect(activate).not.toHaveBeenCalled()
  })

  it('activates and verifies; succeeds when the window becomes foreground', async () => {
    const { c, activate } = make([A, B, A])
    await c.pinForeground()
    expect(await c.restore()).toBe(true)
    expect(activate).toHaveBeenCalledWith(A)
  })

  it('returns false after 3 failed attempts when activation silently fails (caller must not paste)', async () => {
    const { c, activate, sleep } = make([A, B])
    await c.pinForeground()
    expect(await c.restore()).toBe(false)
    expect(activate).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(3)
  })

  it('a throwing activate is swallowed (warned) and verification still decides', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { c } = make([A, B, A], vi.fn(() => { throw new Error('boom') }))
    await c.pinForeground()
    expect(await c.restore()).toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('clear() unpins', async () => {
    const { c } = make([A])
    await c.pinForeground()
    expect(c.getPinned()).toEqual(A)
    c.clear()
    expect(c.getPinned()).toBeNull()
    expect(await c.restore()).toBe(true)
  })
})

describe('getFocusController real platform deps', () => {
  const realPlatform = process.platform
  const setPlatform = (p: string) => Object.defineProperty(process, 'platform', { value: p })
  const origLoad = (Module as any)._load

  beforeEach(() => { vi.resetModules(); h.execFile.mockReset() })
  afterEach(() => { setPlatform(realPlatform); (Module as any)._load = origLoad })

  function execReturns(map: (cmd: string, args: string[]) => string | Error) {
    h.execFile.mockImplementation((cmd: string, args: string[], _o: unknown, cb: (e: Error | null, out: string) => void) => {
      const r = map(cmd, args)
      if (r instanceof Error) cb(r, '')
      else cb(null, r + '\n')
    })
  }

  function fakeKoffi(fake: unknown) {
    ;(Module as any)._load = function (req: string, ...rest: unknown[]) {
      if (req === 'koffi') return fake
      return origLoad.call(this, req, ...rest)
    }
  }

  it('darwin: reads pid via osascript and activates by pid', async () => {
    setPlatform('darwin')
    const calls: string[][] = []
    let fgPid = '4242'
    execReturns((cmd, args) => {
      expect(cmd).toBe('osascript')
      calls.push(args)
      return args[1].includes('get unix id') ? fgPid : ''
    })
    const { getFocusController: get } = await import('../src/main/dictation/focusTarget')
    const c = get()
    expect(await c.pinForeground()).toEqual({ handle: 'pid:4242', pid: 4242 })
    fgPid = '7'
    const p = c.restore()
    await vi.waitFor(() => expect(calls.some((a) => a[1].includes('unix id is 4242'))).toBe(true), { timeout: 2000 })
    fgPid = '4242'
    expect(await p).toBe(true)
  })

  it('darwin: garbage / failing osascript output -> no foreground', async () => {
    setPlatform('darwin')
    execReturns(() => 'not-a-number')
    const { getFocusController: get } = await import('../src/main/dictation/focusTarget')
    expect(await get().pinForeground()).toBeNull()
    vi.resetModules()
    execReturns(() => new Error('fail'))
    const { getFocusController: get2 } = await import('../src/main/dictation/focusTarget')
    expect(await get2().pinForeground()).toBeNull()
  })

  it('linux: xdotool window id + pid; rejects non-numeric ids', async () => {
    setPlatform('linux')
    execReturns((cmd, args) => {
      expect(cmd).toBe('xdotool')
      if (args[0] === 'getactivewindow') return '555'
      if (args[0] === 'getwindowpid') return '99'
      return ''
    })
    const { getFocusController: get } = await import('../src/main/dictation/focusTarget')
    expect(await get().pinForeground()).toEqual({ handle: '555', pid: 99 })

    vi.resetModules()
    execReturns(() => 'bad id')
    const { getFocusController: get2 } = await import('../src/main/dictation/focusTarget')
    expect(await get2().pinForeground()).toBeNull()
  })

  it('linux: unknown pid falls back to 0; restore calls windowactivate with the pinned id', async () => {
    setPlatform('linux')
    const seen: string[][] = []
    let fg = '10'
    execReturns((_c, args) => {
      seen.push(args)
      if (args[0] === 'getactivewindow') return fg
      if (args[0] === 'getwindowpid') return 'x'
      return ''
    })
    const { getFocusController: get } = await import('../src/main/dictation/focusTarget')
    const c = get()
    expect(await c.pinForeground()).toEqual({ handle: '10', pid: 0 })
    fg = '11'
    const p = c.restore()
    await vi.waitFor(() => expect(seen.some((a) => a[0] === 'windowactivate' && a[1] === '10')).toBe(true), { timeout: 2000 })
    fg = '10'
    expect(await p).toBe(true)
  })

  it('win32: koffi user32 - foreground read, restores minimized window, Alt trick + SetForegroundWindow', async () => {
    setPlatform('win32')
    const fns: Record<string, ReturnType<typeof vi.fn>> = {}
    let fgHwnd = 0x1234
    fakeKoffi({
      load: () => ({
        func: (sig: string) => {
          const name = /(\w+)\(/.exec(sig)![1]
          const f = vi.fn((...a: unknown[]) => {
            if (name === 'GetForegroundWindow') return fgHwnd
            if (name === 'GetWindowThreadProcessId') { (a[1] as number[])[0] = 777; return 1 }
            if (name === 'IsIconic') return 1
            if (name === 'SetForegroundWindow') { fgHwnd = 0x1234; return 1 }
            return 0
          })
          fns[name] = f
          return f
        }
      })
    })
    const { getFocusController: get } = await import('../src/main/dictation/focusTarget')
    const c = get()
    expect(await c.pinForeground()).toEqual({ handle: String(0x1234), pid: 777 })
    fgHwnd = 0x9999
    expect(await c.restore()).toBe(true)
    expect(fns.ShowWindow).toHaveBeenCalledWith(BigInt(0x1234), 9)
    expect(fns.AllowSetForegroundWindow).toHaveBeenCalledWith(0xffffffff)
    expect(fns.keybd_event).toHaveBeenNthCalledWith(1, 0x12, 0, 0, 0)
    expect(fns.keybd_event).toHaveBeenNthCalledWith(2, 0x12, 0, 0x0002, 0)
    expect(fns.SetForegroundWindow).toHaveBeenCalledWith(BigInt(0x1234))
  })

  it('win32: null HWND means no foreground window', async () => {
    setPlatform('win32')
    fakeKoffi({ load: () => ({ func: (sig: string) => (/GetForegroundWindow/.test(sig) ? () => 0 : vi.fn()) }) })
    const { getFocusController: get } = await import('../src/main/dictation/focusTarget')
    expect(await get().pinForeground()).toBeNull()
  })

  it('getFocusController returns a shared singleton', () => {
    expect(getFocusController()).toBe(getFocusController())
  })
})
