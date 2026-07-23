export interface OverlayInfo {
  sourceName: string
  stopHotkey: string
  recordingType: 'input' | 'output'
}

export interface DictationAPI {
  onActivate: (callback: () => void) => () => void
  onActivateOutput: (callback: () => void) => () => void
  onDeactivate: (callback: (sessionId: number) => void) => () => void
  onCancel: (callback: () => void) => () => void
  onStateChanged: (callback: (state: string) => void) => () => void
  onOverlayInfo: (callback: (info: OverlayInfo) => void) => () => void
  sendResult: (text: string, sessionId?: number) => Promise<void>
  transcribe: (audioData: ArrayBuffer, filename: string) => Promise<string>
}

export interface ModelInfo {
  id: string
  name: string
  size: string
  sizeBytes: number
  description: string
  filename: string
  url: string
}

export interface LocalModel {
  id: string
  name: string
  filename: string
  filepath: string
  size: number
  downloaded: boolean
}

export interface DownloadProgress {
  modelId: string
  percent: number
  downloadedBytes: number
  totalBytes: number
}

export interface ModelsAPI {
  available: () => Promise<ModelInfo[]>
  local: () => Promise<LocalModel[]>
  download: (modelId: string) => Promise<string>
  downloadCustom: (url: string, filename: string) => Promise<string>
  cancelDownload: (modelId: string) => Promise<boolean>
  delete: (modelId: string) => Promise<boolean>
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
}

// Context-aware tone (v1.5 Work Item B). Kept as its own local type — same
// "preload owns its own copy" convention as everything else in this file —
// rather than importing src/main/llm/prompts.ts's ToneProfileId (different
// electron-vite build target).
export type ToneProfileId = 'neutral' | 'casual' | 'formal' | 'technical'

export interface AppSettings {
  sttProvider: string
  providerChain: string[]
  openaiApiKey: string
  openaiBaseUrl: string
  whisperModel: string
  elevenlabsApiKey: string
  replicateApiKey: string
  sttReplicateModel: string
  groqApiKey: string
  sttGroqModel: string
  deepgramApiKey: string
  sttDeepgramModel: string
  assemblyaiApiKey: string
  sttAssemblyaiModel: string
  mistralApiKey: string
  sttMistralModel: string
  sttApiKey: string
  transcriptionLanguage: string
  transcriptionPrompt: string
  customVocabulary: string
  removedDefaultVocabulary: string[]
  aiPostProcessing: boolean
  cleanupEnabled: boolean
  cleanupMode: 'off' | 'light' | 'full'
  cleanupAuto: boolean
  cleanupTemplates: CleanupTemplate[]
  // Context-aware tone (v1.5 Work Item B) — see settingsManager.ts's
  // AppSettings for the full doc comment on these three fields.
  contextAwareTone: boolean
  toneMap: Record<string, ToneProfileId>
  windowTitlePermissionEnabled: boolean
  aiProvider: 'openai' | 'anthropic' | 'replicate' | 'local'
  aiBaseUrl: string
  aiModel: string
  anthropicApiKey: string
  launchAtStartup: boolean
  dictationHotkey: string
  dictateAndSendHotkey: string
  commandHotkey: string
  theme: 'dark' | 'light'
  accentColor: 'graphite' | 'blue' | 'teal' | 'emerald' | 'amber'
  inputDeviceId: string
  outputDeviceId: string
  saveRecordings: boolean
  outputRecordingHotkey: string
  fallbackEnabled: boolean
  githubUser: string
  githubRepo: string
  githubBranch: string
}

export interface CleanupTemplate {
  id: string
  name: string
  prompt: string
}

export interface SettingsAPI {
  load: () => Promise<AppSettings>
  save: (settings: Partial<AppSettings>) => Promise<AppSettings>
  pauseHotkeys: () => void
  resumeHotkeys: () => void
  onSetTab: (callback: (tab: string) => void) => () => void
  // Whether OS-backed secure storage is available for provider API keys (see
  // src/main/secure/keyStore.ts). Informational only — used to render an
  // honest hint next to key fields; never gates saving/loading.
  keyStorageAvailable: () => Promise<boolean>
}

