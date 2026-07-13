import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
import { join } from 'path'

export type ProviderId = 'openai' | 'elevenlabs' | 'selfhosted'

export type AccentColor = 'graphite' | 'blue' | 'teal' | 'emerald' | 'amber' | 'violet'

// AI transcript-cleanup settings (v1.4 Work Item A). 'off' disables cleanup
// entirely; 'light'/'full' select the prompt-rule set in llm/prompts.ts.
export type CleanupMode = 'off' | 'light' | 'full'

export type AiProvider = 'openai' | 'anthropic' | 'local'

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
  // Legacy AI-post-processing toggle — superseded by cleanupEnabled/cleanupMode
  // below (STEP1/Work Item A). Kept and never dropped (settings invariant): old
  // settings.json files still carry it, and migrateCleanupSettings() below reads
  // it once to seed the new keys the first time a legacy file is loaded.
  aiPostProcessing: boolean
  // Additive v1.4 cleanup settings. All migrated losslessly from
  // aiPostProcessing on first load of a pre-v1.4 settings.json — see
  // migrateCleanupSettings().
  cleanupEnabled: boolean
  cleanupMode: CleanupMode
  aiProvider: AiProvider
  // Empty string = provider-appropriate default (e.g. api.openai.com for 'openai').
  aiBaseUrl: string
  // Empty string = a sensible built-in default model for the selected provider.
  aiModel: string
  anthropicApiKey: string
  launchAtStartup: boolean
  dictationHotkey: string
  dictateAndSendHotkey: string
  // 'violet-legacy' added in STEP0 theming wiring — additive, no migration
  // needed: old settings.json files only ever contain 'dark'/'light' and the
  // renderer's ThemeProvider coerces any unrecognized string to 'dark'.
  theme: 'dark' | 'light' | 'violet-legacy'
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
  cleanupEnabled: true,
  cleanupMode: 'full',
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

/**
 * Migrate the legacy `aiPostProcessing` boolean into the v1.4 cleanup keys.
 * Runs ONLY when the saved JSON has neither `cleanupEnabled` nor
 * `cleanupMode` yet — that makes it idempotent (a second load of the same
 * file, migrated or not, is a no-op) and additive: `aiPostProcessing` itself
 * is never dropped from the returned object, so older app versions (or a
 * future rollback) can still read it.
 *
 * true  -> cleanupEnabled: true,  cleanupMode: 'full' (previous behavior: on)
 * false -> cleanupEnabled: false                       (mode stays default)
 */
function migrateCleanupSettings(parsed: Partial<AppSettings>): Partial<AppSettings> {
  if (parsed.cleanupEnabled !== undefined || parsed.cleanupMode !== undefined) {
    return parsed
  }
  if (parsed.aiPostProcessing === undefined) {
    return parsed
  }
  return parsed.aiPostProcessing
    ? { ...parsed, cleanupEnabled: true, cleanupMode: 'full' }
    : { ...parsed, cleanupEnabled: false }
}

export function loadSettings(): AppSettings {
  const filePath = getSettingsPath()
  if (!existsSync(filePath)) {
    return { ...DEFAULT_SETTINGS }
  }
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const migrated = migrateCleanupSettings(migrateVocabulary(parsed))
    return { ...DEFAULT_SETTINGS, ...migrated }
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
