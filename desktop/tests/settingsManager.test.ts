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
const mockOpenSync = vi.fn(() => 42)
const mockFsyncSync = vi.fn()
const mockCloseSync = vi.fn()
const mockUnlinkSync = vi.fn()

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args),
  openSync: (...args: unknown[]) => mockOpenSync(...args),
  fsyncSync: (...args: unknown[]) => mockFsyncSync(...args),
  closeSync: (...args: unknown[]) => mockCloseSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args)
}))

import {
  loadSettings,
  saveSettings,
  getSetting,
  getActiveVocabulary,
  areSettingsUnavailable,
  setSleepSyncForTests,
  DEFAULT_VOCABULARY_TERMS,
  DEFAULT_CLEANUP_TEMPLATES,
  DEFAULT_TONE_MAP,
  type AppSettings
} from '../src/main/settingsManager'

const DEFAULT_SETTINGS = {
  experimentalParakeet: false,
  sttProvider: 'openai',
  providerChain: ['openai'],
  openaiApiKey: '',
  openaiBaseUrl: '',
  whisperModel: '',
  elevenlabsApiKey: '',
  replicateApiKey: '',
  sttReplicateModel: '',
  groqApiKey: '',
  sttGroqModel: '',
  deepgramApiKey: '',
  sttDeepgramModel: '',
  assemblyaiApiKey: '',
  sttAssemblyaiModel: '',
  mistralApiKey: '',
  sttMistralModel: '',
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
  allowUrlControl: false,
  allowUrlStart: false,
  checkForUpdates: true,
  dictationHotkey: '',
  dictateAndSendHotkey: '',
  commandHotkey: 'Ctrl+Shift+C',
  hotkeyMode: 'toggle',
  theme: 'dark',
  accentColor: 'blue',
  inputDeviceId: '',
  outputDeviceId: '',
  saveRecordings: true,
  silenceGate: false,
  silenceGateThresholdDbfs: -50,
  trimSilence: false,
  restoreClipboard: false,
  clipboardRestoreDelayMs: 700,
  outputRecordingHotkey: '',
  fallbackEnabled: false,
  githubUser: '',
  githubRepo: '',
  githubBranch: ''
}

const SETTINGS_PATH = join('/mock/userData', 'settings.json')

