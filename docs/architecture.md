# Whisperio — architecture

## Overview

Whisperio is a global voice-dictation tool: press a hotkey, speak, press again — your words are
transcribed (cloud or fully local) and auto-pasted into whatever app has focus. It ships as:

- **Desktop app** (the main product) — Electron, Windows / macOS / Linux, lives in `desktop/`.
- **Mobile app** — native Swift iPhone + iPad + Apple Watch app with a keyboard extension and
  widget, distributed via TestFlight, lives in `mobile/`. A native **macOS** app (`WhisperioMac`)
  is a universal target sharing the same code + CloudKit container
  (`mobile/WhisperioApp/MacApp/WhisperioMacApp.swift:13`).
- **Website** — static GitHub Pages site in `docs/` (`docs/index.html:1`, `docs/privacy.html:1`,
  CNAME → whisperio.danielkasprzyk.com in `docs/CNAME:1`).

This is a monorepo; the desktop package name/version is the app version (`desktop/package.json:3`).
License is PolyForm Noncommercial 1.0.0 (`LICENSE.md`); name/logo are trademarked (`TRADEMARKS.md`).

## Stack

| Layer | Tech | Where |
|---|---|---|
| Desktop runtime | Electron 34 + React 19 + TypeScript | `desktop/package.json:28` |
| Desktop build | electron-vite (3 entries: main, preload, renderer) | `desktop/electron.vite.config.ts:10` |
| Desktop packaging | electron-builder (NSIS / dmg+zip / AppImage+deb) | `.devops/electron-builder.yml:1` |
| Desktop tests | Vitest + v8 coverage gate | `desktop/vitest.config.ts:31` |
| Native Windows calls | koffi (keybd_event for paste/Enter) | `desktop/src/main/dictation/autoPaste.ts:28` |
| Auto-update | electron-updater from GitHub Releases | `desktop/src/main/autoUpdater.ts:69` |
| Mobile app | Swift 6 / SwiftUI, Xcode project | `mobile/WhisperioApp/` |
| Mobile domain core | WhisperioKit Swift package (iOS 17 / macOS 14 / watchOS 10) | `mobile/WhisperioKit/Package.swift:9` |

## Components

### Desktop (`desktop/src/`)

```
src/
  main/                     Electron main process
    index.ts                app bootstrap, ALL ipcMain handlers, permission hardening
    dictation/              hotkey state machine, overlay windows, auto-paste
    transcribe.ts           provider chain (OpenAI / ElevenLabs / self-hosted) + LLM post-processing
    settingsManager.ts      settings persistence (JSON in userData)
    recordingStore.ts       audio files + recordings index
    modelManager.ts         GGML Whisper model download/management
    localServer.ts          bundled whisper.cpp server (Windows)
    autoUpdater.ts          fail-soft auto-update
    errorHandler.ts         error categorization + notifications
    tray.ts                 system tray (the app's anchor — no persistent main window)
  preload/index.ts          contextBridge API surface (`window.api`)
  renderer/                 React UIs: settings, recordings, dictation overlay
```

- The main process registers every IPC handler in one place (`desktop/src/main/index.ts:156`
  onwards: settings, transcription, recordings, models, local server, updater, window controls).
- The preload bridge exposes a typed `window.api` object (`desktop/src/preload/index.ts:333`).
- There are three renderer entry pages — settings (`desktop/src/renderer/settings/settings.tsx:1`),
  recordings (`desktop/src/renderer/recordings/recordings.tsx:1`) and the overlay
  (`desktop/src/renderer/dictation/overlay.tsx:1`) — wired as separate Vite inputs
  (`desktop/electron.vite.config.ts:30`).
- The app is tray-anchored: closing all windows does not quit (`desktop/src/main/index.ts:287`);
  on macOS, clicking the Dock icon opens Settings (`desktop/src/main/index.ts:282`).

### Mobile (`mobile/`)

- `mobile/WhisperioKit/` — pure-Swift domain core (provider protocol, chain, state machine,
  settings model, App Group store). See `mobile/WhisperioKit/Sources/WhisperioKit/ProviderChain.swift:9`.
- `mobile/WhisperioApp/` — the Xcode app: SwiftUI iPhone/iPad app (`mobile/WhisperioApp/Sources/WhisperioApp/AppShell.swift:142`),
  Watch app (`mobile/WhisperioApp/WhisperioWatch Watch App/WhisperioWatchApp.swift:10`),
  keyboard extension (`mobile/WhisperioApp/Keyboard/KeyboardViewController.swift:75`),
  widget/Control Center control (`mobile/WhisperioApp/Widget/WhisperioWidget.swift:76`),
  App Intents (`mobile/WhisperioApp/Sources/WhisperioApp/DictateIntent.swift:38`).

