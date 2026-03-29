import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron'
import { initDictation, cleanupDictation, reRegisterHotkeys, pauseHotkeys, resumeHotkeys } from './dictation'
import { createTray, destroyTray } from './tray'
import { loadSettings, saveSettings } from './settingsManager'
import { transcribeAudio } from './transcribe'
import { openSettingsWindow } from './settingsWindow'
import { getRecentErrors } from './errorHandler'
import { openRecordingsWindow } from './recordingsWindow'
import {
  type RecordingEntry,
  getRecordings,
  getRecording,
  saveRecording,
  deleteRecording,
  deleteAllRecordings,
  deleteRecordingsByDate,
  getRecordingAudio,
  updateRecording
} from './recordingStore'
import {
  getAvailableModels,
  getLocalModels,
  getCustomModels,
  downloadModel,
  downloadCustomModel,
  cancelDownload,
  deleteModel,
  setDownloadProgressCallback
} from './modelManager'
import {
  getServerStatus,
  startServer,
  stopServer,
  setServerStatusCallback
} from './localServer'
import { initAutoUpdater } from './autoUpdater'

// Set app name and model ID so Windows notifications show "Whisperio"
app.setName('Whisperio')
app.setAppUserModelId('com.whisperio.app')

// Prevent multiple instances — if another instance is already running, focus it
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // User tried to launch a second instance — show settings window
    openSettingsWindow()
  })
}

async function reprocessRecording(id: string) {
  const entry = getRecording(id)
  if (!entry) return null

  const audioBuffer = getRecordingAudio(id)
  if (!audioBuffer) return null

  try {
    const text = await transcribeAudio(audioBuffer, entry.filename)
    return updateRecording(id, { status: 'completed', transcription: text, error: undefined })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return updateRecording(id, { status: 'failed', error: message })
  }
}

app.whenReady().then(() => {
  // Grant media (microphone) permissions for the overlay window
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true)
    } else {
      callback(false)
    }
  })

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media'
  })

  session.defaultSession.setDevicePermissionHandler(() => true)

  // Allow getDisplayMedia to capture system audio without a picker dialog
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' })
      } else {
        callback({})
      }
    })
  })

  // Apply auto-launch setting (uses Windows Registry HKCU\...\Run)
  // Skip in dev mode — process.execPath points to bare electron.exe which
  // creates a bogus "Electron" autostart entry instead of "Whisperio".
  const settings = loadSettings()
  const isPackaged = app.isPackaged
  if (isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtStartup,
      path: process.execPath,
    })
  }

  // Register settings IPC handlers
  ipcMain.handle('settings:load', () => loadSettings())
  ipcMain.handle('settings:save', (_event, newSettings) => {
    const saved = saveSettings(newSettings)
    if ('launchAtStartup' in newSettings && isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: saved.launchAtStartup,
        path: process.execPath,
      })
    }
    if ('dictationHotkey' in newSettings || 'dictateAndSendHotkey' in newSettings || 'outputRecordingHotkey' in newSettings) {
      reRegisterHotkeys()
    }
    return saved
  })

  // Pause/resume hotkeys during shortcut recording in settings
  ipcMain.on('hotkeys:pause', () => pauseHotkeys())
  ipcMain.on('hotkeys:resume', () => resumeHotkeys())

  // Register transcription IPC handler
  ipcMain.handle('dictation:transcribe', async (_event, audioBuffer: Buffer, filename: string) => {
    return transcribeAudio(audioBuffer, filename)
  })

  // Register error IPC handler
  ipcMain.handle('errors:getRecent', () => getRecentErrors())

  // Recording store IPC handlers
  ipcMain.on('recordings:openWindow', () => openRecordingsWindow())
  ipcMain.handle('recordings:list', () => getRecordings())
  ipcMain.handle('recordings:get', (_e, id: string) => getRecording(id))
  ipcMain.handle('recordings:save', (_e, audioBuffer: Buffer, metadata: { duration: number; provider: string }) =>
    saveRecording(audioBuffer, metadata)
  )
  ipcMain.handle('recordings:update', (_e, id: string, updates: Partial<RecordingEntry>) =>
    updateRecording(id, updates)
  )
  ipcMain.handle('recordings:delete', (_e, id: string) => deleteRecording(id))
  ipcMain.handle('recordings:deleteAll', () => deleteAllRecordings())
  ipcMain.handle('recordings:deleteByDate', (_e, date: string) => deleteRecordingsByDate(date))
  ipcMain.handle('recordings:getAudio', (_e, id: string) => getRecordingAudio(id))
  ipcMain.handle('recordings:reprocess', (_e, id: string) => reprocessRecording(id))

  // Model manager IPC handlers
  ipcMain.handle('models:available', () => getAvailableModels())
  ipcMain.handle('models:local', () => [...getLocalModels(), ...getCustomModels()])
  ipcMain.handle('models:download', async (_e, modelId: string) => {
    setDownloadProgressCallback((progress) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('models:download-progress', progress)
        }
      })
    })
    return downloadModel(modelId)
  })
  ipcMain.handle('models:downloadCustom', async (_e, url: string, filename: string) => {
    setDownloadProgressCallback((progress) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('models:download-progress', progress)
        }
      })
    })
    return downloadCustomModel(url, filename)
  })
  ipcMain.handle('models:cancelDownload', (_e, modelId: string) => cancelDownload(modelId))
  ipcMain.handle('models:delete', (_e, modelId: string) => deleteModel(modelId))

  // Local server IPC handlers
  ipcMain.handle('server:status', () => getServerStatus())
  ipcMain.handle('server:start', async (_e, modelFilename: string) => {
    setServerStatusCallback((status) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('server:status-changed', status)
        }
      })
    })
    await startServer(modelFilename)
    return getServerStatus()
  })
  ipcMain.handle('server:stop', () => {
    stopServer()
    return getServerStatus()
  })

  // Window control IPC handlers (for custom title bar)
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  // Initialize Whisperio dictation (overlay + hotkey)
  initDictation()

  // Create system tray icon (replaces anchor window)
  createTray()

  // Auto-update from GitHub releases
  initAutoUpdater()

  console.log('[Whisperio] Ready — press hotkey to dictate')
})

// Keep app alive when all windows close (tray holds it)
app.on('window-all-closed', () => {
  // Do nothing — tray keeps the app running
})

app.on('before-quit', () => {
  cleanupDictation()
  destroyTray()
})
