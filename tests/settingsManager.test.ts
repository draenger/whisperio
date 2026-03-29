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

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args)
}))

import { loadSettings, saveSettings, getSetting } from '../src/main/settingsManager'

const DEFAULT_SETTINGS = {
  sttProvider: 'openai',
  providerChain: ['openai'],
  openaiApiKey: '',
  openaiBaseUrl: '',
  whisperModel: '',
  elevenlabsApiKey: '',
  transcriptionLanguage: 'auto',
  transcriptionPrompt: '',
  customVocabulary:
    'git, GitHub, npm, yarn, pnpm, pip, Docker, Kubernetes, kubectl, TypeScript, JavaScript, React, Next.js, Node.js, VS Code, API, CLI, SSH, YAML, JSON, REST, GraphQL, webpack, ESLint, Prettier, PostgreSQL, MongoDB, Redis, AWS, Azure, Terraform, CI/CD, DevOps, localhost, regex, boolean, middleware, endpoint, repository, README, Vite, Vitest, Electron, Python, FastAPI, Whisper, OpenAI',
  aiPostProcessing: false,
  launchAtStartup: true,
  dictationHotkey: '',
  dictateAndSendHotkey: '',
  theme: 'dark',
  inputDeviceId: '',
  outputDeviceId: '',
  saveRecordings: true,
  outputRecordingHotkey: '',
  fallbackEnabled: false
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
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        SETTINGS_PATH,
        JSON.stringify(result, null, 2),
        'utf-8'
      )
    })
  })

  describe('getSetting', () => {
    it('returns a specific setting value', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({ openaiApiKey: 'sk-123' }))
      expect(getSetting('openaiApiKey')).toBe('sk-123')
    })
  })
})
