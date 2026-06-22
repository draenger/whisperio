# Whisperio — Architecture

Global voice dictation for Windows / macOS / Linux desktop + iOS / iPadOS / Apple Watch mobile.

## Entry points

- **Desktop (Electron + Vite + React)**: `src/` — main process (`out/main/index.js`), renderer process, preload. Bundled via `electron-vite`, packaged via `electron-builder` per platform.
- **Mobile (TestFlight)**: `mobile/` — iOS / iPad / Apple Watch app.
- **Public site (GitHub Pages)**: `docs/` — landing + privacy policy + app preview. CNAME → `whisperio.danielkasprzyk.com`.

## Desktop layers

```
src/
  main/                 Electron main process — global hotkey, tray, audio capture, IPC
  preload/              context-bridge between main and renderer
  renderer/             React UI (settings, overlay, history view)
  shared/               types + constants shared across processes
```

## Key invariants

- **Global hotkey is the single trigger** — every code path that starts/stops recording funnels through the same hotkey handler in main process.
- **Audio never leaves the device unless the user clicks transcribe** — recording is local; STT only fires on explicit user action or auto-stop.
- **API keys live in OS secure store** — Keychain (macOS), Credential Manager (Win), libsecret (Linux). Never in plain config files.
- **STT provider is user-configurable** — OpenAI / ElevenLabs / self-hosted OpenAI-compatible. Fallback chain configurable in settings.
- **History is local-only** — recordings + transcripts in app sandbox; no server-side storage.

## External dependencies

| Dep | Purpose | Where wired |
|---|---|---|
| Electron 34+ | desktop runtime | `src/main/` |
| electron-vite | dev + build orchestration | `electron.vite.config.ts` |
| OpenAI API | STT (gpt-4o-transcribe) | renderer settings → main IPC |
| ElevenLabs API | premium STT (Scribe v2) | renderer settings → main IPC |
| OS-specific secure store | API key storage | preload bridge |
| koffi | native bindings (e.g. Windows hotkey APIs) | main process |
| Vitest | unit tests | `vitest.config.ts` |
| electron-builder | distribution packaging | `electron-builder.yml` |
| electron-updater | in-app update flow | main process |

## Mobile (iOS / iPadOS / Watch)

`mobile/` contains the Expo/native iOS app for TestFlight distribution. Separate from desktop — different runtime, different transcription flow (sandbox limits push the tap-to-record model more than the global-hotkey model).

See `testflight-info.md` for TestFlight Beta App Description + Review Notes copy.

## Diagrams

> [TODO: hotkey-press → record → release → transcribe → auto-paste flow]
> [TODO: provider fallback chain — try OpenAI → fallback ElevenLabs → fallback local Whisper]

## Apex integration

Participates in apex loop system. See `.apex/loops/` for active contracts.
Future candidate loops:
- `release-readiness-loop` — run before each release build: typecheck + tests + secret scan + electron-builder dry-run
- `provider-health-loop` — daily ping of OpenAI / ElevenLabs API status; flag in dashboard if either is down