Beyond capture, the mobile side has grown four user-facing subsystems, each with a pure core in
WhisperioKit and a thin app-side store/view:

- **History sync** — SwiftData + CloudKit store (`mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:40`);
  on-device vs iCloud is user-selectable (`mobile/WhisperioKit/Sources/WhisperioKit/Settings.swift:7`).
  See [features/apple-sync.md](features/apple-sync.md).
- **GitHub sync** — Markdown mirror to a Git repo (`mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/GitHubClient.swift:63`);
  Whisperio's *cross-ecosystem* path (CloudKit is Apple-only). See [features/github-sync.md](features/github-sync.md).
- **Daily digest / Journal** — per-day grouping + AI summary (`mobile/WhisperioKit/Sources/WhisperioKit/DigestGrouping.swift:10`).
  See [features/daily-digest.md](features/daily-digest.md).
- **Rewrite presets** — AI transcript reformatting (`mobile/WhisperioKit/Sources/WhisperioKit/RewritePresets.swift:76`).
  See [features/rewrite-presets.md](features/rewrite-presets.md).

Details in [features/mobile-app.md](features/mobile-app.md).

## Data flow

Desktop dictation loop (the core interaction):

1. Global hotkey pressed → `activate()` in the main process
   (`desktop/src/main/dictation/hotkeyManager.ts:84`); state machine
   `idle → recording → transcribing → pasting` (`desktop/src/main/dictation/hotkeyManager.ts:12`).
2. Overlay windows appear on every display (`desktop/src/main/dictation/overlayWindow.ts:185`);
   the overlay renderer records the mic via `getUserMedia`/`MediaRecorder`
   (`desktop/src/renderer/hooks/useDictation.ts:64`).
3. Hotkey again → renderer converts WebM → WAV in-process
   (`desktop/src/renderer/hooks/useDictation.ts:3`) and invokes `dictation:transcribe` over IPC
   (`desktop/src/main/index.ts:176`).
4. `transcribeAudio` walks the configured provider chain with fallback
   (`desktop/src/main/transcribe.ts:36`).
5. Result is auto-pasted into the previously focused app via clipboard + synthesized keystroke
   (`desktop/src/main/dictation/autoPaste.ts:85`); Dictate & Send also presses Enter
   (`desktop/src/main/dictation/autoPaste.ts:112`).

Mobile: tap-to-record model — `AVAudioRecorder` capture
(`mobile/WhisperioApp/Sources/WhisperioApp/Engine/AudioRecorder.swift:9`) or live on-device
`SFSpeechRecognizer` dictation (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/LiveDictation.swift:15`),
then the same provider-chain idea (`mobile/WhisperioKit/Sources/WhisperioKit/ProviderChain.swift:9`).
Watch records audio and ships it to the phone via `WCSession.transferFile`
(`mobile/WhisperioApp/WhisperioWatch Watch App/WhisperioWatchApp.swift:107`); the phone receives,
transcribes, and replies (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/PhoneConnectivity.swift:57`).

## External integrations

| Integration | Purpose | Wired at |
|---|---|---|
| OpenAI `/audio/transcriptions` | STT (default model `gpt-4o-transcribe`) | `desktop/src/main/transcribe.ts:19` |
| ElevenLabs speech-to-text (Scribe) | premium STT | `desktop/src/main/transcribe.ts:17` |
| Any OpenAI-compatible server | self-hosted/offline STT (whisper.cpp `/inference` auto-detected) | `desktop/src/main/transcribe.ts:116` |
| OpenAI `chat/completions` (`gpt-4o-mini`) | optional AI post-processing of transcripts | `desktop/src/main/transcribe.ts:372` |
| Hugging Face (ggerganov/whisper.cpp) | GGML model downloads | `desktop/src/main/modelManager.ts:39` |
| GitHub Releases | installer distribution + auto-update feed | `.devops/electron-builder.yml:16` |
| OS keystroke injection | auto-paste: koffi/user32 (Win), osascript (mac), xdotool (Linux) | `desktop/src/main/dictation/autoPaste.ts:28` |

Mobile uses the same OpenAI/ElevenLabs HTTP contracts
(`mobile/WhisperioApp/Sources/WhisperioApp/Engine/OpenAIProvider.swift:17`,
`mobile/WhisperioApp/Sources/WhisperioApp/Engine/ElevenLabsProvider.swift:24`).

## Key invariants

- **The global hotkey is the single trigger** — every start/stop path funnels through the
  hotkey manager's state machine; stale results are dropped via a monotonic session id so a
  late transcription can never paste into the wrong window
  (`desktop/src/main/dictation/hotkeyManager.ts:36`).
- **Audio leaves the device only to the provider the user configured** — recording is local;
  STT fires only on explicit stop, and a self-hosted base URL keeps everything offline.
