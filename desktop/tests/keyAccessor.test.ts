import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockLoadSettings = vi.fn()
const mockSaveSettings = vi.fn()
const mockAreUnavailable = vi.fn(() => false)
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args),
  saveSettings: (...args: unknown[]) => mockSaveSettings(...args),
  areSettingsUnavailable: () => mockAreUnavailable()
}))

const mockGetKey = vi.fn()
const mockSetKey = vi.fn()
const mockDeleteKey = vi.fn()
const mockIsEncryptionAvailable = vi.fn()
vi.mock('../src/main/secure/keyStore', () => ({
  getKey: (...args: unknown[]) => mockGetKey(...args),
  setKey: (...args: unknown[]) => mockSetKey(...args),
  deleteKey: (...args: unknown[]) => mockDeleteKey(...args),
  listKeys: () => [],
  isEncryptionAvailable: () => mockIsEncryptionAvailable()
}))

import {
  getEffectiveSettings,
  saveSettingsWithKeys,
  migrateProviderKeysToKeyStore,
  PROVIDER_KEY_FIELDS,
  setSecureStorageWarningListener,
  _resetSessionKeysForTests
} from '../src/main/secure/keyAccessor'

const BASE_SETTINGS = {
  sttProvider: 'openai',
  openaiApiKey: '',
  elevenlabsApiKey: '',
  anthropicApiKey: '',
  replicateApiKey: '',
  sttApiKey: '',
  transcriptionPrompt: '',
  launchAtStartup: true,
  checkForUpdates: true
}

