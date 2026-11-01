import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron'
import { assertTrustedSender, isTrustedAppUrl, sanitizeRecordingUpdate } from './ipcValidation'
import { initDictation, cleanupDictation, reRegisterHotkeys, pauseHotkeys, resumeHotkeys } from './dictation'
import { createTray, destroyTray } from './tray'
import { loadSettings, saveSettings } from './settingsManager'
import { applyLaunchAtStartup, handleStartupFailure } from './startupSettings'
import {
  getEffectiveSettings,
  saveSettingsWithKeys,
  setSecureStorageWarningListener,
  migrateProviderKeysToKeyStore
} from './secure/keyAccessor'
import { isEncryptionAvailable as isKeyStoreAvailable } from './secure/keyStore'
import {
  transcribeAudio,
  transcribeConversation,
  getConfiguredDiarizingProvider,
  handleRecordingsCleanup,
  type OnDemandCleanupRequest
} from './transcribe'
import { coerceWavArg } from './audioFormat'
import { transcriptText } from './dictation/conversation'
import { openSettingsWindow } from './settingsWindow'
import { getRecentErrors, notifyError } from './errorHandler'
import { openRecordingsWindow } from './recordingsWindow'
import {
  getRecordings,
  getRecording,
  saveRecording,
  deleteRecording,
  deleteAllRecordings,
  deleteRecordingsByDate,
  getRecordingAudio,
  updateRecording
} from './recordingStore'
import { searchTranscripts } from './searchService'
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
  setServerStatusCallback,
  markServerUsed
} from './localServer'
import { initAutoUpdater, setUpdateChecksEnabled, getUpdateState, checkForUpdatesManual, installUpdate, RELEASES_URL } from './autoUpdater'
import {
  getStatus as githubGetStatus,
  beginConnect as githubBeginConnect,
  pollConnect as githubPollConnect,
  listRepositories as githubListRepositories,
  selectRepo as githubSelectRepo,
  disconnect as githubDisconnect,
  pushSecrets as githubPushSecrets,
  pullSecrets as githubPullSecrets
} from './githubSync'
import { getUsage, resetUsage } from './usageTracker'
// Context-aware tone (v1.5 Work Item B). index.ts is the ONE place in main
// that decides WHEN to capture a live context snapshot (recording save time
// and live-dictation transcribe time) — context.ts itself never decides that,
// it only knows how. See context.ts's file header for the full privacy
// contract this depends on.
import { getActiveContext, type DictationContext } from './context'

// Set app name and model ID so Windows notifications show "Whisperio"
app.setName('Whisperio')
app.setAppUserModelId('com.whisperio.app')

// DEV/TEST ONLY: point Electron's userData dir at a disposable temp folder
// instead of the real user's settings.json/recordings/usage.json. Read ONLY
// when the app is not packaged (a real install can never hit this branch,
// even if the env var leaked into its environment somehow) — this exists so
// the Playwright click-test harness (desktop/e2e/*.spec.ts, see
// e2e/helpers.ts) can drive a fully isolated app instance per test without
// ever touching a developer's real config. Must run before anything reads
// app.getPath('userData') (settingsManager, recordingStore, usageTracker all
// resolve it lazily per-call, but set this as early as possible regardless).
if (!app.isPackaged && process.env['WHISPERIO_USER_DATA_DIR']) {
  app.setPath('userData', process.env['WHISPERIO_USER_DATA_DIR'])
}

// Electron 38+ defaults to --ozone-platform=auto, i.e. a native Wayland client on
// Wayland sessions, where globalShortcut needs a portal and the overlay's
// alwaysOnTop/positioning are ignored. Keep the Electron 34 behaviour (XWayland).
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform', 'x11')
}

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
    // Context-aware tone (v1.5 Work Item B): reuse the ORIGINAL recording's
    // captured context, never a live snapshot of whatever's in the
    // foreground right now (which could be the Settings window itself, since
    // reprocess is triggered from RecordingsPanel).
    const context: DictationContext | null = entry.recordedProcessName
      ? { processName: entry.recordedProcessName, windowTitle: entry.recordedWindowTitle ?? '' }
      : null
    // Only the stored WebM is available here: selfhosted (whisper.cpp) is
    // skipped with a clear error, cloud providers proceed (audioFormat.ts).
    const text = await transcribeAudio(audioBuffer, entry.filename, context)
    return updateRecording(id, { status: 'completed', transcription: text, error: undefined })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return updateRecording(id, { status: 'failed', error: message })
  }
}

