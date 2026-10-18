import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// --- Hoisted mock state (shared with vi.mock factories, reset per test) ---
const h = vi.hoisted(() => {
  // electron-updater handler map: event name -> handler(s)
  const handlers = new Map<string, (...args: unknown[]) => void>()

  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    isUpdaterActive: vi.fn(() => true),
    checkForUpdates: vi.fn(() => Promise.resolve()),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers.set(event, cb)
      return autoUpdater
    })
  }

  // Fire a registered updater event by name.
  const fire = (event: string, ...args: unknown[]): void => {
    const cb = handlers.get(event)
    if (!cb) throw new Error(`No handler registered for event "${event}"`)
    cb(...args)
  }

  const mockNotificationShow = vi.fn()
  const mockNotificationIsSupported = vi.fn(() => false)
  const mockWebContentsSend = vi.fn()
  const mockIsDestroyed = vi.fn(() => false)
  const mockGetAllWindows = vi.fn<[], unknown[]>(() => [])
  const mockSetUpdateReady = vi.fn()

  return {
    handlers,
    autoUpdater,
    fire,
    mockNotificationShow,
    mockNotificationIsSupported,
    mockWebContentsSend,
    mockIsDestroyed,
    mockGetAllWindows,
    mockSetUpdateReady
  }
})

vi.mock('electron-updater', () => ({
  autoUpdater: h.autoUpdater
}))

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.2.6')
  },
  BrowserWindow: {
    getAllWindows: () => h.mockGetAllWindows()
  },
  Notification: class MockNotification {
    static isSupported = h.mockNotificationIsSupported
    constructor(opts: { title: string; body: string }) {
      h.mockNotificationShow(opts)
    }
    show = vi.fn()
  }
}))

vi.mock('../src/main/tray', () => ({
  setUpdateReady: h.mockSetUpdateReady
}))

// A fake window whose webContents.send / isDestroyed are spies, so we can assert
// broadcasts without a real BrowserWindow.
function fakeWindow(): { webContents: { send: typeof h.mockWebContentsSend }; isDestroyed: typeof h.mockIsDestroyed } {
  return {
    webContents: { send: h.mockWebContentsSend },
    isDestroyed: h.mockIsDestroyed
  }
}

// Fresh module import — the module keeps singleton state, so each test must
// re-import after resetModules to avoid leakage.
async function loadModule(): Promise<typeof import('../src/main/autoUpdater')> {
  return import('../src/main/autoUpdater')
}

