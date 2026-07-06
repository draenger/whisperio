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
  removedDefaultVocabulary: string[]
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
}

// Canonical seed source for the built-in vocabulary. This is the immutable
// "defaults" list — it is never hard-deleted. Users soft-delete individual
// entries via `removedDefaultVocabulary`, and "restore defaults" simply clears
// that set. Keep this list in sync with the renderer copy in SettingsForm.tsx.
export const DEFAULT_VOCABULARY_TERMS: string[] = [
  'git', 'GitHub', 'npm', 'yarn', 'pnpm', 'pip', 'Docker', 'Kubernetes', 'kubectl',
  'TypeScript', 'JavaScript', 'React', 'Next.js', 'Node.js', 'VS Code', 'API', 'CLI',
  'SSH', 'YAML', 'JSON', 'REST', 'GraphQL', 'webpack', 'ESLint', 'Prettier',
  'PostgreSQL', 'MongoDB', 'Redis', 'AWS', 'Azure', 'Terraform', 'CI/CD', 'DevOps',
  'localhost', 'regex', 'boolean', 'middleware', 'endpoint', 'repository', 'README',
  'Vite', 'Vitest', 'Electron', 'Python', 'FastAPI', 'Whisper', 'OpenAI'
]

function splitTerms(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * The effective vocabulary actually handed to the transcription providers:
 * the active (non-soft-deleted) default terms followed by the user's own
 * additional terms, de-duplicated case-insensitively. Returned as a
 * comma-separated string to match the shape the providers already consume.
 */
export function getActiveVocabulary(settings: AppSettings): string {
  const removed = new Set((settings.removedDefaultVocabulary ?? []).map((t) => t.toLowerCase()))
  const activeDefaults = DEFAULT_VOCABULARY_TERMS.filter((t) => !removed.has(t.toLowerCase()))
  const custom = splitTerms(settings.customVocabulary ?? '')
  const seen = new Set<string>()
  const out: string[] = []
  for (const term of [...activeDefaults, ...custom]) {
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(term)
  }
  return out.join(', ')
}

const DEFAULT_SETTINGS: AppSettings = {
  sttProvider: 'openai',
  providerChain: ['openai'],
  openaiApiKey: '',
  openaiBaseUrl: '',
  whisperModel: '',
  elevenlabsApiKey: '',
  transcriptionLanguage: 'auto',
  transcriptionPrompt: '',
  // `customVocabulary` now holds only the user's own additional terms; the
  // built-in seed lives in DEFAULT_VOCABULARY_TERMS and is merged in at
  // read-time via getActiveVocabulary().
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
  fallbackEnabled: false
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/**
 * Migrate legacy (pre-soft-delete) settings. Old files stored the entire
 * vocabulary — defaults + user additions — flattened into `customVocabulary`
 * with no `removedDefaultVocabulary`. Reconstruct the soft-delete state
 * losslessly: any default term the user had stripped out becomes soft-deleted,
 * and any remaining terms that aren't defaults become their own additions.
 */
function migrateVocabulary(parsed: Partial<AppSettings>): Partial<AppSettings> {
  if (parsed.removedDefaultVocabulary !== undefined || typeof parsed.customVocabulary !== 'string') {
    return parsed
  }
  const terms = splitTerms(parsed.customVocabulary)
  const present = new Set(terms.map((t) => t.toLowerCase()))
  const defaultKeys = new Set(DEFAULT_VOCABULARY_TERMS.map((t) => t.toLowerCase()))
  const removedDefaultVocabulary = DEFAULT_VOCABULARY_TERMS.filter((t) => !present.has(t.toLowerCase()))
  const additions = terms.filter((t) => !defaultKeys.has(t.toLowerCase()))
  return { ...parsed, removedDefaultVocabulary, customVocabulary: additions.join(', ') }
}

export function loadSettings(): AppSettings {
  const filePath = getSettingsPath()
  if (!existsSync(filePath)) {
    return { ...DEFAULT_SETTINGS }
  }
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...migrateVocabulary(parsed) }
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