// Group-conversation mode (multi-speaker recording): transcribe a captured
// clip through the first configured diarizing provider, then save it as a
// RecordingEntry carrying `segments` (see recordingStore.ts's doc comment)
// alongside a labeled plain-text rendering (conversation.ts's
// transcriptText()) so every existing text-only consumer — search, copy,
// on-demand cleanup — keeps working unchanged. Mirrors reprocessRecording()
// above's fail-soft shape: a provider failure still saves a 'failed' entry
// with the error message rather than losing the captured audio.
async function saveConversationRecording(audioBuffer: Buffer, filename: string, duration: number) {
  try {
    const { segments, text } = await transcribeConversation(audioBuffer, filename)
    const labeled = segments.length > 0 ? transcriptText(segments, {}) : text
    return saveRecording(audioBuffer, {
      duration,
      provider: 'conversation',
      segments,
      transcription: labeled,
      status: 'completed'
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return saveRecording(audioBuffer, {
      duration,
      provider: 'conversation',
      status: 'failed'
    }).then((entry) => updateRecording(entry.id, { error: message }))
  }
}

// Whisperio only ever loads its own bundled renderer HTML: a file:// URL in a
// packaged build, or the Vite dev-server URL (ELECTRON_RENDERER_URL) in dev.
// Anything else (remote http(s), an injected iframe, an OAuth redirect) is
// untrusted and must NOT silently receive microphone/device permissions.
function isInternalUrl(url: string | undefined | null): boolean {
  return isTrustedAppUrl(url, process.env['ELECTRON_RENDERER_URL'])
}

// Wrap an ipcMain.handle callback so it only runs for calls from our own frames
// (rejects with 'untrusted sender' otherwise). Generic in the argument tuple so
// handler parameter types are preserved.
function guard<A extends unknown[], R>(
  fn: (event: IpcMainInvokeEvent, ...args: A) => R
): (event: IpcMainInvokeEvent, ...args: A) => R {
  return (event, ...args) => {
    assertTrustedSender(event)
    return fn(event, ...args)
  }
}

// Same for fire-and-forget ipcMain.on listeners: untrusted senders are dropped.
function guardOn<A extends unknown[]>(
  fn: (event: IpcMainEvent, ...args: A) => void
): (event: IpcMainEvent, ...args: A) => void {
  return (event, ...args) => {
    try {
      assertTrustedSender(event)
    } catch (err) {
      console.warn(`[Whisperio] ${(err as Error).message}`)
      return
    }
    fn(event, ...args)
  }
}

app.whenReady().then(() => {
  // Grant media (microphone) permission ONLY to our own renderer windows.
  // Fail closed for any other origin so a future remote/iframe navigation can't
  // silently obtain mic access.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' && isInternalUrl(webContents?.getURL())) {
      callback(true)
    } else {
      callback(false)
    }
  })

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission !== 'media') return false
    // Prefer the live webContents URL; fall back to the requesting origin.
    const url = webContents?.getURL() || requestingOrigin
    return isInternalUrl(url)
  })

  // The app uses no WebHID/WebSerial/WebUSB — deny all device permissions
  // rather than the previous fail-open `() => true`.
  session.defaultSession.setDevicePermissionHandler(() => false)

  // Block any attempt to navigate a window to an external origin, or to open a
  // new window — defence in depth so untrusted content can never gain a
  // foothold (and thus never reach the permission grants above).
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
      if (!isInternalUrl(navigationUrl)) {
        event.preventDefault()
        console.warn(`[Whisperio] Blocked navigation to external URL: ${navigationUrl}`)
      }
    })
    contents.setWindowOpenHandler(({ url }) => {
      console.warn(`[Whisperio] Blocked window.open to: ${url}`)
      return { action: 'deny' }
    })
  })

  // Allow getDisplayMedia to capture system audio without a picker dialog
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (sources.length > 0) {
          callback({ video: sources[0], audio: 'loopback' })
        } else {
          callback({})
        }
      })
      .catch((err) => {
        // getSources can reject (Wayland, denied screen-recording permission on
        // macOS, transient failures). Without this catch the renderer's
        // getDisplayMedia promise never settles and the overlay hangs in
        // "recording" until the 60s safety timer fires, plus an
        // UnhandledPromiseRejection is logged. Hand back an empty response so
        // the dictation state machine fails fast with a clear error instead.
        console.error('[Whisperio] desktopCapturer.getSources failed:', err)
        callback({})
      })
  })

  // One-time, idempotent migration: move any plaintext provider API keys
  // sitting in settings.json into the OS-secure-storage-backed key store
  // (see secure/keyAccessor.ts). Must run before anything below reads
  // settings, and before the settings:load/settings:save IPC handlers are
  // registered, so the renderer never observes the pre-migration state.
  try {
    migrateProviderKeysToKeyStore()
  } catch (err) {
    console.error('[Whisperio] provider-key migration failed (' + ((err as NodeJS.ErrnoException | null)?.code ?? 'unknown') + '); continuing startup.')
  }

  // Apply auto-launch setting (uses Windows Registry HKCU\...\Run)
  // Skip in dev mode — process.execPath points to bare electron.exe which
  // creates a bogus "Electron" autostart entry instead of "Whisperio".
  // Skipped while settings.json is locked/unreadable (defaults must not re-enable autostart).
  const isPackaged = app.isPackaged
  applyLaunchAtStartup(app, isPackaged, process.execPath)

  // Register settings IPC handlers. load/save go through the key-accessor
  // (secure/keyAccessor.ts) rather than settingsManager directly, so
  // provider API keys are composed with the encrypted key store — see that
  // module's doc comment. AppSettings' shape is unchanged; the renderer
  // can't tell the difference except that the values it saves may now rest
  // in the key store instead of settings.json.
  setSecureStorageWarningListener((message) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('settings:secure-storage-warning', message)
    }
  })
  ipcMain.handle('settings:load', guard(() => getEffectiveSettings()))
  ipcMain.handle('settings:save', guard((_event, newSettings: Parameters<typeof saveSettingsWithKeys>[0]) => {
    const prevChecks = loadSettings().checkForUpdates !== false
    const saved = saveSettingsWithKeys(newSettings)
    // Only touch the update schedule when the flag actually changed (a settings save for any
    // other reason that merely carries the field must not restart the timers).
    if ('checkForUpdates' in newSettings && (saved.checkForUpdates !== false) !== prevChecks) {
      setUpdateChecksEnabled(saved.checkForUpdates !== false)
    }
    if ('launchAtStartup' in newSettings && isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: saved.launchAtStartup,
        path: process.execPath,
      })
    }
    if (
      'dictationHotkey' in newSettings ||
      'dictateAndSendHotkey' in newSettings ||
      'outputRecordingHotkey' in newSettings ||
      'commandHotkey' in newSettings
    ) {
      reRegisterHotkeys()
    }
    return saved
  }))
  // Tells the renderer whether OS secure storage is usable, so it can show
  // an honest hint next to API key fields ("keys are encrypted..." vs.
  // "...unavailable, new keys are kept for this session only"). Never gates
  // any functionality — keys entered while storage is unavailable still work
  // for the session, they are just not persisted (fail closed).
  ipcMain.handle('settings:keyStorageAvailable', guard(() => isKeyStoreAvailable()))

  // Pause/resume hotkeys during shortcut recording in settings
  ipcMain.on('hotkeys:pause', guardOn(() => pauseHotkeys()))
  ipcMain.on('hotkeys:resume', guardOn(() => resumeHotkeys()))

  // Context-aware tone (v1.5 Work Item B): explicit opt-in for window-title
  // matching. Only ever invoked by the "Enable window-title matching" button
  // in Settings (a direct user gesture) — this is deliberately the ONE place
  // that ever calls getActiveContext({ includeWindowTitle: true }), which is
  // what actually triggers the macOS Screen Recording permission prompt.
  // Fail-soft: even if the OS denies/can't show the prompt, the setting still
  // flips on — future getActiveContext() calls just keep getting title: ''
  // (see context.ts), never worse than the processName-only default.
  ipcMain.handle('context:enableWindowTitleMatching', guard(async () => {
    await getActiveContext({ includeWindowTitle: true }).catch(() => null)
    return saveSettings({ windowTitlePermissionEnabled: true })
  }))

  // GitHub secret-store IPC handlers. All GitHub network I/O + the token + the
  // encryption key stay in the main process; the renderer only ever sees status,
  // the device user-code, repo names, and success/failure — never the token or
  // any plaintext secret in transit to the repo.
  ipcMain.handle('github:status', guard(() => githubGetStatus()))
  ipcMain.handle('github:connect', guard(() => githubBeginConnect()))
  ipcMain.handle('github:poll', guard(() => githubPollConnect()))
  ipcMain.handle('github:listRepos', guard(() => githubListRepositories()))
  ipcMain.handle('github:selectRepo', guard((_e, fullName: string, branch: string) =>
    githubSelectRepo(fullName, branch)
  ))
  ipcMain.handle('github:disconnect', guard(() => githubDisconnect()))
  ipcMain.handle('github:push', guard(() => githubPushSecrets()))
  ipcMain.handle('github:pull', guard(() => githubPullSecrets()))

  // Usage/cost metering IPC handlers (PACZKA METERING v1.6)
  ipcMain.handle('usage:get', guard(() => getUsage()))
  ipcMain.handle('usage:reset', guard(() => resetUsage()))

  // Register transcription IPC handler
  ipcMain.handle('dictation:transcribe', guard(async (_event, audioBuffer: Buffer, filename: string, wavArg?: unknown) => {
    // Reset the local whisper-server idle clock so an actively-used server is
    // not reclaimed by the idle sweep mid-session (no-op when it's not running).
    markServerUsed()
    // Context-aware tone (v1.5 Work Item B): captured HERE, right as the live
    // dictation pipeline picks up the just-recorded audio — this is "the
    // moment of dictating", not a later on-demand click. Gated on
    // contextAwareTone so the active-win call (and any permission surface it
    // implies) only ever happens when the feature is actually on.
    const settings = loadSettings()
    const context = settings.contextAwareTone
      ? await getActiveContext({ includeWindowTitle: settings.windowTitlePermissionEnabled })
      : null
    // Additive: optional WAV rendition for whisper.cpp only (see audioFormat.ts).
    const wavBuffer = coerceWavArg(wavArg)
    const wav = wavBuffer ? { buffer: wavBuffer, filename: 'audio.wav' } : null
    return transcribeAudio(audioBuffer, filename, context, wav, { fromDictation: true })
  }))

  // Renderer-reported capture failures (e.g. no usable microphone) -> toast
  ipcMain.handle('dictation:error', guard((_event, title: string, body: string) => {
    notifyError(String(title).slice(0, 100), String(body).slice(0, 300))
  }))

  // Register error IPC handler
  ipcMain.handle('errors:getRecent', guard(() => getRecentErrors()))

  // Recording store IPC handlers
  ipcMain.on('recordings:openWindow', guardOn(() => openRecordingsWindow()))
  ipcMain.handle('recordings:list', guard(() => getRecordings()))
  ipcMain.handle('recordings:get', guard((_e, id: string) => getRecording(id)))
  ipcMain.handle('recordings:save', guard(async (_e, audioBuffer: Buffer, metadata: { duration: number; provider: string }) => {
    // Context-aware tone (v1.5 Work Item B): captured HERE, at recording
    // time, and persisted onto the entry (recordingStore.ts's
    // RecordingEntry.recordedProcessName/recordedWindowTitle) — so a later
    // on-demand "Clean up" click (handleRecordingsCleanup, transcribe.ts) can
    // resolve the SAME tone profile without re-reading the (by then possibly
    // very different) foreground app. Gated on contextAwareTone: the
    // active-win call only happens when the feature is on.
    const settings = loadSettings()
    const context = settings.contextAwareTone
      ? await getActiveContext({ includeWindowTitle: settings.windowTitlePermissionEnabled })
      : null
    return saveRecording(audioBuffer, {
      ...metadata,
      recordedProcessName: context?.processName,
      recordedWindowTitle: context?.windowTitle
    })
  }))
  ipcMain.handle('recordings:update', guard((_e, id: string, updates: unknown) =>
    // Allowlist: only status/transcription/error are renderer-editable. filepath,
    // filename, id, size, timestamps, segments etc. are dropped (finding #10).
    updateRecording(String(id), sanitizeRecordingUpdate(updates))
  ))
  ipcMain.handle('recordings:delete', guard((_e, id: string) => deleteRecording(id)))
  ipcMain.handle('recordings:deleteAll', guard(() => deleteAllRecordings()))
  ipcMain.handle('recordings:deleteByDate', guard((_e, date: string) => deleteRecordingsByDate(date)))
  ipcMain.handle('recordings:getAudio', guard((_e, id: string) => getRecordingAudio(id)))
  ipcMain.handle('recordings:reprocess', guard((_e, id: string) => reprocessRecording(id)))
  ipcMain.handle('recordings:cleanup', guard((_e, id: string, options: OnDemandCleanupRequest) =>
    handleRecordingsCleanup(id, options)
  ))

  // Full-text search across every saved transcript (searchService.ts). The
  // payload is a QUERY STRING and nothing else — no path, no id, no record
  // shape the renderer could steer storage with. A non-string or empty query
  // resolves to [] rather than throwing: this channel is invoked from a
  // debounced input, so a transport-level rejection mid-typing would surface
  // as a spurious error state, and "no query" genuinely means "no results".
  ipcMain.handle('recordings:search', guard((_e, query: unknown) =>
    typeof query === 'string' ? searchTranscripts(query) : []
  ))

  // Group-conversation mode (multi-speaker recording) IPC. `available`
  // mirrors the mobile app's Conversation record button guard — the button
  // is disabled with a hint when no diarizing provider (ElevenLabs/
  // Deepgram/AssemblyAI) is configured, checked BEFORE the renderer even
  // starts capturing audio.
  ipcMain.handle('conversation:available', guard(() => getConfiguredDiarizingProvider(getEffectiveSettings()) !== null))
  ipcMain.handle(
    'conversation:save',
    guard(async (_e, audioBuffer: Buffer, metadata: { duration: number; filename?: string }) =>
      saveConversationRecording(audioBuffer, metadata.filename || 'conversation.webm', metadata.duration)
  ))
  ipcMain.handle('recordings:renameSpeaker', guard(async (_e, id: string, speakerId: string, name: string) => {
    const entry = getRecording(id)
    if (!entry) return null
    const speakerNames = { ...(entry.speakerNames || {}), [speakerId]: name }
    const updated = await updateRecording(id, { speakerNames })
    if (updated?.segments) {
      // Keep the labeled plain-text rendering (search/copy/cleanup) in sync
      // with the rename — recomputed from the untouched segments, never a
      // string-replace on the old text.
      await updateRecording(id, { transcription: transcriptText(updated.segments, speakerNames) })
    }
    return getRecording(id)
  }))

  // Model manager IPC handlers
  ipcMain.handle('models:available', guard(() => getAvailableModels()))
  ipcMain.handle('models:local', guard(() => [...getLocalModels(), ...getCustomModels()]))
  ipcMain.handle('models:download', guard(async (_e, modelId: string) => {
    setDownloadProgressCallback((progress) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('models:download-progress', progress)
        }
      })
    })
    return downloadModel(modelId)
  }))
  ipcMain.handle('models:downloadCustom', guard(async (_e, url: string, filename: string) => {
    setDownloadProgressCallback((progress) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('models:download-progress', progress)
        }
      })
    })
    return downloadCustomModel(url, filename)
  }))
  ipcMain.handle('models:cancelDownload', guard((_e, modelId: string) => cancelDownload(modelId)))
  ipcMain.handle('models:delete', guard((_e, modelId: string) => deleteModel(modelId)))

  // Local server IPC handlers
  ipcMain.handle('server:status', guard(() => getServerStatus()))
  ipcMain.handle('server:start', guard(async (_e, modelFilename: string) => {
    setServerStatusCallback((status) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('server:status-changed', status)
        }
      })
    })
    await startServer(modelFilename)
    return getServerStatus()
  }))
  ipcMain.handle('server:stop', guard(() => {
    stopServer()
    return getServerStatus()
  }))

  // Auto-update IPC handlers
  ipcMain.handle('updater:getStatus', guard(() => getUpdateState()))
  ipcMain.handle('updater:check', guard(() => {
    checkForUpdatesManual()
    return getUpdateState()
  }))
  ipcMain.handle('updater:install', guard(() => installUpdate()))
  // Fixed URL, never renderer-supplied: opens the GitHub Releases page in the default browser.
  ipcMain.handle('updater:openReleases', guard(() => shell.openExternal(RELEASES_URL)))

  // Window control IPC handlers (for custom title bar)
  ipcMain.on('window:minimize', guardOn((event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  }))
  ipcMain.on('window:maximize', guardOn((event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  }))
  ipcMain.on('window:close', guardOn((event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  }))

  // Expose the real app version to the renderer (settings badge)
  ipcMain.handle('app:getVersion', guard(() => app.getVersion()))

  // Initialize Whisperio dictation (overlay + hotkey)
  initDictation()

  // Create system tray icon (replaces anchor window)
  createTray()

  // Auto-update from GitHub releases
  initAutoUpdater(loadSettings().checkForUpdates !== false)

  console.log('[Whisperio] Ready — press hotkey to dictate')
}).catch((err) => {
  handleStartupFailure(err, dialog, app)
})

// macOS: the app runs as a menubar/tray app with no persistent main window.
// Clicking the Dock/Launchpad icon fires 'activate' — open Settings so the
// user has a way to reach the UI (the tray menu is the only other entry point).
app.on('activate', () => {
  openSettingsWindow()
})

// Keep app alive when all windows close (tray holds it)
app.on('window-all-closed', () => {
  // Do nothing — tray keeps the app running
})

app.on('before-quit', () => {
  // Don't leave the managed whisper-server holding RAM and port 8178.
  stopServer()
  cleanupDictation()
  destroyTray()
})
