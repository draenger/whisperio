import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// autoPaste.ts picks its keystroke backend at import time from process.platform, so each test
// sets the platform, resets the module registry and imports it fresh. The Windows (koffi)
// branch needs the native module and is intentionally not exercised here.

const h = vi.hoisted(() => {
  const state = { text: 'ORIGINAL' }
  const clipboard = {
    readText: vi.fn(() => state.text),
    writeText: vi.fn((t: string) => { state.text = t }),
    readHTML: vi.fn(() => ''),
    readRTF: vi.fn(() => ''),
    readImage: vi.fn(() => ({ isEmpty: () => true })),
    availableFormats: vi.fn(() => []),
    write: vi.fn((d: { text?: string }) => { state.text = d.text ?? '' })
  }
  return {
    state,
    clipboard,
    isTrusted: vi.fn(() => true),
    notifShow: vi.fn(),
    notifCtor: vi.fn(),
    execFile: vi.fn(),
    loadSettings: vi.fn(() => ({}) as Record<string, unknown>),
    app: { isPackaged: false } as { isPackaged: boolean }
  }
})

vi.mock('electron', () => ({
  clipboard: h.clipboard,
  systemPreferences: { isTrustedAccessibilityClient: h.isTrusted },
  Notification: class {
    constructor(opts: unknown) { h.notifCtor(opts) }
    show(): void { h.notifShow() }
  },
  app: h.app
}))
vi.mock('child_process', () => ({ execFile: h.execFile }))
vi.mock('../src/main/settingsManager', () => ({ loadSettings: h.loadSettings }))

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

async function load(platform: string): Promise<typeof import('../src/main/dictation/autoPaste')> {
  setPlatform(platform)
  vi.resetModules()
  return import('../src/main/dictation/autoPaste')
}

/** Run autoPaste while advancing the fake clock past the 300 ms modifier-release wait. */
async function run(p: Promise<void>, ms = 400): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await p
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  h.state.text = 'ORIGINAL'
  h.app.isPackaged = false
  h.isTrusted.mockReset().mockReturnValue(true)
  h.loadSettings.mockReset().mockReturnValue({})
  h.execFile.mockReset()
  h.notifCtor.mockReset()
  h.notifShow.mockReset()
  h.clipboard.writeText.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Object.defineProperty(process, 'platform', realPlatform)
})

describe('autoPaste (linux / xdotool)', () => {
  it('writes the text to the clipboard, waits for modifiers, then sends ctrl+v', async () => {
    const m = await load('linux')
    const p = m.autoPaste('hello')
    expect(h.clipboard.writeText).toHaveBeenCalledWith('hello')
    await vi.advanceTimersByTimeAsync(299)
    expect(h.execFile).not.toHaveBeenCalled() // still waiting for hotkey modifiers to release
    await run(p, 5)
    expect(h.execFile).toHaveBeenCalledWith('xdotool', ['key', 'ctrl+v'])
  })

  it('sendEnter fires Return via xdotool', async () => {
    const m = await load('linux')
    m.sendEnter()
    expect(h.execFile).toHaveBeenCalledWith('xdotool', ['key', 'Return'])
  })

  it('does not touch the clipboard restore path when restore is off (default)', async () => {
    const m = await load('linux')
    await run(m.autoPaste('pasted'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.state.text).toBe('pasted') // original NOT restored
  })

  it('restoreClipboard option: restores the previous clipboard after the delay', async () => {
    const m = await load('linux')
    const p = m.autoPaste('pasted', { restoreClipboard: true, restoreDelayMs: 500 })
    await run(p)
    expect(h.state.text).toBe('pasted') // not yet - the target app may still be reading it
    await vi.advanceTimersByTimeAsync(2500)
    expect(h.state.text).toBe('ORIGINAL')
  })

  it('reads the restore flag from settings when no option is passed', async () => {
    h.loadSettings.mockReturnValue({ restoreClipboard: true, clipboardRestoreDelayMs: 400 })
    const m = await load('linux')
    await run(m.autoPaste('x'))
    await vi.advanceTimersByTimeAsync(2500)
    expect(h.state.text).toBe('ORIGINAL')
  })

  it('an explicit restoreClipboard:false beats the persisted setting', async () => {
    h.loadSettings.mockReturnValue({ restoreClipboard: true })
    const m = await load('linux')
    await run(m.autoPaste('x', { restoreClipboard: false }))
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.state.text).toBe('x')
  })

  it('treats an unreadable settings file as restore-off instead of failing the paste', async () => {
    h.loadSettings.mockImplementation(() => { throw new Error('corrupt') })
    const m = await load('linux')
    await run(m.autoPaste('safe'))
    expect(h.execFile).toHaveBeenCalledWith('xdotool', ['key', 'ctrl+v'])
    expect(h.state.text).toBe('safe')
  })

  it('does not restore if the user changed the clipboard meanwhile', async () => {
    const m = await load('linux')
    const p = m.autoPaste('pasted', { restoreClipboard: true, restoreDelayMs: 500 })
    await run(p)
    h.state.text = 'USER COPIED SOMETHING'
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.state.text).toBe('USER COPIED SOMETHING')
  })

  it('logs only the length in a packaged build (dictated speech never reaches stdout)', async () => {
    h.app.isPackaged = true
    const m = await load('linux')
    await run(m.autoPaste('secret words'))
    const lines = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => l.includes('12 chars'))).toBe(true)
    expect(lines.some((l) => l.includes('secret words'))).toBe(false)
  })

  it('logs a truncated preview (80 chars) in dev builds', async () => {
    const m = await load('linux')
    await run(m.autoPaste('a'.repeat(200)))
    const line = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes('autoPaste: "'))!
    expect(line).toContain('a'.repeat(80) + '...')
    expect(line).not.toContain('a'.repeat(81))
  })

  it('treats an unavailable app object as non-dev (no content logging)', async () => {
    Object.defineProperty(h.app, 'isPackaged', { get() { throw new Error('no app') }, configurable: true })
    try {
      const m = await load('linux')
      await run(m.autoPaste('private'))
      const lines = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
      expect(lines.some((l) => l.includes('private'))).toBe(false)
      expect(lines.some((l) => l.includes('7 chars'))).toBe(true)
    } finally {
      Object.defineProperty(h.app, 'isPackaged', { value: false, writable: true, configurable: true })
    }
  })
})

