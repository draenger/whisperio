import { app } from 'electron'
import { clampRestoreDelay } from './dictation/clipboardRestore'
import { readFileSync, writeFileSync, existsSync, renameSync, openSync, fsyncSync, closeSync, unlinkSync } from 'fs'
import { join } from 'path'
// Type-only — no runtime dependency on the LLM prompt-building module (same
// pattern postprocess.ts already uses for CleanupMode). prompts.ts owns
// ToneProfileId + its human-readable descriptions (Work Item B).
import type { ToneProfileId } from './llm/prompts'

export type ProviderId =
  | 'openai'
  | 'elevenlabs'
  | 'selfhosted'
  | 'replicate'
  | 'groq'
  | 'deepgram'
  | 'assemblyai'
  | 'mistral'

export type AccentColor = 'graphite' | 'blue' | 'teal' | 'emerald' | 'amber'

// AI transcript-cleanup settings (v1.4 Work Item A). 'off' disables cleanup
// entirely; 'light'/'full' select the prompt-rule set in llm/prompts.ts.
export type CleanupMode = 'off' | 'light' | 'full'

export type AiProvider = 'openai' | 'anthropic' | 'replicate' | 'local'

// A user-editable "format to X" preset for on-demand cleanup (ROUGH-FIRST
// UX: full cleanup only runs automatically when cleanupAuto is on; by
// default the raw transcript pastes instantly and the user picks one of
// these — or a one-off custom instruction — from RecordingsPanel afterward).
// `prompt` is handed to llm/prompts.ts's buildFormatMessages() verbatim as
// the transform instruction.
export interface CleanupTemplate {
  id: string
  name: string
  prompt: string
}

