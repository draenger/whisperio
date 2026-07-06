import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
import { join } from 'path'

export type ProviderId = 'openai' | 'elevenlabs' | 'selfhosted'

export type AccentColor = 'graphite' | 'blue' | 'teal' | 'emerald' | 'amber' | 'violet'

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
  accentColor: AccentColor
  inputDeviceId: string
  outputDeviceId: string
  saveRecordings: boolean
  outputRecordingHotkey: string
  fallbackEnabled: boolean
  // GitHub secret-store selection (NON-SECRET metadata only). The access token
  // and the encryption key are never stored here — they live Keychain-wrapped
  // via secretVault.ts. Secrets themselves are only ever committed to the repo
  // as an AES-256-GCM envelope.
  githubUser: string
  githubRepo: string
  githubBranch: string
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
  } catch (err) {
    // A corrupt settings.json (e.g. truncated by a crash/power-loss mid-write)
    // must not silently wipe the user's API keys + config. Preserve the bad
    // file as `.corrupt` so the loss is visible and recoverable, then fall back
    // to defaults.
    try {
      const backupPath = `${filePath}.corrupt`
      renameSync(filePath, backupPath)
      console.error(
        `[Whisperio] settings.json was unreadable (${err instanceof Error ? err.message : String(err)}); ` +
        `backed up to ${backupPath} and reset to defaults.`
      )
    } catch (backupErr) {
      console.error('[Whisperio] Failed to back up corrupt settings.json:', backupErr)
    }
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const merged = { ...current, ...settings }
  const filePath = getSettingsPath()
  // Atomic write: serialize to a temp file then rename over settings.json
  // (atomic on the same volume). A crash mid-write leaves the previous, valid
  // settings.json intact instead of a truncated/corrupt file. Mirrors
  // recordingStore.saveIndex.
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf-8')
  renameSync(tmpPath, filePath)
  return merged
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return loadSettings()[key]
}
