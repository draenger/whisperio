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

vi.mock('../src/main/dictation/autoPaste', () => ({
  autoPaste: (...args: unknown[]) => mockAutoPaste(...args),
  captureTargetWindow: (...args: unknown[]) => mockCaptureTargetWindow(...args),
  restoreTargetWindow: (...args: unknown[]) => mockRestoreTargetWindow(...args)
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
})