export interface AppSettings {
  sttProvider: 'openai' | 'elevenlabs'
  providerChain: ProviderId[]
  openaiApiKey: string
  openaiBaseUrl: string
  whisperModel: string
  elevenlabsApiKey: string
  // STT+ (v1.5): Replicate-hosted Whisper. `replicateApiKey` is shared with the
  // LLM side of the app (settings UI presents one "Replicate API key" field
  // that both the STT provider here and any future Replicate LLM candidate in
  // llm/provider.ts read from) — hence it's not named `sttReplicateApiKey`.
  // Empty string = provider unconfigured (see isProviderConfigured in
  // transcribe.ts). `sttReplicateModel` empty = the built-in default model
  // (see DEFAULT_REPLICATE_MODEL in transcribe.ts).
  replicateApiKey: string
  sttReplicateModel: string
  // Cloud STT+ (v1.6): BYO-key providers matching the mobile app's provider
  // chain (Groq/Deepgram/AssemblyAI/Mistral — see llm/groq.ts, llm/deepgram.ts,
  // llm/assembly.ts, llm/mistral.ts). Empty string = provider unconfigured,
  // same convention as replicateApiKey above. Each `stt<Provider>Model` is
  // empty = the client's built-in default model.
  groqApiKey: string
  sttGroqModel: string
  deepgramApiKey: string
  sttDeepgramModel: string
  assemblyaiApiKey: string
  sttAssemblyaiModel: string
  mistralApiKey: string
  sttMistralModel: string
  // STT+ (v1.5): Bearer token for a private/self-hosted STT server (the
  // `selfhosted` provider, which posts to `openaiBaseUrl`). Empty string (the
  // default) preserves today's behavior — no Authorization header is sent —
  // so existing self-hosted setups that don't require auth keep working
  // unchanged.
  sttApiKey: string
  transcriptionLanguage: string
  transcriptionPrompt: string
  customVocabulary: string
  removedDefaultVocabulary: string[]
  // Legacy AI-post-processing toggle — superseded by cleanupEnabled/cleanupMode
  // below (STEP1/Work Item A). Kept and never dropped (settings invariant): old
  // settings.json files still carry it, and migrateCleanupSettings() below reads
  // it once to seed the new keys the first time a legacy file is loaded.
  aiPostProcessing: boolean
  // Additive v1.4 cleanup settings. `cleanupEnabled` gates whether the
  // on-demand "Clean up" action (RecordingsPanel) is available at all —
  // default true, since it's an explicit per-recording opt-in action and
  // never runs on its own. `cleanupMode` is the rule-set used both by
  // auto-cleanup (when cleanupAuto is on) and as the default level for the
  // on-demand "Clean up" action.
  cleanupEnabled: boolean
  cleanupMode: CleanupMode
  // ROUGH-FIRST UX (v1.4 PR2): whether cleanup runs automatically right
  // after STT, before paste. Default OFF — by default the raw transcript
  // pastes instantly (zero latency, predictable) and cleanup becomes an
  // explicit on-demand action instead. See migrateCleanupSettings() below
  // for how this is seeded from the legacy aiPostProcessing boolean.
  cleanupAuto: boolean
  // On-demand "format to X" presets, editable in CleanupPanel. Additive —
  // always present (seeded from DEFAULT_CLEANUP_TEMPLATES), never migrated
  // away from a legacy shape since this key didn't exist before PR2.
  cleanupTemplates: CleanupTemplate[]
  // Context-aware tone (v1.5 Work Item B). Default OFF — when on, the
  // cleanup pipeline (transcribe.ts) reads the foreground app's process name
  // (see context.ts — the ONLY module that touches `active-win`) and maps it
  // to a tone profile via `toneMap` below, then feeds that profile's register
  // description (llm/prompts.ts's TONE_PROFILE_DESCRIPTIONS) into the same
  // "Tone profile:" slot buildCleanupMessages already had. Never affects RAW
  // text — only the rewrite cleanup produces, and only meaning-preserving
  // register, per CLEANUP_RULES rule 7.
  contextAwareTone: boolean
  // Lowercased-substring-of-processName -> tone profile, user-editable in
  // Settings. Seeded once from DEFAULT_TONE_MAP below on first load (same
  // "seed once, then fully user-editable, never re-merged" contract as
  // cleanupTemplates) — an empty `{}` a user saved on purpose is respected,
  // not re-seeded.
  toneMap: Record<string, ToneProfileId>
  // macOS only. Off by default: context.ts's getActiveContext() always omits
  // the Screen Recording permission request, so `windowTitle` comes back ''
  // and no permission prompt ever fires — processName alone is enough to
  // drive toneMap matching. Flipping this on (via the explicit "Enable
  // window-title matching" button in Settings, never silently) lets
  // getActiveContext() also request the window title, which is what actually
  // triggers the OS permission prompt the first time.
  windowTitlePermissionEnabled: boolean
  aiProvider: AiProvider
  // Empty string = provider-appropriate default (e.g. api.openai.com for 'openai').
  aiBaseUrl: string
  // Empty string = a sensible built-in default model for the selected provider.
  aiModel: string
  anthropicApiKey: string
  launchAtStartup: boolean
  // Allow whisperio://toggle|start|stop|cancel|send links to drive dictation (default OFF, fail closed).
  allowUrlControl: boolean
  // By URL, toggle/start (begin recording) additionally need this. `send` is never allowed by URL.
  allowUrlStart: boolean
  // Periodic GitHub release check (privacy policy section 6). Off => no network request to GitHub.
  checkForUpdates: boolean
  dictationHotkey: string
  dictateAndSendHotkey: string
  // COMMAND mode (v1.7): a dedicated hotkey that, instead of inserting the
  // spoken words, records a spoken INSTRUCTION and uses it to rewrite the
  // current clipboard text in place (see dictation/hotkeyManager.ts's
  // 'command' DictationState + transcribe.ts's rewriteClipboardForCommand).
  // Empty string = disabled (same "no candidates fallback" convention as
  // dictateAndSendHotkey/outputRecordingHotkey below — only the primary
  // dictationHotkey ever falls back to HOTKEY_CANDIDATES); defaulted non-empty
  // in DEFAULT_SETTINGS below so the feature is on out of the box.
  commandHotkey: string
  // Main dictation (+ dictate-and-send) hotkey behaviour: 'toggle' = press to
  // start, press again to stop; 'hold' = record while held, release to
  // transcribe (dictation/keyHold.ts; falls back to toggle where unsupported).
  hotkeyMode: 'toggle' | 'hold'
  // 'violet-legacy' (added in STEP0 theming wiring) was removed from the
  // product in VIOLET-OUT — see migrateLegacyTheme() below, which maps any
  // saved 'violet-legacy' value back to 'dark' on load.
  theme: 'dark' | 'light'
  accentColor: AccentColor
  inputDeviceId: string
  outputDeviceId: string
  saveRecordings: boolean
  /** Skip uploading recordings that contain no speech (RMS energy gate). */
  silenceGate: boolean
  /** Voiced-frame threshold in dBFS, clamped to -70..-30 (lower = more sensitive). */
  silenceGateThresholdDbfs: number
  trimSilence: boolean
  // Opt-in: after auto-paste, put the user's previous clipboard back (only if
  // the clipboard still holds the dictated text). See dictation/clipboardRestore.ts.
  restoreClipboard: boolean
  // Minimum wait (ms, clamped 300..3000) after the paste keystroke before the
  // previous clipboard is restored. Restore is a heuristic: there is no OS
  // "paste happened" event. Ignored while restoreClipboard is off (default).
  clipboardRestoreDelayMs: number
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

// Seed presets for the on-demand cleanup template picker (RecordingsPanel).
// Prompts are written in English but are language-agnostic in effect: each
// one explicitly tells the model to keep the input's language and never
// translate — see buildFormatMessages() in llm/prompts.ts, which also adds
// its own "keep the language" instruction on top of these regardless.
export const DEFAULT_CLEANUP_TEMPLATES: CleanupTemplate[] = [
  {
    id: 'email',
    name: 'Email',
    prompt:
      'Reformat this text into a polite, well-structured email. Keep the original language — do not translate. ' +
      'Add a brief greeting and sign-off if none are present. Preserve the meaning; do not invent details.'
  },
  {
    id: 'notes',
    name: 'Notes',
    prompt:
      'Reformat this text into concise, well-organized bullet-point notes. Keep the original language — do not ' +
      'translate. Group related points together and drop filler, but never drop meaningful content.'
  },
  {
    id: 'tasks',
    name: 'Task list',
    prompt:
      'Reformat this text into a checklist of concrete action items, one per line. Keep the original language — ' +
      'do not translate. Extract only actionable tasks; drop filler and commentary that isn\'t a task.'
  },
  {
    id: 'message',
    name: 'Message',
    prompt:
      'Reformat this text into a short, casual chat message, as if sending it to a colleague or friend. Keep the ' +
      'original language — do not translate. Keep it brief and natural.'
  }
]

// Seed for the app -> tone profile map (Context-aware tone, v1.5 Work Item
// B). Keys are lowercased substrings matched against the foreground
// process name (see context.ts's resolveToneProfile) — e.g. "code" matches
// both "Visual Studio Code" and "Code — Insiders". Purely a starting point:
// fully user-editable in Settings, and never re-applied over user edits once
// `toneMap` exists on disk (see migrateToneMap below).
export const DEFAULT_TONE_MAP: Record<string, ToneProfileId> = {
  slack: 'casual',
  discord: 'casual',
  whatsapp: 'casual',
  telegram: 'casual',
  gmail: 'formal',
  outlook: 'formal',
  mail: 'formal',
  vscode: 'technical',
  cursor: 'technical',
  windsurf: 'technical',
  jetbrains: 'technical',
  code: 'technical'
}

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
  // `customVocabulary` now holds only the user's own additional terms; the
  // built-in seed lives in DEFAULT_VOCABULARY_TERMS and is merged in at
  // read-time via getActiveVocabulary().
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
 * Migrate the legacy `aiPostProcessing` boolean into the ROUGH-FIRST v1.4 PR2
 * cleanup keys. Runs ONLY when the saved JSON has no `cleanupAuto` yet —
 * that's the one key this migration owns, so guarding on it (rather than
 * `cleanupEnabled`/`cleanupMode`, which an earlier PR1 migration may already
 * have set) makes this idempotent AND still fires exactly once for a file
 * that went through PR1's migration but predates `cleanupAuto` entirely.
 * `aiPostProcessing` itself is never dropped (settings invariant).
 *
 * Note this seeds `cleanupAuto`, NOT `cleanupEnabled`: cleanupEnabled now
 * means "the on-demand Clean up action is available at all" (default true,
 * unrelated to whether the user used to have auto-cleanup on), so the
 * legacy flag no longer touches it — only whether auto-cleanup opts in.
 *
 * true  -> cleanupAuto: true,  cleanupMode: 'full' if not already set
 *          (previous behavior: cleanup ran automatically on every dictation)
 * false -> cleanupAuto: false                        (mode untouched)
 */
