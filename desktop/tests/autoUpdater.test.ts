import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p })
}

// --- Hoisted mock state (shared with vi.mock factories, reset per test) ---
const h = vi.hoisted(() => {
  // electron-updater handler map: event name -> handler(s)
  const handlers = new Map<string, (...args: unknown[]) => void>()

  const autoUpdater: Record<string, any> = {
    autoDownload: false,
    downloadUpdate: vi.fn(() => Promise.resolve()),
    verifyUpdateCodeSignature: undefined as unknown,
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
  const mockVerifyAuthenticode = vi.fn()
  const userData = { dir: '' }

  return {
    handlers,
    autoUpdater,
    fire,
    mockNotificationShow,
    mockNotificationIsSupported,
    mockWebContentsSend,
    mockIsDestroyed,
    mockGetAllWindows,
    mockSetUpdateReady,
    mockVerifyAuthenticode,
    userData
  }
})

vi.mock('electron-updater', () => ({
  autoUpdater: h.autoUpdater
}))

vi.mock('../src/main/updateSignature/authenticode', () => ({
  verifyAuthenticode: (...a: unknown[]) => h.mockVerifyAuthenticode(...a)
}))

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.2.6'),
    getPath: vi.fn(() => h.userData.dir)
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
    h.autoUpdater.downloadUpdate.mockReset().mockResolvedValue(undefined)
    h.autoUpdater.verifyUpdateCodeSignature = vi.fn()
    h.mockVerifyAuthenticode.mockReset().mockResolvedValue({ ok: true, thumbprint: 'T', spkiSha256: 'S', digest: 'sha256' })
    h.userData.dir = mkdtempSync(join(tmpdir(), 'whisperio-updater-'))
    setPlatform('darwin') // platform-stable default; win32/linux tests opt in

    h.mockNotificationShow.mockReset()
    h.mockNotificationIsSupported.mockReset().mockReturnValue(false)
    h.mockWebContentsSend.mockReset()
    h.mockIsDestroyed.mockReset().mockReturnValue(false)
    h.mockGetAllWindows.mockReset().mockReturnValue([])
    h.mockSetUpdateReady.mockReset()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform)
    rmSync(h.userData.dir, { recursive: true, force: true })
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
      expect(await installUpdate()).toBe(false)
      expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    })

    it('quits and installs when status is downloaded', async () => {
      const { initAutoUpdater, installUpdate, getUpdateState } = await loadModule()
      initAutoUpdater()
      h.fire('update-downloaded', { version: '1.3.0' })
      expect(getUpdateState().status).toBe('downloaded')

      expect(await installUpdate()).toBe(true)
      expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
    })

    it('win32: re-verifies the downloaded file right before installing', async () => {
      setPlatform('win32')
      const { initAutoUpdater, installUpdate } = await loadModule()
      initAutoUpdater(false)
      h.fire('update-downloaded', { version: '1.3.0', downloadedFile: 'C:/cache/Whisperio-Setup-1.3.0.exe' })

      expect(await installUpdate()).toBe(true)
      expect(h.mockVerifyAuthenticode).toHaveBeenCalledWith('C:/cache/Whisperio-Setup-1.3.0.exe', expect.objectContaining({ spkiSha256: expect.any(Array) }))
      expect(h.autoUpdater.quitAndInstall).toHaveBeenCalled()
    })

    it('win32: refuses to install and reports an error when re-verification fails', async () => {
      setPlatform('win32')
      h.mockVerifyAuthenticode.mockResolvedValue({ ok: false, reason: 'signature does not verify' })
      const { initAutoUpdater, installUpdate, getUpdateState } = await loadModule()
      initAutoUpdater(false)
      h.fire('update-downloaded', { version: '1.3.0', downloadedFile: 'C:/cache/x.exe' })

      expect(await installUpdate()).toBe(false)
      expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
      expect(getUpdateState().status).toBe('error')
      expect(getUpdateState().error).toMatch(/1\.3\.0 couldn't be verified/)
    })

    it('win32: refuses when the downloaded path is unknown (fail closed)', async () => {
      setPlatform('win32')
      const { initAutoUpdater, installUpdate } = await loadModule()
      initAutoUpdater(false)
      h.fire('update-downloaded', { version: '1.3.0' })
      expect(await installUpdate()).toBe(false)
      expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    })
  })

  describe('signature rejection and manual-update platforms', () => {
    const sigErr = (): Error => Object.assign(new Error('New version 9.9.9 is not signed by the application owner: x'), { code: 'ERR_UPDATER_INVALID_SIGNATURE' })

    it("signature rejection -> status 'error' with Releases link, version persisted", async () => {
      const { initAutoUpdater, getUpdateState } = await loadModule()
      initAutoUpdater(false)
      h.fire('update-available', { version: '9.9.9' })
      h.fire('error', sigErr())

      const st = getUpdateState()
      expect(st.status).toBe('error')
      expect(st.error).toBe("Version 9.9.9 couldn't be verified - download it from the Releases page: https://github.com/draenger/whisperio/releases")
      expect(st.manualDownloadUrl).toBe('https://github.com/draenger/whisperio/releases')
      expect(JSON.parse(readFileSync(join(h.userData.dir, 'rejected-update.json'), 'utf-8'))).toEqual({ version: '9.9.9' })
    })

    it('a previously rejected version is not downloaded again (even after restart); other versions are', async () => {
      let m = await loadModule()
      m.initAutoUpdater(false)
      h.fire('error', sigErr())

      vi.resetModules()
      h.handlers.clear()
      m = await loadModule()
      m.initAutoUpdater(false)
      h.fire('update-available', { version: '9.9.9' })
      expect(h.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
      expect(m.getUpdateState().status).toBe('error')

      h.fire('update-available', { version: '9.9.10' })
      expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
      expect(m.getUpdateState().status).toBe('available')
    })

    it('rejected checkForUpdates() with a signature error is surfaced too', async () => {
      h.autoUpdater.checkForUpdates.mockRejectedValue(sigErr())
      const { checkForUpdatesManual, getUpdateState } = await loadModule()
      checkForUpdatesManual()
      await vi.waitFor(() => expect(getUpdateState().status).toBe('error'))
    })

    it('linux: never downloads automatically; surfaces a Releases link', async () => {
      setPlatform('linux')
      const { initAutoUpdater, getUpdateState } = await loadModule()
      initAutoUpdater(false)
      expect(h.autoUpdater.autoDownload).toBe(false)
      h.fire('update-available', { version: '2.0.0' })
      expect(h.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
      expect(getUpdateState()).toMatchObject({ status: 'available', version: '2.0.0', manualDownloadUrl: 'https://github.com/draenger/whisperio/releases' })
    })

    it('win32 without the verifyUpdateCodeSignature hook fails closed (no download)', async () => {
      setPlatform('win32')
      delete h.autoUpdater.verifyUpdateCodeSignature
      const { initAutoUpdater, getUpdateState } = await loadModule()
      initAutoUpdater(false)
      expect(h.autoUpdater.autoDownload).toBe(false)
      h.fire('update-available', { version: '2.0.0' })
      expect(h.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
      expect(getUpdateState().manualDownloadUrl).toBeDefined()
    })

    it('does not leave a rejected-update file behind for ordinary errors', async () => {
      const { initAutoUpdater } = await loadModule()
      initAutoUpdater(false)
      h.fire('error', new Error('ENOTFOUND'))
      expect(existsSync(join(h.userData.dir, 'rejected-update.json'))).toBe(false)
    })
  })

  describe('update signature verification (win32)', () => {
    it('installs the pinned Authenticode verifier on win32 only', async () => {
      const orig = Object.getOwnPropertyDescriptor(process, 'platform')!
      const au = h.autoUpdater as Record<string, unknown>
      au.verifyUpdateCodeSignature = undefined
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

      // downloads are started explicitly from the update-available handler
      expect(h.autoUpdater.autoDownload).toBe(false)
      // only macOS (signed+notarized) may install on quit
      expect(h.autoUpdater.autoInstallOnAppQuit).toBe(true)
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
      expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
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
      const cb = h.mockSetUpdateReady.mock.calls[0][1] as () => Promise<boolean>
      await cb()
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
