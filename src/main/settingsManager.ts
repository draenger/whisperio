import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export type ProviderId = 'openai' | 'elevenlabs' | 'selfhosted'

export interface AppSettings {
  sttProvider: 'openai' | 'elevenlabs'
  providerChain: ProviderId[]
  openaiApiKey: string
  openaiBaseUrl: string
  whisperModel: string
  elevenlabsApiKey: string
  transcriptionLanguage: string
  transcriptionPrompt: string
  customVocabulary: string
  aiPostProcessing: boolean
  launchAtStartup: boolean
  dictationHotkey: string
  dictateAndSendHotkey: string
  theme: 'dark' | 'light'
  inputDeviceId: string
  outputDeviceId: string
  saveRecordings: boolean
  outputRecordingHotkey: string
  fallbackEnabled: boolean
}

const DEFAULT_VOCABULARY = [
  'git', 'GitHub', 'npm', 'yarn', 'pnpm', 'pip', 'Docker', 'Kubernetes', 'kubectl',
  'TypeScript', 'JavaScript', 'React', 'Next.js', 'Node.js', 'VS Code', 'API', 'CLI',
  'SSH', 'YAML', 'JSON', 'REST', 'GraphQL', 'webpack', 'ESLint', 'Prettier',
  'PostgreSQL', 'MongoDB', 'Redis', 'AWS', 'Azure', 'Terraform', 'CI/CD', 'DevOps',
  'localhost', 'regex', 'boolean', 'middleware', 'endpoint', 'repository', 'README',
  'Vite', 'Vitest', 'Electron', 'Python', 'FastAPI', 'Whisper', 'OpenAI'
].join(', ')

const DEFAULT_SETTINGS: AppSettings = {
  sttProvider: 'openai',
  providerChain: ['openai'],
  openaiApiKey: '',
  openaiBaseUrl: '',
  whisperModel: '',
  elevenlabsApiKey: '',
  transcriptionLanguage: 'auto',
  transcriptionPrompt: '',
  customVocabulary: DEFAULT_VOCABULARY,
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

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  const filePath = getSettingsPath()
  if (!existsSync(filePath)) {
    return { ...DEFAULT_SETTINGS }
  }
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const merged = { ...current, ...settings }
  const filePath = getSettingsPath()
  writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return loadSettings()[key]
}