function migrateCleanupSettings(parsed: Partial<AppSettings>): Partial<AppSettings> {
  if (parsed.cleanupAuto !== undefined) {
    return parsed
  }
  if (parsed.aiPostProcessing === undefined) {
    return parsed
  }
  return parsed.aiPostProcessing
    ? { ...parsed, cleanupAuto: true, cleanupMode: parsed.cleanupMode ?? 'full' }
    : { ...parsed, cleanupAuto: false }
}

/**
 * Migrate the removed 'violet-legacy' theme and 'violet' accent values
 * (VIOLET-OUT: violet is gone from the product entirely) into their closest
 * still-supported equivalents. Old shipped builds may have persisted either
 * value to settings.json; this only ever remaps those two literal values, so
 * it's idempotent — a second load of an already-migrated (or never-violet)
 * file is a no-op. Keys are never dropped, only the value is mapped, per the
 * settings invariant.
 *
 * theme:       'violet-legacy' -> 'dark'
 * accentColor: 'violet'        -> 'teal'
 */
function migrateLegacyTheme(parsed: Partial<AppSettings>): Partial<AppSettings> {
  const raw = parsed as Record<string, unknown>
  const migrated: Partial<AppSettings> = { ...parsed }
  if (raw.theme === 'violet-legacy') {
    migrated.theme = 'dark'
  }
  if (raw.accentColor === 'violet') {
    migrated.accentColor = 'teal'
  }
  return migrated
}

