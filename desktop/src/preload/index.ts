import { contextBridge, ipcRenderer } from 'electron'

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

export interface AppSettings {
  sttProvider: string
  providerChain: string[]
  openaiApiKey: string
  openaiBaseUrl: string
  whisperModel: string
  elevenlabsApiKey: string
  replicateApiKey: string
  sttReplicateModel: string
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
  aiProvider: 'openai' | 'anthropic' | 'replicate' | 'local'
  aiBaseUrl: string
  aiModel: string
  anthropicApiKey: string
  launchAtStartup: boolean
  dictationHotkey: string
  dictateAndSendHotkey: string
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
// src/main/usageTracker.ts for the ProviderMonthlyUsage shape this mirrors —
// kept as a separate type here (repo convention: preload's AppSettings/
// RecordingEntry etc. are their own copies too, not re-exports of main-process
// types) so the renderer bundle never pulls in main-process-only modules.
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
}

const dictationApi: DictationAPI = {
  onActivate: (callback: () => void) => {
    ipcRenderer.on('dictation:activate', callback)
    return () => {
      ipcRenderer.removeListener('dictation:activate', callback)
    }
  },
  onActivateOutput: (callback: () => void) => {
    ipcRenderer.on('dictation:activate-output', callback)
    return () => {
      ipcRenderer.removeListener('dictation:activate-output', callback)
    }
  },
  onDeactivate: (callback: (sessionId: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: number): void => {
      callback(sessionId)
    }
    ipcRenderer.on('dictation:deactivate', handler)
    return () => {
      ipcRenderer.removeListener('dictation:deactivate', handler)
    }
  },
  onCancel: (callback: () => void) => {
    ipcRenderer.on('dictation:cancel', callback)
    return () => {
      ipcRenderer.removeListener('dictation:cancel', callback)
    }
  },
  onStateChanged: (callback: (state: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: string): void => {
      callback(state)
    }
    ipcRenderer.on('dictation:state-changed', handler)
    return () => {
      ipcRenderer.removeListener('dictation:state-changed', handler)
    }
  },
  onOverlayInfo: (callback: (info: OverlayInfo) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: OverlayInfo): void => {
      callback(info)
    }
    ipcRenderer.on('dictation:overlay-info', handler)
    return () => {
      ipcRenderer.removeListener('dictation:overlay-info', handler)
    }
  },
  sendResult: (text: string, sessionId?: number) =>
    ipcRenderer.invoke('dictation:result', text, sessionId),
  transcribe: (audioData: ArrayBuffer, filename: string) =>
    ipcRenderer.invoke('dictation:transcribe', Buffer.from(audioData), filename)
}

const settingsApi: SettingsAPI = {
  load: () => ipcRenderer.invoke('settings:load'),
  save: (settings) => ipcRenderer.invoke('settings:save', settings),
  pauseHotkeys: () => ipcRenderer.send('hotkeys:pause'),
  resumeHotkeys: () => ipcRenderer.send('hotkeys:resume'),
  onSetTab: (callback) => {
    const handler = (_e: unknown, tab: string): void => callback(tab)
    ipcRenderer.on('settings:set-tab', handler)
    return () => {
      ipcRenderer.removeListener('settings:set-tab', handler)
    }
  }
}

const recordingsApi: RecordingsAPI = {
  openWindow: () => ipcRenderer.send('recordings:openWindow'),
  list: () => ipcRenderer.invoke('recordings:list'),
  get: (id) => ipcRenderer.invoke('recordings:get', id),
  save: (audioData, metadata) =>
    ipcRenderer.invoke('recordings:save', Buffer.from(audioData), metadata),
  update: (id, updates) => ipcRenderer.invoke('recordings:update', id, updates),
  delete: (id) => ipcRenderer.invoke('recordings:delete', id),
  deleteAll: () => ipcRenderer.invoke('recordings:deleteAll'),
  deleteByDate: (date) => ipcRenderer.invoke('recordings:deleteByDate', date),
  getAudio: (id) => ipcRenderer.invoke('recordings:getAudio', id),
  reprocess: (id) => ipcRenderer.invoke('recordings:reprocess', id),
  cleanup: (id, options) => ipcRenderer.invoke('recordings:cleanup', id, options)
}

const errorsApi: ErrorAPI = {
  onError: (callback: (error: WhisperioError) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: WhisperioError): void => {
      callback(error)
    }
    ipcRenderer.on('errors:new', handler)
    return () => {
      ipcRenderer.removeListener('errors:new', handler)
    }
  },
  getRecent: () => ipcRenderer.invoke('errors:getRecent')
}

const modelsApi: ModelsAPI = {
  available: () => ipcRenderer.invoke('models:available'),
  local: () => ipcRenderer.invoke('models:local'),
  download: (modelId) => ipcRenderer.invoke('models:download', modelId),
  downloadCustom: (url, filename) => ipcRenderer.invoke('models:downloadCustom', url, filename),
  cancelDownload: (modelId) => ipcRenderer.invoke('models:cancelDownload', modelId),
  delete: (modelId) => ipcRenderer.invoke('models:delete', modelId),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: DownloadProgress): void => {
      callback(progress)
    }
    ipcRenderer.on('models:download-progress', handler)
    return () => {
      ipcRenderer.removeListener('models:download-progress', handler)
    }
  }
}

const serverApi: ServerAPI = {
  status: () => ipcRenderer.invoke('server:status'),
  start: (modelFilename) => ipcRenderer.invoke('server:start', modelFilename),
  stop: () => ipcRenderer.invoke('server:stop'),
  onStatusChanged: (callback: (status: ServerStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: ServerStatus): void => {
      callback(status)
    }
    ipcRenderer.on('server:status-changed', handler)
    return () => {
      ipcRenderer.removeListener('server:status-changed', handler)
    }
  }
}

const windowApi: WindowAPI = {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  getVersion: () => ipcRenderer.invoke('app:getVersion')
}

const updaterApi: UpdaterAPI = {
  getStatus: () => ipcRenderer.invoke('updater:getStatus'),
  check: () => ipcRenderer.invoke('updater:check'),
  install: () => ipcRenderer.invoke('updater:install'),
  onStatus: (callback: (state: UpdaterState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdaterState): void => {
      callback(state)
    }
    ipcRenderer.on('updater:status', handler)
    return () => {
      ipcRenderer.removeListener('updater:status', handler)
    }
  }
}

const githubApi: GithubAPI = {
  status: () => ipcRenderer.invoke('github:status'),
  connect: () => ipcRenderer.invoke('github:connect'),
  poll: () => ipcRenderer.invoke('github:poll'),
  listRepos: () => ipcRenderer.invoke('github:listRepos'),
  selectRepo: (fullName, branch) => ipcRenderer.invoke('github:selectRepo', fullName, branch),
  disconnect: () => ipcRenderer.invoke('github:disconnect'),
  push: () => ipcRenderer.invoke('github:push'),
  pull: () => ipcRenderer.invoke('github:pull')
}

const usageApi: UsageAPI = {
  get: () => ipcRenderer.invoke('usage:get'),
  reset: () => ipcRenderer.invoke('usage:reset')
}

contextBridge.exposeInMainWorld('api', {
  dictation: dictationApi,
  settings: settingsApi,
  recordings: recordingsApi,
  models: modelsApi,
  server: serverApi,
  errors: errorsApi,
  window: windowApi,
  updater: updaterApi,
  github: githubApi,
  usage: usageApi,
})
