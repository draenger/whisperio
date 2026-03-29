import { contextBridge, ipcRenderer } from 'electron'

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
  onDeactivate: (callback: () => void) => {
    ipcRenderer.on('dictation:deactivate', callback)
    return () => {
      ipcRenderer.removeListener('dictation:deactivate', callback)
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
  sendResult: (text: string) => ipcRenderer.invoke('dictation:result', text),
  transcribe: (audioData: ArrayBuffer, filename: string) =>
    ipcRenderer.invoke('dictation:transcribe', Buffer.from(audioData), filename),
  notifyRecordingStarted: () => ipcRenderer.send('dictation:recording-started')
}

const settingsApi: SettingsAPI = {
  load: () => ipcRenderer.invoke('settings:load'),
  save: (settings) => ipcRenderer.invoke('settings:save', settings),
  pauseHotkeys: () => ipcRenderer.send('hotkeys:pause'),
  resumeHotkeys: () => ipcRenderer.send('hotkeys:resume')
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
  reprocess: (id) => ipcRenderer.invoke('recordings:reprocess', id)
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
  close: () => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('api', {
  dictation: dictationApi,
  settings: settingsApi,
  recordings: recordingsApi,
  models: modelsApi,
  server: serverApi,
  errors: errorsApi,
  window: windowApi,
})
