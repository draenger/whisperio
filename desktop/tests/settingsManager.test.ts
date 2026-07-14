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
  DEFAULT_CLEANUP_TEMPLATES,
  DEFAULT_TONE_MAP,
  type AppSettings
} from '../src/main/settingsManager'

const DEFAULT_SETTINGS = {
  sttProvider: 'openai',
  providerChain: ['openai'],
  openaiApiKey: '',
  openaiBaseUrl: '',
  whisperModel: '',
  elevenlabsApiKey: '',
  replicateApiKey: '',
  sttReplicateModel: '',
  sttApiKey: '',
  transcriptionLanguage: 'auto',
  transcriptionPrompt: '',
  // The built-in vocabulary now lives in DEFAULT_VOCABULARY_TERMS; the stored
  // `customVocabulary` holds only the user's own additions.
  customVocabulary: '',
  removedDefaultVocabulary: [],
  aiPostProcessing: false,
  cleanupEnabled: true,
  cleanupMode: 'full',
  cleanupAuto: false,
  cleanupTemplates: DEFAULT_CLEANUP_TEMPLATES,
  contextAwareTone: false,
  toneMap: DEFAULT_TONE_MAP,
  windowTitlePermissionEnabled: false,
  aiProvider: 'openai',
  aiBaseUrl: '',
  aiModel: '',
  anthropicApiKey: '',
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

  describe('legacy aiPostProcessing -> cleanupAuto migration (ROUGH-FIRST v1.4 PR2)', () => {
    it('migrates aiPostProcessing: true to cleanupAuto: true, cleanupMode: "full"', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ aiPostProcessing: true }))

      const result = loadSettings()

      expect(result.cleanupAuto).toBe(true)
      expect(result.cleanupMode).toBe('full')
      // cleanupEnabled is untouched by this migration — it now means "the
      // on-demand action is available at all" and defaults to true
      // regardless of the legacy auto-cleanup flag.
      expect(result.cleanupEnabled).toBe(true)
      // aiPostProcessing itself is never dropped (settings invariant).
      expect(result.aiPostProcessing).toBe(true)
    })

    it('migrates aiPostProcessing: false to cleanupAuto: false', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ aiPostProcessing: false }))

      const result = loadSettings()

      expect(result.cleanupAuto).toBe(false)
      expect(result.cleanupEnabled).toBe(true)
      // cleanupMode isn't addressed by the false-branch migration — it keeps
      // its default.
      expect(result.cleanupMode).toBe('full')
      expect(result.aiPostProcessing).toBe(false)
    })

    it('does not clobber an already-chosen cleanupMode when migrating aiPostProcessing: true', () => {
      mockExistsSync.mockReturnValue(true)
      // A file that went through PR1's migration (cleanupMode set to 'light'
      // by the user) but predates cleanupAuto entirely.
      mockReadFileSync.mockReturnValue(JSON.stringify({ aiPostProcessing: true, cleanupMode: 'light' }))

      const result = loadSettings()

      expect(result.cleanupAuto).toBe(true)
      expect(result.cleanupMode).toBe('light')
    })

    it('is idempotent: loading the same legacy file twice yields the same result', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ aiPostProcessing: true }))

      const first = loadSettings()
      const second = loadSettings()

      expect(second).toEqual(first)
    })

    it('is idempotent: feeding an already-migrated file back in is a no-op', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ aiPostProcessing: true }))
      const migratedOnce = loadSettings()

      mockReadFileSync.mockReturnValue(JSON.stringify(migratedOnce))
      const migratedTwice = loadSettings()

      expect(migratedTwice).toEqual(migratedOnce)
    })

    it('does not run when cleanupAuto is already present, even if it disagrees with the legacy flag', () => {
      mockExistsSync.mockReturnValue(true)
      // Already-migrated (or explicitly user-edited) file: cleanupAuto is
      // present, so the legacy flag must not override it even though it
      // disagrees.
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ aiPostProcessing: true, cleanupAuto: false, cleanupMode: 'light' })
      )

      const result = loadSettings()

      expect(result.cleanupAuto).toBe(false)
      expect(result.cleanupMode).toBe('light')
      expect(result.aiPostProcessing).toBe(true)
    })

    it('leaves defaults untouched when neither the legacy flag nor cleanupAuto are present', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ openaiApiKey: 'sk-test' }))

      const result = loadSettings()

      expect(result.cleanupAuto).toBe(false)
      expect(result.cleanupEnabled).toBe(true)
      expect(result.cleanupMode).toBe('full')
      expect(result.aiPostProcessing).toBe(false)
      expect(result.cleanupTemplates).toEqual(DEFAULT_CLEANUP_TEMPLATES)
    })
  })

  describe('STT+ additive settings (Replicate STT + priv server key)', () => {
    it('seeds replicateApiKey, sttReplicateModel, sttApiKey to empty-string defaults on a file predating them', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ openaiApiKey: 'sk-test' }))

      const result = loadSettings()

      expect(result.replicateApiKey).toBe('')
      expect(result.sttReplicateModel).toBe('')
      expect(result.sttApiKey).toBe('')
      // Existing keys are untouched (additive, nothing dropped).
      expect(result.openaiApiKey).toBe('sk-test')
    })

    it('preserves explicit values for the new keys when already present', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          replicateApiKey: 'r8_test',
          sttReplicateModel: 'vaibhavs10/incredibly-fast-whisper',
          sttApiKey: 'priv-secret'
        })
      )

      const result = loadSettings()

      expect(result.replicateApiKey).toBe('r8_test')
      expect(result.sttReplicateModel).toBe('vaibhavs10/incredibly-fast-whisper')
      expect(result.sttApiKey).toBe('priv-secret')
    })

    it('is idempotent: loading a pre-STT+ file twice yields the same result', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ openaiApiKey: 'sk-test' }))

      const first = loadSettings()
      const second = loadSettings()

      expect(second).toEqual(first)
    })

    it("'replicate' is accepted as a providerChain entry alongside the existing provider ids", () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ providerChain: ['replicate', 'openai'] }))

      const result = loadSettings()

      expect(result.providerChain).toEqual(['replicate', 'openai'])
    })
  })

  describe('legacy violet theme/accent migration (VIOLET-OUT)', () => {
    it('maps a saved theme "violet-legacy" to "dark"', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ theme: 'violet-legacy' }))

      const result = loadSettings()

      expect(result.theme).toBe('dark')
    })

    it('maps a saved accentColor "violet" to "teal"', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ accentColor: 'violet' }))

      const result = loadSettings()

      expect(result.accentColor).toBe('teal')
    })

    it('maps both together when a legacy file has both violet values set', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ theme: 'violet-legacy', accentColor: 'violet' })
      )

      const result = loadSettings()

      expect(result.theme).toBe('dark')
      expect(result.accentColor).toBe('teal')
    })

    it('leaves other keys untouched by the migration (additive, no drops)', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ theme: 'violet-legacy', accentColor: 'violet', openaiApiKey: 'sk-test' })
      )

      const result = loadSettings()

      expect(result.openaiApiKey).toBe('sk-test')
    })

    it('is idempotent: loading the same legacy file twice yields the same result', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ theme: 'violet-legacy', accentColor: 'violet' })
      )

      const first = loadSettings()
      const second = loadSettings()

      expect(second).toEqual(first)
      expect(second.theme).toBe('dark')
      expect(second.accentColor).toBe('teal')
    })

    it('leaves already-current theme/accent values untouched', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ theme: 'light', accentColor: 'amber' }))

      const result = loadSettings()

      expect(result.theme).toBe('light')
      expect(result.accentColor).toBe('amber')
    })
  })

  describe('context-aware tone additive settings + toneMap seeding (v1.5 Work Item B)', () => {
    it('seeds toneMap from DEFAULT_TONE_MAP on a file predating it', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ openaiApiKey: 'sk-test' }))

      const result = loadSettings()

      expect(result.toneMap).toEqual(DEFAULT_TONE_MAP)
      expect(result.contextAwareTone).toBe(false)
      expect(result.windowTitlePermissionEnabled).toBe(false)
    })

    it('hands back a fresh copy of DEFAULT_TONE_MAP, never the shared module reference', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ openaiApiKey: 'sk-test' }))

      const result = loadSettings()
      result.toneMap['mutated'] = 'casual'

      expect(DEFAULT_TONE_MAP['mutated']).toBeUndefined()
    })

    it('preserves an explicit, user-edited toneMap instead of re-seeding it', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ toneMap: { figma: 'technical' }, contextAwareTone: true })
      )

      const result = loadSettings()

      expect(result.toneMap).toEqual({ figma: 'technical' })
      expect(result.contextAwareTone).toBe(true)
    })

    it('respects a user-saved empty toneMap ({}) rather than re-seeding defaults', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ toneMap: {} }))

      const result = loadSettings()

      expect(result.toneMap).toEqual({})
    })

    it('preserves an explicit windowTitlePermissionEnabled: true', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ windowTitlePermissionEnabled: true }))

      const result = loadSettings()

      expect(result.windowTitlePermissionEnabled).toBe(true)
    })

    it('is idempotent: loading a pre-Work-Item-B file twice yields the same result', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ openaiApiKey: 'sk-test' }))

      const first = loadSettings()
      const second = loadSettings()

      expect(second).toEqual(first)
    })

    it('is idempotent: feeding an already-seeded file back in leaves toneMap untouched', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ openaiApiKey: 'sk-test' }))
      const seededOnce = loadSettings()

      mockReadFileSync.mockReturnValue(JSON.stringify(seededOnce))
      const seededTwice = loadSettings()

      expect(seededTwice.toneMap).toEqual(seededOnce.toneMap)
    })
  })
})