describe('keyAccessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAreUnavailable.mockReturnValue(false)
    _resetSessionKeysForTests()
    setSecureStorageWarningListener(null)
    mockSaveSettings.mockImplementation((patch: Record<string, unknown>) => ({ ...BASE_SETTINGS, ...patch }))
  })

  describe('PROVIDER_KEY_FIELDS', () => {
    it('covers exactly the documented provider-key settings fields', () => {
      expect([...PROVIDER_KEY_FIELDS].sort()).toEqual(
        [
          'anthropicApiKey',
          'elevenlabsApiKey',
          'openaiApiKey',
          'replicateApiKey',
          'groqApiKey',
          'deepgramApiKey',
          'assemblyaiApiKey',
          'mistralApiKey',
          'sttApiKey'
        ].sort()
      )
    })
  })

  describe('getEffectiveSettings — fallback when encryption unavailable', () => {
    it('returns loadSettings() unchanged and never touches the key store', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS, openaiApiKey: 'sk-plaintext' })

      const result = getEffectiveSettings()

      expect(result.openaiApiKey).toBe('sk-plaintext')
      expect(mockGetKey).not.toHaveBeenCalled()
    })
  })

  describe('getEffectiveSettings — composition precedence', () => {
    it('the key store value wins over settings.json when both are present', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS, openaiApiKey: 'sk-json-stale' })
      mockGetKey.mockImplementation((name: string) => (name === 'openaiApiKey' ? 'sk-keystore-fresh' : null))

      const result = getEffectiveSettings()

      expect(result.openaiApiKey).toBe('sk-keystore-fresh')
    })

    it('falls back to the settings.json value for a field the key store has no entry for', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS, sttApiKey: 'priv-json-value' })
      mockGetKey.mockReturnValue(null) // key store empty for every field

      const result = getEffectiveSettings()

      expect(result.sttApiKey).toBe('priv-json-value')
    })

    it('leaves non-key fields untouched', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS, sttProvider: 'elevenlabs' })
      mockGetKey.mockReturnValue(null)

      expect(getEffectiveSettings().sttProvider).toBe('elevenlabs')
    })
  })

  describe('saveSettingsWithKeys — FAIL CLOSED when encryption unavailable', () => {
    it('never writes a new key to settings.json; keeps it in memory and warns the renderer', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const listener = vi.fn()
      setSecureStorageWarningListener(listener)

      const result = saveSettingsWithKeys({ openaiApiKey: 'sk-new', transcriptionPrompt: 'hi' })

      expect(mockSetKey).not.toHaveBeenCalled()
      expect(mockSaveSettings).toHaveBeenCalledWith({ openaiApiKey: '', transcriptionPrompt: 'hi' })
      expect(result.openaiApiKey).toBe('sk-new')
      expect(listener).toHaveBeenCalledWith(expect.stringContaining('kept for this session only'))
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })

    it('adds the keyring instruction to the warning on Linux only', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const listener = vi.fn()
      setSecureStorageWarningListener(listener)
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
      try {
        Object.defineProperty(process, 'platform', { value: 'linux' })
        saveSettingsWithKeys({ openaiApiKey: 'sk-linux' })
        expect(listener).toHaveBeenLastCalledWith(expect.stringContaining('gnome-keyring or KWallet'))
        Object.defineProperty(process, 'platform', { value: 'win32' })
        saveSettingsWithKeys({ openaiApiKey: 'sk-win' })
        expect(listener).toHaveBeenLastCalledWith(expect.not.stringContaining('KWallet'))
      } finally {
        Object.defineProperty(process, 'platform', platform)
        warn.mockRestore()
      }
    })

    it('serves the session key from getEffectiveSettings but not from disk', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      saveSettingsWithKeys({ openaiApiKey: 'sk-new' })
      expect(getEffectiveSettings().openaiApiKey).toBe('sk-new')
      warn.mockRestore()
    })

    it('does not warn or re-persist an unchanged legacy on-disk key', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS, openaiApiKey: 'sk-old' })
      const listener = vi.fn()
      setSecureStorageWarningListener(listener)

      saveSettingsWithKeys({ openaiApiKey: 'sk-old', transcriptionPrompt: 'x' })

      expect(listener).not.toHaveBeenCalled()
      expect(mockSaveSettings).toHaveBeenCalledWith({ transcriptionPrompt: 'x' })
    })

    it('clears the legacy plaintext copy when a new key replaces it (session-only)', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS, openaiApiKey: 'sk-old' })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const result = saveSettingsWithKeys({ openaiApiKey: 'sk-new' })
      expect(mockSaveSettings).toHaveBeenCalledWith({ openaiApiKey: '' })
      expect(result.openaiApiKey).toBe('sk-new')
      warn.mockRestore()
    })

    it('does not re-warn when the same session key is saved again', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const listener = vi.fn()
      setSecureStorageWarningListener(listener)
      saveSettingsWithKeys({ openaiApiKey: 'sk-new' })
      saveSettingsWithKeys({ openaiApiKey: 'sk-new' })
      expect(listener).toHaveBeenCalledTimes(1)
      warn.mockRestore()
    })

    it('clearing a key still persists the empty value', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS, openaiApiKey: 'sk-old' })
      saveSettingsWithKeys({ openaiApiKey: '' })
      expect(mockSaveSettings).toHaveBeenCalledWith({ openaiApiKey: '' })
    })
  })

  describe('saveSettingsWithKeys — routes key fields to the key store when available', () => {
    it('writes the value to the key store and clears the settings.json copy on success', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockSetKey.mockImplementation(() => {})
      mockGetKey.mockReturnValue('sk-new') // round-trip verification matches

      saveSettingsWithKeys({ openaiApiKey: 'sk-new' })

      expect(mockSetKey).toHaveBeenCalledWith('openaiApiKey', 'sk-new')
      expect(mockSaveSettings).toHaveBeenCalledWith({ openaiApiKey: '' })
    })

    it('fails closed when round-trip verification fails: session-only, nothing in settings.json', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockSetKey.mockImplementation(() => {})
      mockGetKey.mockReturnValue('SOMETHING-ELSE') // simulate a corrupted/garbled write
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const listener = vi.fn()
      setSecureStorageWarningListener(listener)

      const result = saveSettingsWithKeys({ openaiApiKey: 'sk-new' })

      expect(mockSaveSettings).toHaveBeenCalledWith({ openaiApiKey: '' })
      expect(result.openaiApiKey).toBe('sk-new')
      expect(listener).toHaveBeenCalledWith(expect.stringContaining('kept for this session only'))
      errSpy.mockRestore()
      warn.mockRestore()
    })

    it('clearing a field (empty string) deletes it from the key store and clears settings.json', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)

      saveSettingsWithKeys({ openaiApiKey: '' })

      expect(mockDeleteKey).toHaveBeenCalledWith('openaiApiKey')
      expect(mockSaveSettings).toHaveBeenCalledWith({ openaiApiKey: '' })
    })

    it('fails closed when the key store write itself throws: session-only, served from getEffectiveSettings', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockSetKey.mockImplementation(() => {
        throw new Error('disk full')
      })
      mockGetKey.mockReturnValue(null)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      saveSettingsWithKeys({ openaiApiKey: 'sk-new' })

      expect(mockSaveSettings).toHaveBeenCalledWith({ openaiApiKey: '' })
      expect(getEffectiveSettings().openaiApiKey).toBe('sk-new')
      errSpy.mockRestore()
      warn.mockRestore()
    })

    it('leaves an unchanged legacy plaintext key in settings.json when the key store write fails', () => {
      // Startup migration failed, so the legacy key is still on disk; an unrelated settings save
      // re-sends it. A failing key store must not blank the only persisted copy.
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockSetKey.mockImplementation(() => {
        throw new Error('disk full')
      })
      mockGetKey.mockReturnValue(null)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS, openaiApiKey: 'sk-legacy' })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const listener = vi.fn()
      setSecureStorageWarningListener(listener)

      saveSettingsWithKeys({ openaiApiKey: 'sk-legacy', launchAtStartup: false })

      expect(mockSaveSettings).toHaveBeenCalledWith({ launchAtStartup: false })
      expect(listener).not.toHaveBeenCalled()
      expect(getEffectiveSettings().openaiApiKey).toBe('sk-legacy')
      errSpy.mockRestore()
      warn.mockRestore()
    })

    it('still blanks settings.json when deleting a cleared field from the key store throws (best-effort)', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockDeleteKey.mockImplementation(() => {
        throw new Error('disk full')
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      saveSettingsWithKeys({ openaiApiKey: '' })

      expect(mockSaveSettings).toHaveBeenCalledWith({ openaiApiKey: '' })
      errSpy.mockRestore()
    })

    it('does not touch the key store for fields absent from the partial', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)

      saveSettingsWithKeys({ transcriptionPrompt: 'only this changed' })

      expect(mockSetKey).not.toHaveBeenCalled()
      expect(mockDeleteKey).not.toHaveBeenCalled()
      expect(mockSaveSettings).toHaveBeenCalledWith({ transcriptionPrompt: 'only this changed' })
    })
  })

  describe('migrateProviderKeysToKeyStore', () => {
    it('is a no-op when encryption is unavailable', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS, openaiApiKey: 'sk-plaintext' })

      migrateProviderKeysToKeyStore()

      expect(mockSetKey).not.toHaveBeenCalled()
      expect(mockSaveSettings).not.toHaveBeenCalled()
    })

    it('moves non-empty plaintext keys into the key store and clears them from settings.json', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockLoadSettings.mockReturnValue({
        ...BASE_SETTINGS,
        openaiApiKey: 'sk-plaintext',
        anthropicApiKey: 'sk-ant-plaintext'
      })
      mockSetKey.mockImplementation(() => {})
      mockGetKey.mockImplementation((name: string) =>
        name === 'openaiApiKey' ? 'sk-plaintext' : name === 'anthropicApiKey' ? 'sk-ant-plaintext' : null
      )

      migrateProviderKeysToKeyStore()

      expect(mockSetKey).toHaveBeenCalledWith('openaiApiKey', 'sk-plaintext')
      expect(mockSetKey).toHaveBeenCalledWith('anthropicApiKey', 'sk-ant-plaintext')
      expect(mockSaveSettings).toHaveBeenCalledWith({ openaiApiKey: '', anthropicApiKey: '' })
    })

    it('never drops the field itself — settings.json keeps the key present as empty string, not removed', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS, openaiApiKey: 'sk-plaintext' })
      mockSetKey.mockImplementation(() => {})
      mockGetKey.mockReturnValue('sk-plaintext')

      migrateProviderKeysToKeyStore()

      const patch = mockSaveSettings.mock.calls[0][0]
      expect('openaiApiKey' in patch).toBe(true)
      expect(patch.openaiApiKey).toBe('')
    })

    it('does NOT clear the settings.json plaintext when round-trip verification fails', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS, openaiApiKey: 'sk-plaintext' })
      mockSetKey.mockImplementation(() => {})
      mockGetKey.mockReturnValue('CORRUPTED-READBACK') // round-trip fails

      migrateProviderKeysToKeyStore()

      // Nothing verified successfully -> no fields to clear -> saveSettings
      // is never called at all (idempotent no-op on this run; retried next launch).
      expect(mockSaveSettings).not.toHaveBeenCalled()
    })

    it('is idempotent: a second run with already-cleared settings.json does nothing further', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      // Simulate post-migration state: settings.json fields already blank.
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS, openaiApiKey: '' })

      migrateProviderKeysToKeyStore()

      expect(mockSetKey).not.toHaveBeenCalled()
      expect(mockSaveSettings).not.toHaveBeenCalled()
    })

    it('skips fields with no plaintext value without calling setKey for them', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS, openaiApiKey: 'sk-only-this-one' })
      mockSetKey.mockImplementation(() => {})
      mockGetKey.mockReturnValue('sk-only-this-one')

      migrateProviderKeysToKeyStore()

      expect(mockSetKey).toHaveBeenCalledTimes(1)
      expect(mockSetKey).toHaveBeenCalledWith('openaiApiKey', 'sk-only-this-one')
    })
  })
  describe('locked settings file (areSettingsUnavailable)', () => {
    it('migration: a throwing saveSettings is caught, key stays in the store, no throw', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS, openaiApiKey: 'sk-plaintext' })
      mockSetKey.mockReturnValue(undefined)
      mockGetKey.mockReturnValue('sk-plaintext')
      mockSaveSettings.mockImplementation(() => { throw Object.assign(new Error('busy sk-plaintext'), { code: 'EBUSY' }) })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(() => migrateProviderKeysToKeyStore()).not.toThrow()
      const logged = warn.mock.calls.flat().join(' ')
      expect(logged).toContain('EBUSY')
      expect(logged).not.toContain('sk-plaintext')
      warn.mockRestore()
    })

    it('saveSettingsWithKeys refuses before touching the key store', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockLoadSettings.mockReturnValue({ ...BASE_SETTINGS })
      mockAreUnavailable.mockReturnValue(true)
      expect(() => saveSettingsWithKeys({ openaiApiKey: 'sk-new' })).toThrow(/refusing to overwrite/)
      expect(mockSetKey).not.toHaveBeenCalled()
      expect(mockDeleteKey).not.toHaveBeenCalled()
      expect(mockSaveSettings).not.toHaveBeenCalled()
    })
  })
})
