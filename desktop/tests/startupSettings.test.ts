import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockLoadSettings = vi.fn()
const mockAreUnavailable = vi.fn(() => false)
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...a: unknown[]) => mockLoadSettings(...a),
  areSettingsUnavailable: () => mockAreUnavailable()
}))

import { applyLaunchAtStartup } from '../src/main/startupSettings'

describe('applyLaunchAtStartup', () => {
  const app = { setLoginItemSettings: vi.fn() }
  beforeEach(() => {
    vi.clearAllMocks()
    mockAreUnavailable.mockReturnValue(false)
    mockLoadSettings.mockReturnValue({ launchAtStartup: false })
  })

  it('applies the saved value when packaged and settings are readable', () => {
    expect(applyLaunchAtStartup(app, true, '/x/Whisperio.exe')).toBe(true)
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false, path: '/x/Whisperio.exe' })
  })

  it('does nothing when settings are unavailable (defaults must not re-enable autostart)', () => {
    mockLoadSettings.mockReturnValue({ launchAtStartup: true })
    mockAreUnavailable.mockReturnValue(true)
    expect(applyLaunchAtStartup(app, true, '/x/Whisperio.exe')).toBe(false)
    expect(app.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('does nothing in dev (not packaged)', () => {
    expect(applyLaunchAtStartup(app, false, '/x/electron.exe')).toBe(false)
    expect(app.setLoginItemSettings).not.toHaveBeenCalled()
  })
})

import { handleStartupFailure } from '../src/main/startupSettings'

describe('handleStartupFailure', () => {
  it('logs the full error, shows the error box, then exits 1', () => {
    const dialog = { showErrorBox: vi.fn() }
    const app = { exit: vi.fn() }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('boom')
    handleStartupFailure(err, dialog, app)
    expect(spy.mock.calls.flat()).toContain(err.stack)
    expect(dialog.showErrorBox).toHaveBeenCalledWith('Whisperio failed to start', 'boom')
    expect(app.exit).toHaveBeenCalledWith(1)
    spy.mockRestore()
  })

  it('still exits when the dialog throws', () => {
    const dialog = { showErrorBox: vi.fn(() => { throw new Error('no ui') }) }
    const app = { exit: vi.fn() }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => handleStartupFailure('x', dialog, app)).toThrow()
    expect(app.exit).toHaveBeenCalledWith(1)
  })
})
