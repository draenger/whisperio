import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// --- Electron mocks ---
const mockRegister = vi.fn()
const mockUnregister = vi.fn()
const mockUnregisterAll = vi.fn()
const mockIsRegistered = vi.fn()
const mockIpcOn = vi.fn()
const mockIpcHandle = vi.fn()
const mockIpcRemoveListener = vi.fn()
const mockIpcRemoveHandler = vi.fn()

const mockClipboardReadText = vi.fn(() => '')

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData')
  },
  globalShortcut: {
    register: (...args: unknown[]) => mockRegister(...args),
    unregister: (...args: unknown[]) => mockUnregister(...args),
    unregisterAll: (...args: unknown[]) => mockUnregisterAll(...args),
    isRegistered: (...args: unknown[]) => mockIsRegistered(...args)
  },
  ipcMain: {
    on: (...args: unknown[]) => mockIpcOn(...args),
    handle: (...args: unknown[]) => mockIpcHandle(...args),
    removeListener: (...args: unknown[]) => mockIpcRemoveListener(...args),
    removeHandler: (...args: unknown[]) => mockIpcRemoveHandler(...args)
  },
  clipboard: {
    readText: (...args: unknown[]) => mockClipboardReadText(...args)
  },
  Notification: class MockNotification {
    static isSupported = vi.fn(() => false)
    show = vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  }
}))

// --- fs mock (needed by settingsManager, transitively imported) ---
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn()
}))

// --- Overlay mocks ---
const mockShowOverlay = vi.fn()
const mockHideOverlay = vi.fn()
const mockGetOverlayWindow = vi.fn()
const mockEnsureOverlayReady = vi.fn()
const mockBroadcastToOverlays = vi.fn()
const mockSendToPrimaryOverlay = vi.fn()

vi.mock('../src/main/dictation/overlayWindow', () => ({
  showOverlay: (...args: unknown[]) => mockShowOverlay(...args),
  hideOverlay: (...args: unknown[]) => mockHideOverlay(...args),
  getOverlayWindow: (...args: unknown[]) => mockGetOverlayWindow(...args),
  ensureOverlayReady: (...args: unknown[]) => mockEnsureOverlayReady(...args),
  broadcastToOverlays: (...args: unknown[]) => mockBroadcastToOverlays(...args),
  sendToPrimaryOverlay: (...args: unknown[]) => mockSendToPrimaryOverlay(...args)
}))

// --- AutoPaste mocks ---
const mockAutoPaste = vi.fn()
const mockCaptureTargetWindow = vi.fn()
const mockRestoreTargetWindow = vi.fn()
const mockSendEnter = vi.fn()

vi.mock('../src/main/dictation/autoPaste', () => ({
  autoPaste: (...args: unknown[]) => mockAutoPaste(...args),
  captureTargetWindow: (...args: unknown[]) => mockCaptureTargetWindow(...args),
  restoreTargetWindow: (...args: unknown[]) => mockRestoreTargetWindow(...args),
  sendEnter: (...args: unknown[]) => mockSendEnter(...args)
}))

// --- settingsManager mock (configurable per test) ---
interface MockSettings {
  dictationHotkey: string
  dictateAndSendHotkey: string
  outputRecordingHotkey: string
  commandHotkey: string
  hotkeyMode?: 'toggle' | 'hold'
}
let mockSettings: MockSettings
const mockLoadSettings = vi.fn(() => mockSettings)

vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args)
}))

// --- COMMAND mode mocks (transcribe.ts's rewrite entrypoint + error surfacing) ---
const mockRewriteClipboardForCommand = vi.fn()

vi.mock('../src/main/transcribe', () => ({
  rewriteClipboardForCommand: (...args: unknown[]) => mockRewriteClipboardForCommand(...args)
}))

const mockHandleCommandError = vi.fn()
const mockNotifyInfo = vi.fn()

vi.mock('../src/main/errorHandler', () => ({
  notifyInfo: (...args: unknown[]) => mockNotifyInfo(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args)
}))

