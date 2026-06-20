import { vi, describe, it, expect, beforeEach } from 'vitest'

// --- Electron mocks ---
const mockRegister = vi.fn()
const mockUnregister = vi.fn()
const mockUnregisterAll = vi.fn()
const mockIsRegistered = vi.fn()
const mockIpcOn = vi.fn()
const mockIpcHandle = vi.fn()
const mockIpcRemoveListener = vi.fn()
const mockIpcRemoveHandler = vi.fn()

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
}
let mockSettings: MockSettings
const mockLoadSettings = vi.fn(() => mockSettings)

vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args)
}))

// --- Fresh module per test (resets module-level state) ---
type HotkeyModule = typeof import('../src/main/dictation/hotkeyManager')

const mockOverlayWebContents = { send: vi.fn() }
const mockOverlayWin = {
  isDestroyed: vi.fn(() => false),
  webContents: mockOverlayWebContents
}

describe('hotkeyManager', () => {
  let mod: HotkeyModule

  beforeEach(async () => {
    vi.clearAllMocks()

    // Default mock behaviors
    mockRegister.mockReturnValue(true)
    mockIsRegistered.mockReturnValue(false)
    mockGetOverlayWindow.mockReturnValue(mockOverlayWin)
    mockEnsureOverlayReady.mockResolvedValue(mockOverlayWin)
    mockAutoPaste.mockResolvedValue(undefined)
    mockOverlayWin.isDestroyed.mockReturnValue(false)

    // Default: no custom hotkeys configured (falls back to candidates)
    mockSettings = {
      dictationHotkey: '',
      dictateAndSendHotkey: '',
      outputRecordingHotkey: ''
    }

    // Fresh module — resets `state` and `activeHotkey`
    vi.resetModules()
    mod = await import('../src/main/dictation/hotkeyManager')
  })

  it('starts in idle state', () => {
    expect(mod.getState()).toBe('idle')
  })

  it('transitions idle -> recording -> transcribing', async () => {
    mod.registerHotkey()
    const activate = mockRegister.mock.calls[0][1] as () => Promise<void>

    await activate() // idle -> recording
    expect(mod.getState()).toBe('recording')

    await activate() // recording -> transcribing
    expect(mod.getState()).toBe('transcribing')
  })

  it('force-resets from transcribing state', async () => {
    mod.registerHotkey()
    const activate = mockRegister.mock.calls[0][1] as () => Promise<void>

    await activate() // -> recording
    await activate() // -> transcribing
    await activate() // -> idle (force reset)

    expect(mod.getState()).toBe('idle')
    expect(mockHideOverlay).toHaveBeenCalled()
  })

  it('force-resets from pasting state', async () => {
    mod.registerHotkey()
    const activate = mockRegister.mock.calls[0][1] as () => Promise<void>
    const handleResult = (
      mockIpcHandle.mock.calls.find((c) => c[0] === 'dictation:result') as unknown[]
    )[1] as (event: unknown, text: string) => Promise<void>

    await activate() // -> recording
    await activate() // -> transcribing

    // Make autoPaste hang so we stay in pasting
    let resolveAutoPaste!: () => void
    mockAutoPaste.mockImplementation(() => new Promise<void>((r) => (resolveAutoPaste = r)))

    const resultPromise = handleResult({}, 'text')
    // setState('pasting') runs synchronously before await autoPaste
    expect(mod.getState()).toBe('pasting')

    await activate() // -> idle (force reset)
    expect(mod.getState()).toBe('idle')

    resolveAutoPaste()
    await resultPromise
  })

  it('cancel returns to idle', async () => {
    mod.registerHotkey()
    const activate = mockRegister.mock.calls[0][1] as () => Promise<void>

    await activate() // -> recording
    expect(mod.getState()).toBe('recording')

    const cancelFn = (
      mockIpcOn.mock.calls.find((c) => c[0] === 'dictation:cancel') as unknown[]
    )[1] as () => void
    cancelFn()

    expect(mod.getState()).toBe('idle')
    expect(mockHideOverlay).toHaveBeenCalled()
  })

  it('empty text result goes to idle without paste', async () => {
    mod.registerHotkey()
    const activate = mockRegister.mock.calls[0][1] as () => Promise<void>
    const handleResult = (
      mockIpcHandle.mock.calls.find((c) => c[0] === 'dictation:result') as unknown[]
    )[1] as (event: unknown, text: string) => Promise<void>

    await activate() // -> recording
    await activate() // -> transcribing

    await handleResult({}, '')
    expect(mod.getState()).toBe('idle')
    expect(mockAutoPaste).not.toHaveBeenCalled()
  })

  it('text result triggers pasting -> autoPaste -> idle', async () => {
    mod.registerHotkey()
    const activate = mockRegister.mock.calls[0][1] as () => Promise<void>
    const handleResult = (
      mockIpcHandle.mock.calls.find((c) => c[0] === 'dictation:result') as unknown[]
    )[1] as (event: unknown, text: string) => Promise<void>

    await activate() // -> recording
    await activate() // -> transcribing

    await handleResult({}, 'Hello world')
    expect(mockAutoPaste).toHaveBeenCalledWith('Hello world')
    expect(mod.getState()).toBe('idle')
  })

  it('registerHotkey tries candidates in order until one succeeds', () => {
    mockRegister.mockReturnValueOnce(false).mockReturnValueOnce(true)

    mod.registerHotkey()

    expect(mockRegister).toHaveBeenCalledTimes(2)
    expect(mockRegister.mock.calls[0][0]).toBe('Ctrl+Shift+Space')
    expect(mockRegister.mock.calls[1][0]).toBe('Alt+Shift+Space')
    expect(mod.getActiveHotkey()).toBe('Alt+Shift+Space')
  })

  it('unregisterHotkey clears everything', () => {
    mod.registerHotkey()
    mod.unregisterHotkey()

    expect(mockUnregister).toHaveBeenCalledWith('Ctrl+Shift+Space')
    expect(mockIpcRemoveListener).toHaveBeenCalledWith('dictation:cancel', expect.any(Function))
    expect(mockIpcRemoveHandler).toHaveBeenCalledWith('dictation:result')
    expect(mod.getActiveHotkey()).toBeNull()
  })

  // --- registration: custom hotkeys & branches ---

  it('registers a custom dictation hotkey when configured', () => {
    mockSettings.dictationHotkey = 'Cmd+Shift+H'
    mod.registerHotkey()

    expect(mockRegister).toHaveBeenCalledWith('Cmd+Shift+H', expect.any(Function))
    expect(mod.getActiveHotkey()).toBe('Cmd+Shift+H')
  })

  it('falls back to candidates when custom dictation hotkey returns false', () => {
    mockSettings.dictationHotkey = 'Bad+Combo'
    // First call (custom) -> false, then candidate -> true
    mockRegister.mockReturnValueOnce(false).mockReturnValueOnce(true)

    mod.registerHotkey()

    expect(mockRegister.mock.calls[0][0]).toBe('Bad+Combo')
    expect(mockRegister.mock.calls[1][0]).toBe('Ctrl+Shift+Space')
    expect(mod.getActiveHotkey()).toBe('Ctrl+Shift+Space')
  })

  it('falls back to candidates when custom dictation hotkey throws', () => {
    mockSettings.dictationHotkey = 'Throws'
    mockRegister.mockImplementationOnce(() => {
      throw new Error('invalid accelerator')
    })

    mod.registerHotkey()

    // custom threw, then candidate registered
    expect(mockRegister.mock.calls[0][0]).toBe('Throws')
    expect(mod.getActiveHotkey()).toBe('Ctrl+Shift+Space')
  })

  it('registers dictate-and-send and output hotkeys when configured', () => {
    mockSettings.dictateAndSendHotkey = 'Cmd+Shift+S'
    mockSettings.outputRecordingHotkey = 'Cmd+Shift+O'

    mod.registerHotkey()

    expect(mockRegister).toHaveBeenCalledWith('Cmd+Shift+S', expect.any(Function))
    expect(mockRegister).toHaveBeenCalledWith('Cmd+Shift+O', expect.any(Function))
    expect(mod.getActiveSendHotkey()).toBe('Cmd+Shift+S')
  })

  it('warns but does not throw when send/output hotkeys fail to register', () => {
    mockSettings.dictateAndSendHotkey = 'Cmd+Shift+S'
    mockSettings.outputRecordingHotkey = 'Cmd+Shift+O'
    // candidate (true), send (false), output (false)
    mockRegister
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)

    mod.registerHotkey()

    expect(mod.getActiveSendHotkey()).toBeNull()
  })

  it('catches errors thrown while registering send/output hotkeys', () => {
    mockSettings.dictateAndSendHotkey = 'Cmd+Shift+S'
    mockSettings.outputRecordingHotkey = 'Cmd+Shift+O'
    // candidate ok, send throws, output throws
    mockRegister
      .mockReturnValueOnce(true)
      .mockImplementationOnce(() => {
        throw new Error('bad send')
      })
      .mockImplementationOnce(() => {
        throw new Error('bad output')
      })

    expect(() => mod.registerHotkey()).not.toThrow()
    expect(mod.getActiveSendHotkey()).toBeNull()
  })

  it('logs an error when all candidate hotkeys fail', () => {
    mockRegister.mockReturnValue(false)
    mod.registerHotkey()

    expect(mockRegister).toHaveBeenCalledTimes(3)
    expect(mod.getActiveHotkey()).toBeNull()
  })

  // --- activate edge cases ---

  it('does nothing when overlay is not ready on activate', async () => {
    mockEnsureOverlayReady.mockResolvedValueOnce(null)
    mod.registerHotkey()
    const activate = mockRegister.mock.calls[0][1] as () => Promise<void>

    await activate()

    expect(mod.getState()).toBe('idle')
    expect(mockShowOverlay).not.toHaveBeenCalled()
  })

  it('recovers to idle when activate throws', async () => {
    mockEnsureOverlayReady.mockRejectedValueOnce(new Error('boom'))
    mod.registerHotkey()
    const activate = mockRegister.mock.calls[0][1] as () => Promise<void>

    await activate()

    expect(mod.getState()).toBe('idle')
    expect(mockHideOverlay).toHaveBeenCalled()
  })

  it('registers Escape cancel shortcut when recording starts', async () => {
    mod.registerHotkey()
    const activate = mockRegister.mock.calls[0][1] as () => Promise<void>
    mockRegister.mockClear()

    await activate() // -> recording

    expect(mockRegister).toHaveBeenCalledWith('Escape', expect.any(Function))
  })

  it('does not re-register Escape when already registered', async () => {
    mockIsRegistered.mockReturnValue(true) // Escape already registered
    mod.registerHotkey()
    const activate = mockRegister.mock.calls[0][1] as () => Promise<void>
    mockRegister.mockClear()

    await activate() // -> recording

    expect(mockRegister).not.toHaveBeenCalledWith('Escape', expect.any(Function))
  })

  // --- dictate-and-send flow ---

  it('activateAndSend sends Enter after paste', async () => {
    vi.useFakeTimers()
    mockSettings.dictateAndSendHotkey = 'Cmd+Shift+S'
    mod.registerHotkey()

    const sendCall = mockRegister.mock.calls.find((c) => c[0] === 'Cmd+Shift+S') as unknown[]
    const activateAndSend = sendCall[1] as () => Promise<void>
    const handleResult = (
      mockIpcHandle.mock.calls.find((c) => c[0] === 'dictation:result') as unknown[]
    )[1] as (event: unknown, text: string) => Promise<void>

    await activateAndSend() // -> recording
    await activateAndSend() // -> transcribing

    const resultPromise = handleResult({}, 'send me')
    // flush the 100ms delay before Enter
    await vi.runAllTimersAsync()
    await resultPromise

    expect(mockAutoPaste).toHaveBeenCalledWith('send me')
    expect(mockSendEnter).toHaveBeenCalled()
    expect(mod.getState()).toBe('idle')
    vi.useRealTimers()
  })

  it('does not send Enter for a normal dictation result', async () => {
    mod.registerHotkey()
    const activate = mockRegister.mock.calls[0][1] as () => Promise<void>
    const handleResult = (
      mockIpcHandle.mock.calls.find((c) => c[0] === 'dictation:result') as unknown[]
    )[1] as (event: unknown, text: string) => Promise<void>

    await activate() // -> recording
    await activate() // -> transcribing
    await handleResult({}, 'plain text')

    expect(mockSendEnter).not.toHaveBeenCalled()
  })

  it('handleResult swallows autoPaste errors and returns to idle', async () => {
    mockAutoPaste.mockRejectedValueOnce(new Error('paste failed'))
    mod.registerHotkey()
    const activate = mockRegister.mock.calls[0][1] as () => Promise<void>
    const handleResult = (
      mockIpcHandle.mock.calls.find((c) => c[0] === 'dictation:result') as unknown[]
    )[1] as (event: unknown, text: string) => Promise<void>

    await activate() // -> recording
    await activate() // -> transcribing
    await handleResult({}, 'will fail')

    expect(mod.getState()).toBe('idle')
  })

  // --- output recording flow ---

  it('activateOutput drives recording -> transcribing and force-reset', async () => {
    mockSettings.outputRecordingHotkey = 'Cmd+Shift+O'
    mod.registerHotkey()
    const outCall = mockRegister.mock.calls.find((c) => c[0] === 'Cmd+Shift+O') as unknown[]
    const activateOutput = outCall[1] as () => Promise<void>

    await activateOutput() // -> recording
    expect(mod.getState()).toBe('recording')
    expect(mockSendToPrimaryOverlay).toHaveBeenCalledWith('dictation:activate-output')

    await activateOutput() // -> transcribing
    expect(mod.getState()).toBe('transcribing')
    expect(mockSendToPrimaryOverlay).toHaveBeenCalledWith('dictation:deactivate')

    await activateOutput() // -> idle (force reset from transcribing)
    expect(mod.getState()).toBe('idle')
    expect(mockHideOverlay).toHaveBeenCalled()
  })

  it('activateOutput does nothing when overlay not ready', async () => {
    mockSettings.outputRecordingHotkey = 'Cmd+Shift+O'
    mockEnsureOverlayReady.mockResolvedValueOnce(null)
    mod.registerHotkey()
    const outCall = mockRegister.mock.calls.find((c) => c[0] === 'Cmd+Shift+O') as unknown[]
    const activateOutput = outCall[1] as () => Promise<void>

    await activateOutput()
    expect(mod.getState()).toBe('idle')
  })

  it('activateOutput recovers to idle when it throws', async () => {
    mockSettings.outputRecordingHotkey = 'Cmd+Shift+O'
    mockEnsureOverlayReady.mockRejectedValueOnce(new Error('boom'))
    mod.registerHotkey()
    const outCall = mockRegister.mock.calls.find((c) => c[0] === 'Cmd+Shift+O') as unknown[]
    const activateOutput = outCall[1] as () => Promise<void>

    await activateOutput()
    expect(mod.getState()).toBe('idle')
    expect(mockHideOverlay).toHaveBeenCalled()
  })

  // --- Escape cancel during recording ---

  it('Escape cancel during recording unregisters Escape and resets', async () => {
    mod.registerHotkey()
    const activate = mockRegister.mock.calls[0][1] as () => Promise<void>
    await activate() // -> recording

    // The cancel handler registered for Escape
    const escCall = mockRegister.mock.calls.find((c) => c[0] === 'Escape') as unknown[]
    const cancelFn = escCall[1] as () => void

    mockIsRegistered.mockReturnValue(true) // Escape is registered
    cancelFn()

    expect(mockUnregister).toHaveBeenCalledWith('Escape')
    expect(mockSendToPrimaryOverlay).toHaveBeenCalledWith('dictation:cancel')
    expect(mod.getState()).toBe('idle')
  })

  // --- transcribe safety timeout ---

  it('transcribe timeout force-resets to idle after 60s', async () => {
    vi.useFakeTimers()
    mod.registerHotkey()
    const activate = mockRegister.mock.calls[0][1] as () => Promise<void>

    await activate() // -> recording
    await activate() // -> transcribing
    expect(mod.getState()).toBe('transcribing')

    await vi.advanceTimersByTimeAsync(60_000)

    expect(mod.getState()).toBe('idle')
    expect(mockHideOverlay).toHaveBeenCalled()
    expect(mockRestoreTargetWindow).toHaveBeenCalled()
    vi.useRealTimers()
  })

  // --- pause / resume / re-register ---

  it('pauseHotkeys unregisters all active hotkeys', () => {
    mockSettings.dictationHotkey = 'A'
    mockSettings.dictateAndSendHotkey = 'B'
    mockSettings.outputRecordingHotkey = 'C'
    mod.registerHotkey()
    mockUnregister.mockClear()

    mod.pauseHotkeys()

    expect(mockUnregister).toHaveBeenCalledWith('A')
    expect(mockUnregister).toHaveBeenCalledWith('B')
    expect(mockUnregister).toHaveBeenCalledWith('C')
  })

  it('resumeHotkeys re-registers all active hotkeys', () => {
    mockSettings.dictationHotkey = 'A'
    mockSettings.dictateAndSendHotkey = 'B'
    mockSettings.outputRecordingHotkey = 'C'
    mod.registerHotkey()
    mockRegister.mockClear()

    mod.resumeHotkeys()

    expect(mockRegister).toHaveBeenCalledWith('A', expect.any(Function))
    expect(mockRegister).toHaveBeenCalledWith('B', expect.any(Function))
    expect(mockRegister).toHaveBeenCalledWith('C', expect.any(Function))
  })

  it('reRegisterHotkeys unregisters then registers again', () => {
    mod.registerHotkey()
    mockUnregisterAll.mockClear()

    mod.reRegisterHotkeys()

    // unregisterHotkey removed the ipc handler, registerHotkey re-added it
    expect(mockUnregisterAll).toHaveBeenCalled()
    expect(mockIpcRemoveHandler).toHaveBeenCalledWith('dictation:result')
    expect(mod.getActiveHotkey()).toBe('Ctrl+Shift+Space')
  })

  it('unregisterHotkey clears send and output hotkeys too', () => {
    mockSettings.dictateAndSendHotkey = 'B'
    mockSettings.outputRecordingHotkey = 'C'
    mod.registerHotkey()
    mod.unregisterHotkey()

    expect(mockUnregister).toHaveBeenCalledWith('B')
    expect(mockUnregister).toHaveBeenCalledWith('C')
    expect(mod.getActiveSendHotkey()).toBeNull()
  })
})
