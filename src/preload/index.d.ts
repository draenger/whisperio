export interface OverlayInfo {
  sourceName: string
  stopHotkey: string
  recordingType: 'input' | 'output'
}

export interface DictationAPI {
  onActivate: (callback: () => void) => () => void
  onActivateOutput: (callback: () => void) => () => void
  onDeactivate: (callback: () => void) => () => void
  onCancel: (callback: () => void) => () => void
  onStateChanged: (callback: (state: string) => void) => () => void
  onOverlayInfo: (callback: (info: OverlayInfo) => void) => () => void
  sendResult: (text: string) => Promise<void>
  transcribe: (audioData: ArrayBuffer, filename: string) => Promise<string>
  notifyRecordingStarted: () => void
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

export interface SettingsAPI {
  load: () => Promise<AppSettings>
  save: (settings: Partial<AppSettings>) => Promise<AppSettings>
  pauseHotkeys: () => void
  resumeHotkeys: () => void
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

export interface WhisperioAPI {
  dictation: DictationAPI
  settings: SettingsAPI
  recordings: RecordingsAPI
  models: ModelsAPI
  server: ServerAPI
  errors: ErrorAPI
  window: WindowAPI
}

declare global {
  interface Window {
    api: WhisperioAPI
  }
}
