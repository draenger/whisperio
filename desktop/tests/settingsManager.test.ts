import { vi, describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData')
  }
}))

const mockExistsSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockRenameSync = vi.fn()

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args)
}))

import {
  loadSettings,
  saveSettings,
  getSetting,
  getActiveVocabulary,
  DEFAULT_VOCABULARY_TERMS,
  type AppSettings
} from '../src/main/settingsManager'

const DEFAULT_SETTINGS = {
  sttProvider: 'openai',
  providerChain: ['openai'],
  openaiApiKey: '',
  openaiBaseUrl: '',
  whisperModel: '',
  elevenlabsApiKey: '',
  transcriptionLanguage: 'auto',
  transcriptionPrompt: '',
  // The built-in vocabulary now lives in DEFAULT_VOCABULARY_TERMS; the stored
  // `customVocabulary` holds only the user's own additions.
  customVocabulary: '',
  removedDefaultVocabulary: [],
  aiPostProcessing: false,
  launchAtStartup: true,
  dictationHotkey: '',
  dictateAndSendHotkey: '',
  theme: 'dark',
  accentColor: 'blue',
  inputDeviceId: '',
  outputDeviceId: '',
  saveRecordings: true,
  outputRecordingHotkey: '',
  fallbackEnabled: false,
  githubUser: '',
  githubRepo: '',
  githubBranch: ''
}

const SETTINGS_PATH = join('/mock/userData', 'settings.json')

describe('settingsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('loadSettings', () => {
    it('returns defaults when file does not exist', () => {
      mockExistsSync.mockReturnValue(false)
      const result = loadSettings()
      expect(result).toEqual(DEFAULT_SETTINGS)
    })

    it('merges partial data from file with defaults', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ openaiApiKey: 'sk-test' }))
      const result = loadSettings()
      expect(result).toEqual({ ...DEFAULT_SETTINGS, openaiApiKey: 'sk-test' })
    })

    it('returns defaults on broken JSON', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('not json{{{')
      const result = loadSettings()
      expect(result).toEqual(DEFAULT_SETTINGS)
    })
  })

  describe('saveSettings', () => {
    it('merges with existing settings and writes to file', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ openaiApiKey: 'sk-old' }))

      const result = saveSettings({ transcriptionPrompt: 'New prompt' })

      expect(result).toEqual({
        ...DEFAULT_SETTINGS,
        openaiApiKey: 'sk-old',
        transcriptionPrompt: 'New prompt'
      })
      // Atomic write: content is written to a temp file then renamed over the
      // real settings.json so a crash mid-write can't corrupt it.
      expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
      const [tmpPath, content, enc] = mockWriteFileSync.mock.calls[0]
      expect(String(tmpPath).startsWith(`${SETTINGS_PATH}.`)).toBe(true)
      expect(String(tmpPath).endsWith('.tmp')).toBe(true)
      expect(content).toBe(JSON.stringify(result, null, 2))
      expect(enc).toBe('utf-8')
      expect(mockRenameSync).toHaveBeenCalledWith(tmpPath, SETTINGS_PATH)
    })
  })

  describe('getSetting', () => {
    it('returns a specific setting value', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ openaiApiKey: 'sk-123' }))
      expect(getSetting('openaiApiKey')).toBe('sk-123')
    })
  })

  describe('getActiveVocabulary', () => {
    const base = { ...DEFAULT_SETTINGS } as AppSettings

    it('returns all default terms when nothing is removed and no additions', () => {
      expect(getActiveVocabulary(base)).toBe(DEFAULT_VOCABULARY_TERMS.join(', '))
    })

    it('omits soft-deleted default terms (case-insensitive)', () => {
      const result = getActiveVocabulary({ ...base, removedDefaultVocabulary: ['git', 'DOCKER'] })
      const terms = result.split(', ')
      expect(terms).not.toContain('git')
      expect(terms).not.toContain('Docker')
      expect(terms).toContain('GitHub')
    })

    it('appends user additions after active defaults and de-dupes', () => {
      const result = getActiveVocabulary({
        ...base,
        removedDefaultVocabulary: ['git'],
        customVocabulary: 'Svelte, git, Rust'
      })
      const terms = result.split(', ')
      // "git" is soft-deleted AND re-added as a custom term -> re-appears once at the end
      expect(terms.filter((t) => t.toLowerCase() === 'git')).toHaveLength(1)
      expect(terms).toContain('Svelte')
      expect(terms).toContain('Rust')
    })
  })

  describe('legacy vocabulary migration', () => {
    it('reconstructs soft-delete state from a flat pre-migration customVocabulary', () => {
      mockExistsSync.mockReturnValue(true)
      // Old-format file: defaults flattened into customVocabulary, no
      // removedDefaultVocabulary. User had deleted "git" and added "Svelte".
      const legacyTerms = DEFAULT_VOCABULARY_TERMS.filter((t) => t !== 'git').concat('Svelte')
      mockReadFileSync.mockReturnValue(JSON.stringify({ customVocabulary: legacyTerms.join(', ') }))

      const result = loadSettings()

      expect(result.removedDefaultVocabulary).toEqual(['git'])
      expect(result.customVocabulary).toBe('Svelte')
    })

    it('leaves new-format settings untouched', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ customVocabulary: 'Svelte', removedDefaultVocabulary: ['git'] })
      )

      const result = loadSettings()

      expect(result.removedDefaultVocabulary).toEqual(['git'])
      expect(result.customVocabulary).toBe('Svelte')
    })
  })
})
