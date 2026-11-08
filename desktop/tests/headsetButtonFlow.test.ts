import { vi, describe, it, expect, beforeEach } from 'vitest'

// Drives the real hotkeyManager state machine through the headset-button entry
// point; everything with an OS/Electron effect is mocked.
const mockIpcHandle = vi.fn()
const mockWriteText = vi.fn()
const calls: string[] = []

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
  globalShortcut: { register: vi.fn(() => true), unregister: vi.fn(), unregisterAll: vi.fn(), isRegistered: vi.fn(() => false) },
  ipcMain: { on: vi.fn(), handle: (...a: unknown[]) => mockIpcHandle(...a), removeListener: vi.fn(), removeHandler: vi.fn() },
  clipboard: { readText: vi.fn(() => ''), writeText: (...a: unknown[]) => mockWriteText(...a) },
  Notification: class { static isSupported = vi.fn(() => false); show = vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))
vi.mock('fs', () => ({ existsSync: vi.fn(() => false), readFileSync: vi.fn(() => '{}'), writeFileSync: vi.fn() }))

const mockSend = vi.fn()
vi.mock('../src/main/dictation/overlayWindow', () => ({
  showOverlay: vi.fn(),
  hideOverlay: vi.fn(),
  getOverlayWindow: vi.fn(),
  ensureOverlayReady: vi.fn(async () => ({})),
  broadcastToOverlays: vi.fn(),
  sendToPrimaryOverlay: (...a: unknown[]) => mockSend(...a)
}))

const mockAutoPaste = vi.fn(async (_t: string) => {
  calls.push('paste')
})
const mockSendEnter = vi.fn(() => {
  calls.push('enter')
})
vi.mock('../src/main/dictation/autoPaste', () => ({
  autoPaste: (t: string) => mockAutoPaste(t),
  captureTargetWindow: vi.fn(),
  restoreTargetWindow: vi.fn(),
  sendEnter: () => mockSendEnter()
}))

let settings: Record<string, unknown>
vi.mock('../src/main/settingsManager', () => ({ loadSettings: () => settings }))
vi.mock('../src/main/transcribe', () => ({ rewriteClipboardForCommand: vi.fn() }))
const mockNotify = vi.fn()
vi.mock('../src/main/errorHandler', () => ({ notifyInfo: (...a: unknown[]) => mockNotify(...a), handleCommandError: vi.fn() }))
vi.mock('../src/main/dictation/keyHold', () => ({ watchKeyRelease: vi.fn(), setKeyHoldNotifier: vi.fn() }))

const mockCue = vi.fn((k: string) => {
  calls.push(`cue:${k}`)
})
vi.mock('../src/main/dictation/buttonCues', () => ({ playCue: (k: string) => mockCue(k) }))

const focus = {
  pinForeground: vi.fn(async () => ({ handle: '1', pid: 2 })),
  getPinned: vi.fn(() => ({ handle: '1', pid: 2 }) as { handle: string; pid: number } | null),
  restore: vi.fn(async () => {
    calls.push('restore')
    return true
  }),
  clear: vi.fn()
}
vi.mock('../src/main/dictation/focusTarget', () => ({ getFocusController: () => focus }))

type Mod = typeof import('../src/main/dictation/hotkeyManager')
let mod: Mod
let handleResult: (e: unknown, text: string, id?: number, reason?: 'silent') => Promise<void>

beforeEach(async () => {
  vi.clearAllMocks()
  calls.length = 0
  settings = { dictationHotkey: '', dictateAndSendHotkey: '', outputRecordingHotkey: '', commandHotkey: '', buttonAutoPin: true }
  focus.restore.mockImplementation(async () => {
    calls.push('restore')
    return true
  })
  focus.getPinned.mockReturnValue({ handle: '1', pid: 2 })
  vi.resetModules()
  mod = await import('../src/main/dictation/hotkeyManager')
  mod.registerHotkey()
  handleResult = (mockIpcHandle.mock.calls.find((c) => c[0] === 'dictation:result') as unknown[])[1] as typeof handleResult
})

