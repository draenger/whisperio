import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Key-store helpers that throw must never break a settings save or app startup, and the log
// line must carry only the error class name: the message can hold key material or paths.

const SECRET_IN_MESSAGE = 'sk-must-not-be-logged'

let settings: Record<string, unknown> = {}
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: () => ({ ...settings }),
  areSettingsUnavailable: () => false,
  saveSettings: (p: Record<string, unknown>) => {
    settings = { ...settings, ...p }
    return { ...settings }
  }
}))

const mockDropWrapped = vi.fn()
const mockIsWeak = vi.fn(() => true)
const mockHasWrapped = vi.fn(() => true)
const mockRewrap = vi.fn(() => ({ rewrapped: 0 }))
vi.mock('../src/main/secure/keyStore', () => ({
  getKey: () => null,
  setKey: vi.fn(),
  deleteKey: vi.fn(),
  isEncryptionAvailable: () => false,
  isWeakLinuxBackend: () => mockIsWeak(),
  hasWrappedEntries: () => mockHasWrapped(),
  dropWrappedEntry: (...a: unknown[]) => mockDropWrapped(...a),
  readWeakBackendKeys: () => ({}),
  rewrapWeakEntries: () => mockRewrap()
}))

import {
  getEffectiveSettings,
  saveSettingsWithKeys,
  isLinuxKeyringIssue,
  rescueWeakLinuxKeys,
  rewrapWeakLinuxKeys,
  _resetSessionKeysForTests
} from '../src/main/secure/keyAccessor'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const setPlatform = (p: string): void => {
  Object.defineProperty(process, 'platform', { value: p })
}
const boom = (): never => {
  throw new TypeError(SECRET_IN_MESSAGE)
}
const logged = (spy: ReturnType<typeof vi.spyOn>): string => spy.mock.calls.map((c) => c.join(' ')).join('\n')

describe('keyAccessor: throwing key-store helpers fail soft', () => {
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.clearAllMocks()
    mockDropWrapped.mockReset()
    mockIsWeak.mockReset().mockReturnValue(true)
    mockHasWrapped.mockReset().mockReturnValue(true)
    mockRewrap.mockReset().mockReturnValue({ rewrapped: 0 })
    settings = { openaiApiKey: '' }
    _resetSessionKeysForTests()
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(process, 'platform', platform)
  })

  describe('dropping a stale wrapped entry throws (no secure storage)', () => {
    it('replacing a key still keeps the new one for the session and persists no plaintext', () => {
      mockDropWrapped.mockImplementation(boom)
      expect(() => saveSettingsWithKeys({ openaiApiKey: 'sk-new' })).not.toThrow()
      expect(mockDropWrapped).toHaveBeenCalledWith('openaiApiKey')
      expect(getEffectiveSettings().openaiApiKey).toBe('sk-new')
      expect(settings.openaiApiKey).toBe('')
      expect(logged(errSpy)).toContain('could not drop stale wrapped key "openaiApiKey" (TypeError)')
      expect(logged(errSpy)).not.toContain(SECRET_IN_MESSAGE)
    })

    it('clearing a session key still clears it', () => {
      saveSettingsWithKeys({ openaiApiKey: 'sk-new' })
      mockDropWrapped.mockImplementation(boom)
      expect(() => saveSettingsWithKeys({ openaiApiKey: '' })).not.toThrow()
      expect(mockDropWrapped).toHaveBeenCalledTimes(2)
      expect(getEffectiveSettings().openaiApiKey).toBe('')
      expect(logged(errSpy)).not.toContain(SECRET_IN_MESSAGE)
    })
  })

  describe('Linux keyring probe throws', () => {
    it('a throwing backend probe reports no keyring issue and rescues nothing', () => {
      setPlatform('linux')
      expect(isLinuxKeyringIssue()).toBe(true) // the mocks alone do report an issue
      mockIsWeak.mockImplementation(boom)
      expect(isLinuxKeyringIssue()).toBe(false)
      expect(rescueWeakLinuxKeys()).toBe(0)
    })

    it('a throwing wrapped-entries check reports no keyring issue', () => {
      setPlatform('linux')
      mockHasWrapped.mockImplementation(boom)
      expect(isLinuxKeyringIssue()).toBe(false)
    })
  })

  it('a throwing re-wrap at startup returns 0 and logs only the error name', () => {
    mockRewrap.mockImplementation(boom)
    expect(rewrapWeakLinuxKeys()).toBe(0)
    expect(logged(errSpy)).toContain('weak-backend re-wrap failed (TypeError)')
    expect(logged(errSpy)).not.toContain(SECRET_IN_MESSAGE)
  })
})