// --- keyHold mock (hold-to-talk release watcher) ---
const mockWatchKeyRelease = vi.fn()

vi.mock('../src/main/dictation/keyHold', () => ({
  watchKeyRelease: (...args: unknown[]) => mockWatchKeyRelease(...args),
  setKeyHoldNotifier: vi.fn()
}))

// --- Fresh module per test (resets module-level state) ---
type HotkeyModule = typeof import('../src/main/dictation/hotkeyManager')

const mockOverlayWebContents = { send: vi.fn() }
const mockOverlayWin = {
  isDestroyed: vi.fn(() => false),
  webContents: mockOverlayWebContents
}

// Edge / fail-soft branches of hotkeyManager.ts not reached by
// hotkeyManager.test.ts: watchdog firing after a catch-block reset, hold-mode
// fallback guards, "hotkey" placeholder when the accelerator never registered,
// output/command hotkeys pressed while another mode is in progress, command
// mode overlay/exception recovery, silent-recording notice, non-Error command
// failures, and command-hotkey registration failures. (The mock preamble above
// is copied verbatim from hotkeyManager.test.ts.)

type Fn = (...args: unknown[]) => Promise<void> | void
const registered = (accel: string): Fn =>
  (mockRegister.mock.calls.find((c) => c[0] === accel) as unknown[])[1] as Fn
const resultHandler = (): ((e: unknown, text: string, sid?: number, reason?: 'silent') => Promise<void>) =>
  (mockIpcHandle.mock.calls.find((c) => c[0] === 'dictation:result') as unknown[])[1] as never
const lastOverlayInfo = (): Record<string, unknown> =>
  mockBroadcastToOverlays.mock.calls.filter((c) => c[0] === 'dictation:overlay-info').at(-1)![1] as never