/**
 * Seed `toneMap` the first time a settings file loads without one (fresh
 * installs and every pre-v1.5.x file alike) — same "seed once, then fully
 * user-editable, never re-merged" contract as cleanupTemplates. Idempotent:
 * guarded on `toneMap === undefined`, so a second load of an already-seeded
 * file (even one a user edited down to `{}`) is a no-op. Always hands back a
 * fresh copy of DEFAULT_TONE_MAP rather than the shared module constant, so
 * nothing downstream can mutate it in place.
 */
function migrateToneMap(parsed: Partial<AppSettings>): Partial<AppSettings> {
  if (parsed.toneMap !== undefined) return parsed
  return { ...parsed, toneMap: { ...DEFAULT_TONE_MAP } }
}

// A transient lock (antivirus, backup agent, indexer) on settings.json must
// never be mistaken for corruption: retry, then fall back to in-memory
// defaults WITHOUT ever overwriting the file.
const TRANSIENT_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const READ_RETRIES = 5
const READ_BACKOFF_MS = [25, 50, 100, 200]
const RENAME_RETRIES = 5

let sleepImpl: (ms: number) => void = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Test hook: replace the blocking sleep; call with no arg to restore. */
export function setSleepSyncForTests(fn?: (ms: number) => void): void {
  sleepImpl = fn ?? ((ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) })
}

function errCode(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : 'unknown'
}

function isTransient(err: unknown): boolean {
  return TRANSIENT_CODES.has(errCode(err))
}

// True while the on-disk settings could not be read (transient lock that
// outlasted the retries, or a corrupt file that could not be moved aside).
// Defaults are served from memory and saveSettings refuses to write, so the
// user's real file is never clobbered. Re-evaluated on every loadSettings().
let settingsUnavailable = false