export interface RecordingEntry {
  id: string
  filename: string
  filepath: string
  timestamp: number
  duration: number
  status: 'completed' | 'failed' | 'pending'
  provider: string
  transcription?: string
  error?: string
  size: number
  // ROUGH-FIRST on-demand cleanup result (v1.4 PR2) — additive, absent on
  // recordings that were never run through "Clean up". See recordingStore.ts.
  cleanedText?: string
  cleanedWith?: string
  // Context-aware tone (v1.5 Work Item B) — see recordingStore.ts's
  // RecordingEntry.recordedProcessName doc comment. Both optional/additive.
  recordedProcessName?: string
  recordedWindowTitle?: string
  // Group-conversation mode (multi-speaker transcription) — see
  // recordingStore.ts's RecordingEntry.segments doc comment. Both optional/
  // additive; absent on every plain recording.
  segments?: SpeakerSegment[]
  speakerNames?: Record<string, string>
}

/** Mirrors src/main/dictation/conversation.ts's SpeakerSegment. */
export interface SpeakerSegment {
  speaker: string
  start: number
  end: number
  text: string
}

export interface CleanupRequestOptions {
  /** Rule-based mode for the plain "Clean up (full/light)" menu item. Ignored
   * when templateId/customInstruction is set. */
  mode?: 'off' | 'light' | 'full'
  /** Id into settings.cleanupTemplates. Takes priority over `mode`. */
  templateId?: string
  /** Free-text instruction from the "Custom instruction..." field. Takes
   * priority over both `mode` and `templateId`. */
  customInstruction?: string
}

export interface CleanupRequestResult {
  text: string
  /** True only when the provider was reachable and produced a usable result.
   * False means fail-soft-to-raw — RecordingsPanel shows an inline
   * "AI unreachable — raw kept" hint rather than an error dialog. */
  ok: boolean
  cleanedWith: string
}

export interface RecordingsAPI {
  openWindow: () => void
  list: () => Promise<RecordingEntry[]>
  get: (id: string) => Promise<RecordingEntry | null>
  save: (audioData: ArrayBuffer, metadata: { duration: number; provider: string }) => Promise<RecordingEntry>
  update: (id: string, updates: Partial<RecordingEntry>) => Promise<RecordingEntry | null>
  delete: (id: string) => Promise<boolean>
  deleteAll: () => Promise<void>
  deleteByDate: (date: string) => Promise<void>
  getAudio: (id: string) => Promise<Buffer | null>
  reprocess: (id: string) => Promise<RecordingEntry | null>
  // ROUGH-FIRST on-demand cleanup (v1.4 PR2). See transcribe.ts's
  // cleanupOnDemand() for the main-process implementation this invokes —
  // NOTE: the ipcMain.handle('recordings:cleanup', ...) registration lives in
  // src/main/index.ts (analogous to the existing 'recordings:reprocess'
  // handler) and is NOT added here; wiring it up is a follow-up outside this
  // package's assigned files.
  cleanup: (id: string, options: CleanupRequestOptions) => Promise<CleanupRequestResult>
  // Group-conversation mode: rename a raw speaker id to a user-chosen
  // display name — persists to RecordingEntry.speakerNames and recomputes
  // the labeled `transcription` text server-side.
  renameSpeaker: (id: string, speakerId: string, name: string) => Promise<RecordingEntry | null>
}

export interface WhisperioError {
  category: string
  message: string
  provider: string
  timestamp: number
  rawError?: string
}

export interface ErrorAPI {
  onError: (callback: (error: WhisperioError) => void) => () => void
  getRecent: () => Promise<WhisperioError[]>
}

export interface WindowAPI {
  minimize: () => void
  maximize: () => void
  close: () => void
  getVersion: () => Promise<string>
}

