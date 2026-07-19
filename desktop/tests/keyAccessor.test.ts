import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockLoadSettings = vi.fn()
const mockSaveSettings = vi.fn()
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: (...args: unknown[]) => mockLoadSettings(...args),
  saveSettings: (...args: unknown[]) => mockSaveSettings(...args)
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
  PROVIDER_KEY_FIELDS
} from '../src/main/secure/keyAccessor'

const BASE_SETTINGS = {
  sttProvider: 'openai',
  openaiApiKey: '',
  elevenlabsApiKey: '',
  anthropicApiKey: '',
  replicateApiKey: '',
  sttApiKey: '',
  transcriptionPrompt: '',
  launchAtStartup: true
}

describe('keyAccessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  describe('saveSettingsWithKeys — fallback when encryption unavailable', () => {
    it('saves key fields to settings.json exactly as before, untouched', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)

      const result = saveSettingsWithKeys({ openaiApiKey: 'sk-new', transcriptionPrompt: 'hi' })

      expect(mockSetKey).not.toHaveBeenCalled()
      expect(mockSaveSettings).toHaveBeenCalledWith({ openaiApiKey: 'sk-new', transcriptionPrompt: 'hi' })
      expect(result.openaiApiKey).toBe('sk-new')
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

    it('keeps the plaintext in settings.json when round-trip verification fails', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockSetKey.mockImplementation(() => {})
      mockGetKey.mockReturnValue('SOMETHING-ELSE') // simulate a corrupted/garbled write

      saveSettingsWithKeys({ openaiApiKey: 'sk-new' })

      expect(mockSaveSettings).toHaveBeenCalledWith({ openaiApiKey: 'sk-new' })
    })

    it('clearing a field (empty string) deletes it from the key store and clears settings.json', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)

      saveSettingsWithKeys({ openaiApiKey: '' })

      expect(mockDeleteKey).toHaveBeenCalledWith('openaiApiKey')
      expect(mockSaveSettings).toHaveBeenCalledWith({ openaiApiKey: '' })
    })

    it('keeps the plaintext in settings.json when the key store write itself throws', () => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockSetKey.mockImplementation(() => {
        throw new Error('disk full')
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      saveSettingsWithKeys({ openaiApiKey: 'sk-new' })

      expect(mockSaveSettings).toHaveBeenCalledWith({ openaiApiKey: 'sk-new' })
      errSpy.mockRestore()
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
})