describe('autoPaste (macOS / osascript)', () => {
  it('pastes via osascript Cmd+V once Accessibility is granted, and awaits osascript completion', async () => {
    let finish: () => void = () => {}
    h.execFile.mockImplementation((_bin: string, _args: string[], cb: (e: null, o: string, s: string) => void) => {
      finish = () => cb(null, '', '')
    })
    const m = await load('darwin')
    let done = false
    const p = m.autoPaste('hi').then(() => { done = true })
    await vi.advanceTimersByTimeAsync(400)
    expect(h.isTrusted).toHaveBeenCalledWith(true)
    expect(h.execFile).toHaveBeenCalledWith(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "v" using command down'],
      expect.any(Function)
    )
    expect(done).toBe(false) // waits for osascript to exit
    finish()
    await p
    expect(done).toBe(true)
  })

  it('without Accessibility: leaves text on clipboard, notifies, never sends a keystroke', async () => {
    h.isTrusted.mockReturnValue(false)
    const m = await load('darwin')
    await m.autoPaste('hi')
    expect(h.state.text).toBe('hi')
    expect(h.execFile).not.toHaveBeenCalled()
    expect(h.notifCtor).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('auto-paste') }))
    expect(h.notifShow).toHaveBeenCalledTimes(1)
  })

  it('without Accessibility the pending clipboard restore is cancelled (text must stay for manual Cmd+V)', async () => {
    h.isTrusted.mockReturnValue(false)
    const m = await load('darwin')
    await m.autoPaste('keep me', { restoreClipboard: true, restoreDelayMs: 300 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.state.text).toBe('keep me')
  })

  it('a failing osascript is swallowed (logged) and the paste flow still completes', async () => {
    h.execFile.mockImplementation((_b: string, _a: string[], cb: (e: Error | null, o: string, s: string) => void) => {
      cb(new Error('not allowed'), '', 'boom')
    })
    const m = await load('darwin')
    await run(m.autoPaste('hi'))
    expect(console.error).toHaveBeenCalled()
  })

  it('sendEnter uses key code 36', async () => {
    h.execFile.mockImplementation((_b: string, _a: string[], cb: (e: null, o: string, s: string) => void) => cb(null, '', ''))
    const m = await load('darwin')
    m.sendEnter()
    expect(h.execFile).toHaveBeenCalledWith(
      'osascript',
      ['-e', 'tell application "System Events" to key code 36'],
      expect.any(Function)
    )
  })
})

describe('ensureAccessibilityPermission', () => {
  it('is always true off macOS and never queries the OS', async () => {
    const m = await load('linux')
    expect(m.ensureAccessibilityPermission(true)).toBe(true)
    expect(h.isTrusted).not.toHaveBeenCalled()
  })

  it('on macOS forwards the prompt flag and returns the OS answer', async () => {
    h.isTrusted.mockReturnValue(false)
    const m = await load('darwin')
    expect(m.ensureAccessibilityPermission()).toBe(false)
    expect(h.isTrusted).toHaveBeenLastCalledWith(false)
    expect(m.ensureAccessibilityPermission(true)).toBe(false)
    expect(h.isTrusted).toHaveBeenLastCalledWith(true)
  })

  it('captureTargetWindow / restoreTargetWindow are inert no-ops', async () => {
    const m = await load('linux')
    expect(() => { m.captureTargetWindow(); m.restoreTargetWindow() }).not.toThrow()
  })
})