describe('headset button flow', () => {
  it('press 1 starts recording + start cue; press 2 stops, result -> restore focus -> paste -> enter -> sent cue', async () => {
    await mod.buttonToggle()
    expect(mod.getState()).toBe('recording')
    expect(mockSend).toHaveBeenCalledWith('dictation:activate', expect.any(Number))
    expect(calls).toEqual(['cue:start'])
    expect(focus.pinForeground).toHaveBeenCalledTimes(1)

    await mod.buttonToggle()
    expect(mod.getState()).toBe('transcribing')
    const deact = mockSend.mock.calls.find((c) => c[0] === 'dictation:deactivate')!
    expect(deact).toBeTruthy() // immediate stop, no waiting for silence

    await handleResult({}, '  hello world ', deact[1] as number)
    expect(mockAutoPaste).toHaveBeenCalledWith('hello world')
    // order matters: focus is restored BEFORE paste; Enter only after paste; 'sent' last
    expect(calls).toEqual(['cue:start', 'restore', 'paste', 'enter', 'cue:sent'])
    expect(mod.getState()).toBe('idle')
  })

  it('focus restore failure: no paste, no Enter, text kept on clipboard, error cue, back to idle', async () => {
    await mod.buttonToggle()
    await mod.buttonToggle()
    const id = mockSend.mock.calls.find((c) => c[0] === 'dictation:deactivate')![1] as number
    focus.restore.mockImplementation(async () => {
      calls.push('restore')
      return false
    })
    await handleResult({}, 'secret text', id)
    expect(mockAutoPaste).not.toHaveBeenCalled()
    expect(mockSendEnter).not.toHaveBeenCalled()
    expect(mockWriteText).toHaveBeenCalledWith('secret text')
    expect(calls).toEqual(['cue:start', 'restore', 'cue:error'])
    expect(calls).not.toContain('cue:sent')
    expect(mod.getState()).toBe('idle')
  })

  it('a paste exception yields the error cue, never the sent cue', async () => {
    await mod.buttonToggle()
    await mod.buttonToggle()
    mockAutoPaste.mockRejectedValueOnce(new Error('keystroke failed'))
    await handleResult({}, 'x')
    expect(calls).toContain('cue:error')
    expect(calls).not.toContain('cue:sent')
    expect(mockSendEnter).not.toHaveBeenCalled()
  })

  it('silent/empty result gives the error cue and no paste', async () => {
    await mod.buttonToggle()
    await mod.buttonToggle()
    await handleResult({}, '', undefined, 'silent')
    expect(mockAutoPaste).not.toHaveBeenCalled()
    expect(calls).toContain('cue:error')
  })

  it('pressing while transcribing only plays the held cue (no force-reset, result still delivered)', async () => {
    await mod.buttonToggle()
    await mod.buttonToggle()
    const id = mockSend.mock.calls.find((c) => c[0] === 'dictation:deactivate')![1] as number
    await mod.buttonToggle()
    expect(mod.getState()).toBe('transcribing')
    expect(calls).toContain('cue:held')
    await handleResult({}, 'still pasted', id)
    expect(mockAutoPaste).toHaveBeenCalledWith('still pasted')
  })

  it('a stale result from a cancelled session is dropped (no paste, no cue)', async () => {
    await mod.buttonToggle()
    const firstId = mockSend.mock.calls.find((c) => c[0] === 'dictation:activate')![1] as number
    mod.cliCancel()
    calls.length = 0
    await handleResult({}, 'late', firstId)
    expect(mockAutoPaste).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('the button flag does not leak into a later normal (hotkey) session: no focus restore, no cues, no Enter', async () => {
    await mod.buttonToggle()
    mod.cliCancel() // abandon the button session
    calls.length = 0
    await mod.cliToggle()
    await mod.cliToggle()
    await handleResult({}, 'normal')
    expect(calls).toEqual(['paste'])
  })

  it('a double press while the first press is still starting does not start two sessions', async () => {
    await Promise.all([mod.buttonToggle(), mod.buttonToggle()])
    expect(mod.getState()).toBe('recording')
    expect(mockSend.mock.calls.filter((c) => c[0] === 'dictation:activate')).toHaveLength(1)
  })

  it('buttonAutoPin=false keeps the manually pinned window instead of re-pinning', async () => {
    settings.buttonAutoPin = false
    await mod.buttonToggle()
    expect(focus.pinForeground).not.toHaveBeenCalled()
  })

  it('buttonAutoPin=false with nothing pinned falls back to pinning at first press', async () => {
    settings.buttonAutoPin = false
    focus.getPinned.mockReturnValue(null)
    await mod.buttonToggle()
    expect(focus.pinForeground).toHaveBeenCalledTimes(1)
  })

  it('the button stopping a hotkey-started session does not add an Enter', async () => {
    await mod.cliToggle()
    await mod.buttonToggle() // second press stops the normal session
    await handleResult({}, 'text')
    expect(calls).toEqual(['paste'])
  })
})