export interface ServerStatus {
  status: 'stopped' | 'starting' | 'running' | 'error'
  model: string | null
  port: number
  error?: string
  platform: string
}

export interface ServerAPI {
  status: () => Promise<ServerStatus>
  start: (modelFilename: string) => Promise<ServerStatus>
  stop: () => Promise<ServerStatus>
  onStatusChanged: (callback: (status: ServerStatus) => void) => () => void
}

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdaterState {
  status: UpdaterStatus
  currentVersion: string
  version?: string
  percent?: number
  bytesPerSecond?: number
  error?: string
}

export interface UpdaterAPI {
  getStatus: () => Promise<UpdaterState>
  check: () => Promise<UpdaterState>
  install: () => Promise<boolean>
  onStatus: (callback: (state: UpdaterState) => void) => () => void
}

export interface GithubStatus {
  clientConfigured: boolean
  vaultAvailable: boolean
  connected: boolean
  user: string
  repo: string
  branch: string
}

export interface GithubConnectPrompt {
  userCode: string
  verificationUri: string
  expiresIn: number
}

export type GithubConnectPoll =
  | { status: 'authorized'; user: string }
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'error'; message: string }

export interface GithubRepoSummary {
  fullName: string
  private: boolean
  defaultBranch: string
}

export interface GithubSyncResult {
  ok: true
  path: string
  keys: string[]
}

export interface GithubAPI {
  status: () => Promise<GithubStatus>
  connect: () => Promise<GithubConnectPrompt>
  poll: () => Promise<GithubConnectPoll>
  listRepos: () => Promise<GithubRepoSummary[]>
  selectRepo: (fullName: string, branch: string) => Promise<GithubStatus>
  disconnect: () => Promise<GithubStatus>
  push: () => Promise<GithubSyncResult>
  pull: () => Promise<GithubSyncResult>
}

// PACZKA METERING (v1.6): per-provider/per-month usage + estimated cost. See
// src/main/usageTracker.ts for the ProviderMonthlyUsage shape this mirrors.
export interface UsageMonthly {
  requests: number
  inputTokens: number
  outputTokens: number
  audioSeconds: number
  estimatedCostUsd: number
  credits: number
}

/** providerId -> "YYYY-MM" -> usage for that provider that month. */
export type UsageStore = Record<string, Record<string, UsageMonthly>>

export interface UsageAPI {
  get: () => Promise<UsageStore>
  reset: () => Promise<UsageStore>
}

// Context-aware tone (v1.5 Work Item B). No `getContext`/live-read call is
// exposed to the renderer at all — the renderer never touches active-win
// even indirectly; it only ever triggers the ONE explicit permission-request
// action from Settings. See context.ts's file header for the privacy
// contract this is scoped by.
export interface ContextAPI {
  /** "Enable window-title matching" button (Settings). Triggers the macOS
   * Screen Recording permission prompt (fail-soft if denied/unsupported) and
   * persists windowTitlePermissionEnabled: true. Returns the updated settings. */
  enableWindowTitleMatching: () => Promise<AppSettings>
}

export interface ConversationAPI {
  /** Whether a diarizing provider (ElevenLabs/Deepgram/AssemblyAI) is
   * currently configured — gates the Conversation record button. */
  available: () => Promise<boolean>
  /** Transcribe + save a captured multi-speaker clip. Always resolves to the
   * saved RecordingEntry, even on a provider failure. */
  save: (audioData: ArrayBuffer, metadata: { duration: number; filename?: string }) => Promise<RecordingEntry>
}

export interface WhisperioAPI {
  dictation: DictationAPI
  settings: SettingsAPI
  recordings: RecordingsAPI
  models: ModelsAPI
  server: ServerAPI
  errors: ErrorAPI
  window: WindowAPI
  updater: UpdaterAPI
  github: GithubAPI
  usage: UsageAPI
  context: ContextAPI
  conversation: ConversationAPI
}

declare global {
  interface Window {
    api: WhisperioAPI
  }
}