describe('autoUpdater', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()

    // Reset the electron-updater mock to defaults + clear the handler map so each
    // import re-registers fresh handlers.
    h.handlers.clear()
    h.autoUpdater.autoDownload = false
    h.autoUpdater.autoInstallOnAppQuit = false
    h.autoUpdater.isUpdaterActive.mockReset().mockReturnValue(true)
    h.autoUpdater.checkForUpdates.mockReset().mockResolvedValue(undefined)
    h.autoUpdater.quitAndInstall.mockReset()
    h.autoUpdater.on.mockClear()

    h.mockNotificationShow.mockReset()
    h.mockNotificationIsSupported.mockReset().mockReturnValue(false)
    h.mockWebContentsSend.mockReset()
    h.mockIsDestroyed.mockReset().mockReturnValue(false)
    h.mockGetAllWindows.mockReset().mockReturnValue([])
    h.mockSetUpdateReady.mockReset()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  describe('getUpdateState', () => {
    it('starts idle with currentVersion from app.getVersion()', async () => {
      const { getUpdateState } = await loadModule()
      const state = getUpdateState()
      expect(state.status).toBe('idle')
      expect(state.currentVersion).toBe('1.2.6')
    })
  })

  describe('checkForUpdatesManual', () => {
    it('returns without changing state when updater is not active', async () => {
      h.autoUpdater.isUpdaterActive.mockReturnValue(false)
      const { checkForUpdatesManual, getUpdateState } = await loadModule()

      checkForUpdatesManual()

      expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
      expect(getUpdateState().status).toBe('idle')
    })

    it('sets status checking then triggers checkForUpdates when active', async () => {
      const { checkForUpdatesManual, getUpdateState } = await loadModule()

      checkForUpdatesManual()

      expect(getUpdateState().status).toBe('checking')
      expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    })

    it('fails soft on checkForUpdates rejection -> not-available, no raw error surfaced', async () => {
      h.autoUpdater.checkForUpdates.mockRejectedValue(new Error('404 missing artifact'))
      const { checkForUpdatesManual, getUpdateState } = await loadModule()

      checkForUpdatesManual()
      // Let the rejected promise's .catch run.
      await vi.waitFor(() => expect(getUpdateState().status).toBe('not-available'))

      const state = getUpdateState()
      expect(state.status).not.toBe('error')
      expect(state.error).toBeUndefined()
    })
  })

  describe('installUpdate', () => {
    it('returns false when status is not downloaded', async () => {
      const { installUpdate } = await loadModule()
      expect(installUpdate()).toBe(false)
      expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    })

    it('quits and installs when status is downloaded', async () => {
      const { initAutoUpdater, installUpdate, getUpdateState } = await loadModule()
      initAutoUpdater()
      h.fire('update-downloaded', { version: '1.3.0' })
      expect(getUpdateState().status).toBe('downloaded')

      expect(installUpdate()).toBe(true)
      expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
    })
  })

  describe('update signature verification (win32)', () => {
    it('installs the pinned Authenticode verifier on win32 only', async () => {
      const orig = Object.getOwnPropertyDescriptor(process, 'platform')!
      const au = h.autoUpdater as Record<string, unknown>
      try {
        for (const [platform, expected] of [['win32', true], ['linux', false]] as const) {
          Object.defineProperty(process, 'platform', { value: platform })
          vi.resetModules()
          au.verifyUpdateCodeSignature = undefined
          au.verifySignature = undefined
          const { initAutoUpdater } = await loadModule()
          initAutoUpdater(false)
          expect(typeof au.verifyUpdateCodeSignature === 'function').toBe(expected)
          expect(typeof au.verifySignature === 'function').toBe(expected)
        }
      } finally {
        Object.defineProperty(process, 'platform', orig)
        delete au.verifyUpdateCodeSignature
        delete au.verifySignature
      }
    })
  })

  describe('update-check gating (checkForUpdates setting)', () => {
    const TEN_S = 10_000
    const FOUR_H = 4 * 60 * 60 * 1000

    it('schedules no initial check and no interval when disabled', async () => {
      const { initAutoUpdater } = await loadModule()
      initAutoUpdater(false)
      vi.advanceTimersByTime(TEN_S + 2 * FOUR_H)
      expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    })

    it('runs initial + interval checks when enabled (default)', async () => {
      const { initAutoUpdater } = await loadModule()
      initAutoUpdater()
      vi.advanceTimersByTime(TEN_S)
      expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(FOUR_H)
      expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    })

    it('stops the interval when toggled off at runtime', async () => {
      const { initAutoUpdater, setUpdateChecksEnabled } = await loadModule()
      initAutoUpdater(true)
      vi.advanceTimersByTime(TEN_S)
      expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
      setUpdateChecksEnabled(false)
      vi.advanceTimersByTime(3 * FOUR_H)
      expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    })

    it('cancels the pending initial check if toggled off before it fires', async () => {
      const { initAutoUpdater, setUpdateChecksEnabled } = await loadModule()
      initAutoUpdater(true)
      setUpdateChecksEnabled(false)
      vi.advanceTimersByTime(TEN_S + FOUR_H)
      expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    })

    it('starts the schedule when toggled on at runtime after starting disabled', async () => {
      const { initAutoUpdater, setUpdateChecksEnabled } = await loadModule()
      initAutoUpdater(false)
      setUpdateChecksEnabled(true)
      vi.advanceTimersByTime(TEN_S)
      expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(FOUR_H)
      expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    })

    it('does not double-schedule on repeated enable', async () => {
      const { initAutoUpdater, setUpdateChecksEnabled } = await loadModule()
      initAutoUpdater(true)
      setUpdateChecksEnabled(true)
      vi.advanceTimersByTime(TEN_S)
      expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    })
  })

  describe('initAutoUpdater', () => {
    it('returns early when updater is not active', async () => {
      h.autoUpdater.isUpdaterActive.mockReturnValue(false)
      const { initAutoUpdater } = await loadModule()

      initAutoUpdater()

      expect(h.autoUpdater.on).not.toHaveBeenCalled()
      expect(h.autoUpdater.autoDownload).toBe(false)
      expect(h.autoUpdater.autoInstallOnAppQuit).toBe(false)
    })

    it('configures autoDownload / autoInstallOnAppQuit and registers handlers', async () => {
      const { initAutoUpdater } = await loadModule()

      initAutoUpdater()

      expect(h.autoUpdater.autoDownload).toBe(true)
      // vitest runs on win32/linux/darwin: only macOS (signed+notarized) may install on quit
      expect(h.autoUpdater.autoInstallOnAppQuit).toBe(process.platform === 'darwin')
      for (const event of [
        'checking-for-update',
        'update-not-available',
        'update-available',
        'download-progress',
        'update-downloaded',
        'error'
      ]) {
        expect(h.handlers.has(event)).toBe(true)
      }
    })

    it("'checking-for-update' -> status checking", async () => {
      const { initAutoUpdater, getUpdateState } = await loadModule()
      initAutoUpdater()

      h.fire('checking-for-update')

      expect(getUpdateState().status).toBe('checking')
    })

    it("'update-available' -> status available, version set, notification attempted", async () => {
      const { initAutoUpdater, getUpdateState } = await loadModule()
      initAutoUpdater()

      h.fire('update-available', { version: '2.0.0' })

      const state = getUpdateState()
      expect(state.status).toBe('available')
      expect(state.version).toBe('2.0.0')
      expect(state.percent).toBe(0)
      // isSupported() is false, so Notification ctor never runs (no native throw).
      expect(h.mockNotificationIsSupported).toHaveBeenCalled()
      expect(h.mockNotificationShow).not.toHaveBeenCalled()
    })

    it("'update-available' shows a Notification when supported", async () => {
      h.mockNotificationIsSupported.mockReturnValue(true)
      const { initAutoUpdater } = await loadModule()
      initAutoUpdater()

      h.fire('update-available', { version: '2.0.0' })

      expect(h.mockNotificationShow).toHaveBeenCalledWith({
        title: 'Whisperio Update',
        body: 'Version 2.0.0 is downloading...'
      })
    })

    it("'download-progress' -> status downloading with rounded percent", async () => {
      const { initAutoUpdater, getUpdateState } = await loadModule()
      initAutoUpdater()

      h.fire('download-progress', { percent: 42.7, bytesPerSecond: 1024 })

      const state = getUpdateState()
      expect(state.status).toBe('downloading')
      expect(state.percent).toBe(43)
      expect(state.bytesPerSecond).toBe(1024)
    })

    it("'update-downloaded' -> downloaded, percent 100, setUpdateReady, legacy send", async () => {
      const win = fakeWindow()
      h.mockGetAllWindows.mockReturnValue([win])
      const { initAutoUpdater, getUpdateState } = await loadModule()
      initAutoUpdater()

      h.fire('update-downloaded', { version: '3.1.4' })

      const state = getUpdateState()
      expect(state.status).toBe('downloaded')
      expect(state.version).toBe('3.1.4')
      expect(state.percent).toBe(100)
      expect(h.mockSetUpdateReady).toHaveBeenCalledWith('3.1.4', expect.any(Function))
      // Legacy 'updater:ready' channel.
      expect(h.mockWebContentsSend).toHaveBeenCalledWith('updater:ready', '3.1.4')
      // Status broadcast also reaches the window.
      expect(h.mockWebContentsSend).toHaveBeenCalledWith('updater:status', expect.objectContaining({ status: 'downloaded' }))
    })

    it("'update-downloaded' shows a Notification when supported", async () => {
      h.mockNotificationIsSupported.mockReturnValue(true)
      const { initAutoUpdater } = await loadModule()
      initAutoUpdater()

      h.fire('update-downloaded', { version: '3.1.4' })

      expect(h.mockNotificationShow).toHaveBeenCalledWith({
        title: 'Whisperio Update Ready',
        body: 'Version 3.1.4 is ready — restart Whisperio to install.'
      })
    })

    it("'update-downloaded' setUpdateReady callback triggers installUpdate", async () => {
      const { initAutoUpdater } = await loadModule()
      initAutoUpdater()

      h.fire('update-downloaded', { version: '3.1.4' })

      // Invoke the callback handed to setUpdateReady -> should call quitAndInstall.
      const cb = h.mockSetUpdateReady.mock.calls[0][1] as () => void
      cb()
      expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
    })

    it("'update-not-available' -> status not-available", async () => {
      const { initAutoUpdater, getUpdateState } = await loadModule()
      initAutoUpdater()

      h.fire('update-available', { version: '2.0.0' })
      h.fire('update-not-available')

      const state = getUpdateState()
      expect(state.status).toBe('not-available')
      expect(state.version).toBeUndefined()
      expect(state.percent).toBeUndefined()
    })

    it("'error' fails soft -> not-available, error undefined (NOT 'error')", async () => {
      const { initAutoUpdater, getUpdateState } = await loadModule()
      initAutoUpdater()

      h.fire('error', new Error('ENOTFOUND github.com'))

      const state = getUpdateState()
      expect(state.status).toBe('not-available')
      expect(state.status).not.toBe('error')
      expect(state.error).toBeUndefined()
    })

    it("'error' with a non-Error value still fails soft", async () => {
      const { initAutoUpdater, getUpdateState } = await loadModule()
      initAutoUpdater()

      h.fire('error', 'plain string failure')

      expect(getUpdateState().status).toBe('not-available')
    })

    it('checks for updates after the 10s timeout', async () => {
      const { initAutoUpdater } = await loadModule()
      initAutoUpdater()

      expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
      vi.advanceTimersByTime(10_000)
      expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    })

    it('re-checks on the 4h interval', async () => {
      const { initAutoUpdater } = await loadModule()
      initAutoUpdater()

      vi.advanceTimersByTime(10_000) // 10s timeout fires once
      expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(4 * 60 * 60 * 1000) // 4h interval
      expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    })
  })

  describe('broadcast', () => {
    it('skips destroyed windows', async () => {
      const win = fakeWindow()
      h.mockIsDestroyed.mockReturnValue(true)
      h.mockGetAllWindows.mockReturnValue([win])
      const { checkForUpdatesManual } = await loadModule()

      checkForUpdatesManual() // setState -> broadcast

      expect(h.mockWebContentsSend).not.toHaveBeenCalled()
    })
  })
})