- **Renderer is sandboxed and fail-closed** — mic permission is granted only to Whisperio's own
  bundled pages (`desktop/src/main/index.ts:85`), device permissions are denied
  (`desktop/src/main/index.ts:102`), external navigation and `window.open` are blocked
  (`desktop/src/main/index.ts:107`).
- **History is local-only** — recordings + transcripts live in the app's userData dir
  (`desktop/src/main/recordingStore.ts:22`); no server-side storage, no telemetry.
- **Transcripts never reach production logs** — content logging is gated to dev builds
  (`desktop/src/main/transcribe.ts:8`, `desktop/src/main/dictation/autoPaste.ts:7`).
- **Single instance** — a second launch focuses the existing app
  (`desktop/src/main/index.ts:43`).
- **Auto-update is fail-soft** — updater errors never block dictation
  (`desktop/src/main/autoUpdater.ts:69`).

⚠️ **Divergence from older docs:** the legacy `ARCHITECTURE.md` claimed API keys live in the OS
secure store (Keychain / Credential Manager / libsecret). In the current desktop code they are
stored in plain `settings.json` under Electron's `userData`
(`desktop/src/main/settingsManager.ts:64`, written at `desktop/src/main/settingsManager.ts:96`) —
no `safeStorage`/keytar usage exists in `desktop/src/`. On iOS keys sit in `UserDefaults`
(`mobile/WhisperioApp/Sources/WhisperioApp/Engine/SettingsStore.swift:8`). Treat "keys in secure
store" as an aspiration, not current behavior.

## Where things live

| What | Where |
|---|---|
| All desktop IPC handlers | `desktop/src/main/index.ts:156` |
| Dictation state machine + hotkeys | `desktop/src/main/dictation/hotkeyManager.ts:12` |
| Provider chain + post-processing | `desktop/src/main/transcribe.ts:36` |
| Settings schema + defaults | `desktop/src/main/settingsManager.ts:9` |
| Recordings storage | `desktop/src/main/recordingStore.ts:5` |
| Whisper model catalog | `desktop/src/main/modelManager.ts:118` |
| Bundled whisper.cpp server | `desktop/src/main/localServer.ts:103` |
| Preload API bridge | `desktop/src/preload/index.ts:333` |
| Settings UI (single big form) | `desktop/src/renderer/components/settings/SettingsForm.tsx:1` |
| Recordings UI | `desktop/src/renderer/components/recordings/RecordingsPanel.tsx:1` |
| Overlay UI | `desktop/src/renderer/components/dictation/DictationOverlay.tsx:1` |
| Packaging config | `.devops/electron-builder.yml:1` |
| CI pipeline | `.github/workflows/build.yml:1` |
| Mobile domain core | `mobile/WhisperioKit/Sources/WhisperioKit/` |
| Mobile engine (audio, providers, sync) | `mobile/WhisperioApp/Sources/WhisperioApp/Engine/` |
| Mobile CloudKit history store | `mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:40` |
| Mobile GitHub-sync engine | `mobile/WhisperioKit/Sources/WhisperioKit/GitHubSync/` |
| Mobile digest grouping + prompts | `mobile/WhisperioKit/Sources/WhisperioKit/DigestGrouping.swift:10` |
| Mobile rewrite presets | `mobile/WhisperioKit/Sources/WhisperioKit/RewritePresets.swift:76` |
| Native Mac app | `mobile/WhisperioApp/MacApp/WhisperioMacApp.swift:13` |
| Website (GitHub Pages) | `docs/index.html:1` |

## Gotchas

- **`docs/` is also the public website** — GitHub Pages serves this folder; don't put secrets in
  markdown here. `docs/privacy.html` must stay reachable (App Store privacy-policy URL).
- **The GitHub Actions workflow cannot move to `.devops/`** — GitHub only discovers workflows in
  `.github/workflows/` (`.github/workflows/build.yml:1`); `.devops/` holds only the configs the
  workflow consumes (absorbed from the legacy `.devops/README.md`).
- **Windows installer artifact name must contain no spaces** — GitHub rewrites spaces to dots,
  which breaks electron-updater's `latest.yml` filename match (`.devops/electron-builder.yml:33`).
- **macOS auto-update requires the `zip` target and a notarized Developer ID signature** —
  Squirrel.Mac can't update from a `.dmg` and rejects unsigned builds
  (`.devops/electron-builder.yml:42`).
- **Coverage config deliberately excludes runtime-only wiring** (windows, tray, preload, React
  components) so the ~90% thresholds measure real logic (`desktop/vitest.config.ts:16`).
- **`getDisplayMedia` can reject on Wayland/macOS screen-permission denial** — the handler
  fails fast instead of hanging the overlay (`desktop/src/main/index.ts:121`).
- **Dev mode skips the auto-launch registry entry** to avoid a bogus "Electron" autostart
  (`desktop/src/main/index.ts:148`).