describe('hotkeyManager edge branches', () => {
  let mod: HotkeyModule

  beforeEach(async () => {
    vi.clearAllMocks()
    mockRegister.mockReturnValue(true)
    mockIsRegistered.mockReturnValue(false)
    mockGetOverlayWindow.mockReturnValue(mockOverlayWin)
    mockEnsureOverlayReady.mockResolvedValue(mockOverlayWin)
    mockAutoPaste.mockResolvedValue(undefined)
    mockSendToPrimaryOverlay.mockReset()
    mockSettings = {
      dictationHotkey: '',
      dictateAndSendHotkey: '',
      outputRecordingHotkey: 'F9',
      commandHotkey: 'F10'
    }
    mockClipboardReadText.mockReturnValue('')
    mockRewriteClipboardForCommand.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.resetModules()
    mod = await import('../src/main/dictation/hotkeyManager')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('a watchdog left armed by a catch-block reset fires harmlessly (no notice, stays idle)', async () => {
    vi.useFakeTimers()
    mod.registerHotkey()
    const activate = registered('Ctrl+Shift+Space')
    await activate() // -> recording
    // The deactivate send throws AFTER setState('transcribing') armed the
    // watchdog; the catch resets `state` directly without stopping it.
    mockSendToPrimaryOverlay.mockImplementation((ch: string) => {
      if (ch === 'dictation:deactivate') throw new Error('overlay gone')
    })
    await activate()
    expect(mod.getState()).toBe('idle')

    await vi.advanceTimersByTimeAsync(60_000)
    expect(mockNotifyInfo).not.toHaveBeenCalled()
    expect(mod.getState()).toBe('idle')
  })

  describe('hold-mode fallback', () => {
    let fallback: () => void
    beforeEach(() => {
      mockSettings.hotkeyMode = 'hold'
      mockWatchKeyRelease.mockImplementation(
        (_a: string, _cb: () => void, opts?: { onFallback?: () => void }) => {
          fallback = opts?.onFallback ?? (() => {})
          return vi.fn()
        }
      )
    })

    it('ignores a fallback that arrives after the session was cancelled', async () => {
      mod.registerHotkey()
      await registered('Ctrl+Shift+Space')()
      mod.cliCancel()
      mockBroadcastToOverlays.mockClear()
      fallback()
      expect(mockBroadcastToOverlays).not.toHaveBeenCalledWith('dictation:overlay-info', expect.anything())
    })

    it('uses a "hotkey" placeholder when the main dictation hotkey never registered', async () => {
      // All dictation candidates fail; only dictate-and-send registers.
      mockSettings.dictateAndSendHotkey = 'F8'
      mockRegister.mockImplementation((accel: string) => accel === 'F8')
      mod.registerHotkey()
      await registered('F8')() // -> recording via send hotkey (hold watch on F8)
      fallback()
      expect(lastOverlayInfo()).toEqual(expect.objectContaining({ stopHotkey: 'hotkey', hold: false }))
    })
  })

  describe('activateOutput', () => {
    it('uses a "hotkey" placeholder when the output hotkey failed to register', async () => {
      mockRegister.mockImplementation((accel: string) => accel !== 'F9')
      mod.registerHotkey()
      await registered('F9')()
      expect(mod.getState()).toBe('recording')
      expect(lastOverlayInfo()).toEqual(expect.objectContaining({ stopHotkey: 'hotkey', recordingType: 'output' }))
    })

    it('force-resets a command session in progress', async () => {
      mod.registerHotkey()
      await registered('F10')() // -> command
      expect(mod.getState()).toBe('command')
      await registered('F9')()
      expect(mod.getState()).toBe('idle')
      expect(mockRestoreTargetWindow).toHaveBeenCalled()
    })

    it('force-resets a stuck pasting state', async () => {
      mod.registerHotkey()
      const activate = registered('Ctrl+Shift+Space')
      await activate()
      await activate()
      let release!: () => void
      mockAutoPaste.mockImplementation(() => new Promise<void>((r) => (release = r)))
      const sid = mockSendToPrimaryOverlay.mock.calls.find((c) => c[0] === 'dictation:deactivate')![1] as number
      const pending = resultHandler()({}, 'text', sid)
      await Promise.resolve()
      expect(mod.getState()).toBe('pasting')
      await registered('F9')()
      expect(mod.getState()).toBe('idle')
      release()
      await pending
    })
  })

  describe('activateCommand', () => {
    it('stays idle and logs when the overlay is unavailable', async () => {
      mockEnsureOverlayReady.mockResolvedValue(null)
      mod.registerHotkey()
      await registered('F10')()
      expect(mod.getState()).toBe('idle')
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('cannot activate command mode'))
      expect(mockShowOverlay).not.toHaveBeenCalled()
    })

    it('recovers to idle when activation throws', async () => {
      mockEnsureOverlayReady.mockRejectedValue(new Error('window crashed'))
      mod.registerHotkey()
      await registered('F10')()
      expect(mod.getState()).toBe('idle')
      expect(mockHideOverlay).toHaveBeenCalled()
      // A later normal dictation is a plain one, not a stale command session.
      mockEnsureOverlayReady.mockResolvedValue(mockOverlayWin)
      const activate = registered('Ctrl+Shift+Space')
      await activate()
      await activate()
      const sid = mockSendToPrimaryOverlay.mock.calls.filter((c) => c[0] === 'dictation:deactivate').at(-1)![1] as number
      await resultHandler()({}, 'spoken', sid)
      expect(mockAutoPaste).toHaveBeenCalledWith('spoken')
      expect(mockRewriteClipboardForCommand).not.toHaveBeenCalled()
    })

    it('uses a "hotkey" placeholder when the command hotkey failed to register', async () => {
      mockRegister.mockImplementation((accel: string) => accel !== 'F10')
      mod.registerHotkey()
      await registered('F10')()
      expect(lastOverlayInfo()).toEqual(expect.objectContaining({ stopHotkey: 'hotkey' }))
    })

    it.each(['recording', 'transcribing'] as const)('force-resets a %s dictation', async (target) => {
      mod.registerHotkey()
      const activate = registered('Ctrl+Shift+Space')
      await activate()
      if (target === 'transcribing') await activate()
      expect(mod.getState()).toBe(target)
      await registered('F10')()
      expect(mod.getState()).toBe('idle')
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('(command hotkey)'))
    })

    it('cliStop ends a command recording (-> transcribing)', async () => {
      mod.registerHotkey()
      await registered('F10')()
      await mod.cliStop()
      expect(mod.getState()).toBe('transcribing')
    })

    it('wraps a non-Error rewrite rejection before surfacing it', async () => {
      mod.registerHotkey()
      const cmd = registered('F10')
      await cmd()
      await cmd()
      mockClipboardReadText.mockReturnValue('some text')
      mockRewriteClipboardForCommand.mockRejectedValue('llm exploded')
      const sid = mockSendToPrimaryOverlay.mock.calls.filter((c) => c[0] === 'dictation:deactivate').at(-1)![1] as number
      await resultHandler()({}, 'make it formal', sid)
      expect(mockHandleCommandError).toHaveBeenCalledWith(expect.objectContaining({ message: 'llm exploded' }))
      expect(mockAutoPaste).not.toHaveBeenCalled()
      expect(mod.getState()).toBe('idle')
    })
  })

  describe('silent / empty results', () => {
    async function transcribingSid(): Promise<number> {
      mod.registerHotkey()
      const activate = registered('Ctrl+Shift+Space')
      await activate()
      await activate()
      return mockSendToPrimaryOverlay.mock.calls.find((c) => c[0] === 'dictation:deactivate')![1] as number
    }

    it('tells the user when the recording was silent', async () => {
      const sid = await transcribingSid()
      await resultHandler()({}, '', sid, 'silent')
      expect(mockNotifyInfo).toHaveBeenCalledWith('Whisperio', 'Nothing heard — recording was silent')
      expect(mod.getState()).toBe('idle')
      expect(mockAutoPaste).not.toHaveBeenCalled()
    })

    it('stays quiet for a whitespace-only result without the silent reason', async () => {
      const sid = await transcribingSid()
      await resultHandler()({}, '   ', sid)
      expect(mockNotifyInfo).not.toHaveBeenCalled()
      expect(mod.getState()).toBe('idle')
    })
  })

  describe('command hotkey registration', () => {
    it('warns (and does not unregister it later) when registration returns false', () => {
      mockRegister.mockImplementation((accel: string) => accel !== 'F10')
      mod.registerHotkey()
      expect(console.warn).toHaveBeenCalledWith('[Whisperio] Command hotkey F10 failed to register')
      mod.unregisterHotkey()
      expect(mockUnregister).not.toHaveBeenCalledWith('F10')
    })

    it('logs and continues when the accelerator is invalid', () => {
      mockRegister.mockImplementation((accel: string) => {
        if (accel === 'F10') throw new Error('bad accelerator')
        return true
      })
      expect(() => mod.registerHotkey()).not.toThrow()
      expect(console.error).toHaveBeenCalledWith('[Whisperio] Invalid command hotkey "F10":', expect.any(Error))
      // IPC wiring still happens after the failure.
      expect(mockIpcHandle).toHaveBeenCalledWith('dictation:result', expect.any(Function))
    })
  })

  describe('CLI no-ops', () => {
    it('cliStart is ignored when not idle and cliCancel is ignored when idle', async () => {
      mod.cliCancel()
      expect(mockSendToPrimaryOverlay).not.toHaveBeenCalledWith('dictation:cancel')
      mod.registerHotkey()
      await mod.cliStart()
      expect(mod.getState()).toBe('recording')
      await mod.cliStart()
      expect(mod.getState()).toBe('recording')
      await mod.cliStop()
      expect(mod.getState()).toBe('transcribing')
      await mod.cliStop() // not recording/command: no-op
      expect(mod.getState()).toBe('transcribing')
    })
  })
})