describe('settingsManager', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockOpenSync.mockReturnValue(42)
    setSleepSyncForTests(() => {})
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

  describe('read errors vs corruption + durable saves', () => {
    const ebusy = (): Error => Object.assign(new Error('busy'), { code: 'EBUSY' })

    it('persistent EBUSY: defaults in memory, save refused, file untouched', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation(() => { throw ebusy() })
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
      expect(areSettingsUnavailable()).toBe(true)
      expect(() => saveSettings({ openaiApiKey: 'sk-x' })).toThrow(/refusing to overwrite/)
      expect(mockRenameSync).not.toHaveBeenCalled()
      expect(mockWriteFileSync).not.toHaveBeenCalled()
      expect(mockUnlinkSync).not.toHaveBeenCalled()
    })

    it('logs the error code only on read failure', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation(() => { throw ebusy() })
      loadSettings()
      const logged = spy.mock.calls.flat().join(' ')
      expect(logged).toContain('EBUSY')
      expect(logged).not.toContain('busy')
      spy.mockRestore()
    })

    it('transient EBUSY once: retries and returns real settings', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync
        .mockImplementationOnce(() => { throw ebusy() })
        .mockReturnValue(JSON.stringify({ openaiApiKey: 'sk-real' }))
      const r = loadSettings()
      expect(r.openaiApiKey).toBe('sk-real')
      expect(areSettingsUnavailable()).toBe(false)
    })

    it('recovers on next load after unavailable', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockImplementation(() => { throw ebusy() })
      loadSettings()
      expect(areSettingsUnavailable()).toBe(true)
      mockReadFileSync.mockReset()
      mockReadFileSync.mockReturnValue(JSON.stringify({ openaiApiKey: 'sk-real' }))
      expect(loadSettings().openaiApiKey).toBe('sk-real')
      expect(areSettingsUnavailable()).toBe(false)
    })

    it('corrupt JSON: timestamped backup, defaults', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_PATH)
      mockReadFileSync.mockReturnValue('{"a":')
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
      expect(mockRenameSync).toHaveBeenCalledTimes(1)
      const [from, to] = mockRenameSync.mock.calls[0]
      expect(from).toBe(SETTINGS_PATH)
      expect(String(to)).toMatch(/settings\.corrupt-\d+\.json$/)
      expect(areSettingsUnavailable()).toBe(false)
    })

    it('wrong shape (array) counts as corrupt', () => {
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_PATH)
      mockReadFileSync.mockReturnValue('[1,2]')
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
      expect(mockRenameSync).toHaveBeenCalledTimes(1)
    })

    it('never overwrites an existing backup', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1000)
      const taken = join('/mock/userData', 'settings.corrupt-1000.json')
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_PATH || p === taken)
      mockReadFileSync.mockReturnValue('nope')
      loadSettings()
      const to = String(mockRenameSync.mock.calls[0][1])
      expect(to).not.toBe(taken)
      expect(to).toMatch(/settings\.corrupt-1000-1\.json$/)
      vi.restoreAllMocks()
    })

    it('corrupt file that cannot be moved aside: unavailable, no overwrite', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockExistsSync.mockImplementation((p: string) => p === SETTINGS_PATH)
      mockReadFileSync.mockReturnValue('nope')
      mockRenameSync.mockImplementation(() => { throw ebusy() })
      loadSettings()
      expect(areSettingsUnavailable()).toBe(true)
      expect(() => saveSettings({})).toThrow()
      spy.mockRestore()
    })

    it('fsync happens after write and before rename', () => {
      mockExistsSync.mockReturnValue(false)
      const order: string[] = []
      mockWriteFileSync.mockImplementation(() => { order.push('write') })
      mockOpenSync.mockImplementation(() => { order.push('open'); return 7 })
      mockFsyncSync.mockImplementation(() => { order.push('fsync') })
      mockCloseSync.mockImplementation(() => { order.push('close') })
      mockRenameSync.mockImplementation(() => { order.push('rename') })
      saveSettings({})
      expect(order).toEqual(['write', 'open', 'fsync', 'close', 'rename'])
      expect(mockFsyncSync).toHaveBeenCalledWith(7)
    })

    it('removes tmp when rename fails', () => {
      mockExistsSync.mockReturnValue(false)
      mockRenameSync.mockImplementation(() => { throw Object.assign(new Error('x'), { code: 'ENOSPC' }) })
      expect(() => saveSettings({})).toThrow()
      expect(mockUnlinkSync).toHaveBeenCalledTimes(1)
      expect(String(mockUnlinkSync.mock.calls[0][0]).endsWith('.tmp')).toBe(true)
    })

    it('retries a transient rename error then succeeds', () => {
      mockExistsSync.mockReturnValue(false)
      mockRenameSync.mockImplementationOnce(() => { throw ebusy() }).mockImplementation(() => {})
      expect(() => saveSettings({})).not.toThrow()
      expect(mockRenameSync).toHaveBeenCalledTimes(2)
      expect(mockUnlinkSync).not.toHaveBeenCalled()
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

describe('allowUrlControl / allowUrlStart defaults (fail closed)', () => {
  it('both default to false when absent from the file', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ openaiApiKey: 'sk-x' }))
    const r = loadSettings()
    expect(r.allowUrlControl).toBe(false)
    expect(r.allowUrlStart).toBe(false)
  })
  it('keeps an explicit true', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ allowUrlControl: true, allowUrlStart: true }))
    const r = loadSettings()
    expect(r.allowUrlControl).toBe(true)
    expect(r.allowUrlStart).toBe(true)
  })
})

describe('silenceGate defaults and threshold clamp', () => {
  function loadWith(obj: unknown): AppSettings {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(obj))
    return loadSettings()
  }
  it('is opt-in (false) with threshold -50 when absent', () => {
    const r = loadWith({ openaiApiKey: 'sk-x' })
    expect(r.silenceGate).toBe(false)
    expect(r.silenceGateThresholdDbfs).toBe(-50)
  })
  it('keeps an in-range threshold and an explicit true gate', () => {
    const r = loadWith({ silenceGate: true, silenceGateThresholdDbfs: -60 })
    expect(r.silenceGate).toBe(true)
    expect(r.silenceGateThresholdDbfs).toBe(-60)
  })
  it('clamps to -70..-30 and replaces junk with the default', () => {
    expect(loadWith({ silenceGateThresholdDbfs: -120 }).silenceGateThresholdDbfs).toBe(-70)
    expect(loadWith({ silenceGateThresholdDbfs: 0 }).silenceGateThresholdDbfs).toBe(-30)
    expect(loadWith({ silenceGateThresholdDbfs: 'loud' }).silenceGateThresholdDbfs).toBe(-50)
    expect(loadWith({ silenceGateThresholdDbfs: null }).silenceGateThresholdDbfs).toBe(-50)
  })
})