/** True when the last load could not read settings.json (saves are refused). */
export function areSettingsUnavailable(): boolean {
  return settingsUnavailable
}

class SettingsUnavailableError extends Error {
  constructor() {
    super('Settings file could not be read; refusing to overwrite it. Try again shortly.')
    this.name = 'SettingsUnavailableError'
  }
}

function readSettingsText(filePath: string): string {
  for (let attempt = 0; ; attempt++) {
    try {
      return readFileSync(filePath, 'utf-8')
    } catch (err) {
      if (attempt < READ_RETRIES - 1 && isTransient(err)) {
        sleepImpl(READ_BACKOFF_MS[Math.min(attempt, READ_BACKOFF_MS.length - 1)])
        continue
      }
      throw err
    }
  }
}

/** Move a corrupt settings file aside to a fresh timestamped name. Never overwrites a backup. */
function quarantineCorrupt(filePath: string): boolean {
  const base = filePath.replace(/\.json$/i, '')
  const stamp = Date.now()
  for (let n = 0; n < 100; n++) {
    const candidate = `${base}.corrupt-${stamp}${n === 0 ? '' : `-${n}`}.json`
    if (existsSync(candidate)) continue
    try {
      renameSync(filePath, candidate)
      console.error(`[Whisperio] settings.json was corrupt; moved aside to ${candidate} and reset to defaults.`)
      return true
    } catch (err) {
      console.error(`[Whisperio] Failed to move corrupt settings.json aside (${errCode(err)}).`)
      return false
    }
  }
  return false
}

export function clampSilenceGateThreshold(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.NaN
  if (!Number.isFinite(n)) return -50
  return Math.min(-30, Math.max(-70, n))
}

export function loadSettings(): AppSettings {
  const filePath = getSettingsPath()
  if (!existsSync(filePath)) {
    settingsUnavailable = false
    return { ...DEFAULT_SETTINGS }
  }
  let raw: string
  try {
    raw = readSettingsText(filePath)
  } catch (err) {
    // Not corruption: leave the file alone, serve defaults, refuse saves.
    settingsUnavailable = true
    console.error(`[Whisperio] settings.json could not be read (${errCode(err)}); using defaults in memory, saves disabled until it is readable.`)
    return { ...DEFAULT_SETTINGS }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // Syntax error or wrong shape: genuinely corrupt (e.g. truncated by a
    // crash). Preserve it so the loss is recoverable, then use defaults.
    settingsUnavailable = !quarantineCorrupt(filePath)
    return { ...DEFAULT_SETTINGS }
  }
  settingsUnavailable = false
  const migrated = migrateToneMap(migrateLegacyTheme(migrateCleanupSettings(migrateVocabulary(parsed as Partial<AppSettings>))))
  const merged = { ...DEFAULT_SETTINGS, ...migrated }
  merged.clipboardRestoreDelayMs = clampRestoreDelay(merged.clipboardRestoreDelayMs)
  if (merged.hotkeyMode !== 'toggle' && merged.hotkeyMode !== 'hold') merged.hotkeyMode = 'toggle'
  merged.silenceGateThresholdDbfs = clampSilenceGateThreshold(merged.silenceGateThresholdDbfs)
  return merged
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  if (settingsUnavailable) throw new SettingsUnavailableError()
  const merged = { ...current, ...settings }
  const filePath = getSettingsPath()
  // Durable atomic write: temp file -> fsync -> rename over settings.json.
  // A crash/power loss leaves the previous, valid file or the complete new one.
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf-8')
    const fd = openSync(tmpPath, 'r+')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(tmpPath, filePath)
        break
      } catch (err) {
        if (attempt < RENAME_RETRIES - 1 && isTransient(err)) {
          sleepImpl(READ_BACKOFF_MS[Math.min(attempt, READ_BACKOFF_MS.length - 1)])
          continue
        }
        throw err
      }
    }
  } catch (err) {
    try { unlinkSync(tmpPath) } catch { /* best-effort cleanup */ }
    throw err
  }
  return merged
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return loadSettings()[key]
}
