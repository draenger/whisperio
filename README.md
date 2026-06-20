<p align="center">
  <img src="desktop/icons/whisperio_large.png" alt="Whisperio" width="128" />
</p>

<h1 align="center">Whisperio</h1>

<p align="center">
  Global dictation for Windows, macOS, Linux — and iPhone/Apple Watch. Press a hotkey, speak, and your words are transcribed and pasted into any app.
</p>

<p align="center">
  <a href="https://github.com/draenger/whisperio/releases/latest">Download</a> &middot;
  <a href="https://whisperio.danielkasprzyk.com">Website</a> &middot;
  <a href="https://github.com/sponsors/draenger">Sponsor</a>
</p>

<p align="center">
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue" alt="License: PolyForm Noncommercial 1.0.0" /></a>
</p>

---

## Repository structure

This is a monorepo with two apps and a website:

```
whisperio/
├── desktop/     Electron app for Windows, macOS, Linux (the main app)
├── mobile/      iOS + Apple Watch app (Swift) and the WhisperioKit package
├── docs/        Project website (GitHub Pages → whisperio.danielkasprzyk.com)
├── tests/       (desktop unit tests live in desktop/tests)
├── LICENSE.md   PolyForm Noncommercial 1.0.0
└── TRADEMARKS.md  Name & logo policy
```

## How it works

1. Press a global hotkey (works from any application)
2. Speak into your microphone — a minimal overlay shows recording status
3. Press the hotkey again to stop
4. Your speech is transcribed and instantly pasted into the focused app

No browser tabs, no copy-paste — just talk and it types.

## Features

- **Global hotkey** — works system-wide, even when Whisperio is in the background
- **Auto-paste** — transcription is placed directly into the focused text field
- **Dictate & Send** — optional mode that presses Enter after pasting (great for chat apps)
- **Multi-monitor overlay** — recording indicator appears on every connected display
- **Output recording** — capture and transcribe system audio (e.g. meetings)
- **STT providers** — OpenAI (gpt-4o-transcribe) or ElevenLabs (Scribe v2), with automatic fallback
- **Self-hosted models** — point to any OpenAI-compatible server (whisper.cpp, faster-whisper, LocalAI, Ollama) for fully offline, private transcription
- **AI post-processing** — optional LLM pass to fix technical terms using a custom vocabulary
- **Recording history** — save, browse, replay, and re-transcribe past recordings
- **Customizable hotkeys** — game-style key recorder, set any combination you want
- **System tray** — runs quietly in the background, launch at startup
- **Dark & light themes**
- **iPhone & Apple Watch** — dictate on the go, with language and custom-vocabulary settings ([mobile/](mobile/))

## Requirements

- **Windows** 10/11, **macOS** 12+, or **Linux** (X11 — requires `xdotool`)
- An API key from [OpenAI](https://platform.openai.com/api-keys) and/or [ElevenLabs](https://elevenlabs.io/), **or** a self-hosted OpenAI-compatible STT server

## Install (desktop)

Download the latest build for your platform from [Releases](https://github.com/draenger/whisperio/releases/latest):

| Platform | Format | Notes |
|---|---|---|
| Windows | `.exe` installer (NSIS) | SmartScreen may warn — click "More info" → "Run anyway" |
| macOS | `.dmg` (Intel & Apple Silicon) | **Signed with Developer ID + notarized** — opens normally |
| Linux | `.AppImage` or `.deb` | Auto-paste needs `xdotool` |

On first launch, open Settings from the system tray and enter your API key.

**macOS:** open the `.dmg` and drag Whisperio to Applications — it's a Developer-ID-signed, notarized build, so it opens without the "unidentified developer" prompt, and updates install in place while keeping your Accessibility permission. (Picking the right `.dmg`: Apple-Silicon Macs use `arm64`, Intel Macs use `x64`.)

> **Got an older, unsigned build?** Versions before signing was set up may need a right-click → Open once, or `xattr -cr /Applications/Whisperio.app` in Terminal. Newer signed builds don't.

> **Linux note:** Auto-paste requires `xdotool`. Install it with `sudo apt install xdotool` (Debian/Ubuntu) or your distro's package manager.

## Install (iPhone & Apple Watch)

The mobile app ships through **TestFlight**. Join the beta, or build it yourself from [`mobile/`](mobile/) in Xcode (see [mobile/README](mobile/) for signing notes). The same transcription engines, language, and custom-vocabulary settings as the desktop app.

## Build from source

Everything is open — you can clone the repo and run or build your own copy for any **noncommercial** use (see [License](#license)).

### Run without installing

The launcher scripts bootstrap everything into the project folder: if Node.js is missing they download a portable copy into `./.node`, run `npm install`, and start the app. Nothing is written outside the folder — delete it and it's gone.

**Windows** (PowerShell):

```powershell
git clone https://github.com/draenger/whisperio.git
cd whisperio
powershell -ExecutionPolicy Bypass -File desktop/start.ps1
```

**macOS / Linux**:

```bash
git clone https://github.com/draenger/whisperio.git
cd whisperio
bash desktop/start.sh
```

(No `git`? Download the repo as a ZIP from GitHub, extract it, and run the same script.)

### Development

All desktop commands run from the `desktop/` folder:

```bash
cd desktop
npm install            # Install dependencies
npm run dev            # Run in development mode
npm test               # Run unit tests (Vitest)
npm run test:coverage  # Tests + coverage thresholds (the release gate)
npm run typecheck      # Type-check

# Build installer (pick your platform)
npm run build:win
npm run build:mac
npm run build:linux
```

Every release goes through CI (`.github/workflows/build.yml`): a cheap Ubuntu job runs **typecheck + tests with coverage thresholds first**, and the platform installers are only built if that passes — so no release ships without green tests.

### Desktop project structure

```
desktop/
  src/
    main/                  Electron main process
      dictation/             Hotkey state machine, overlay windows, auto-paste
      transcribe.ts          OpenAI & ElevenLabs STT with fallback
      settingsManager.ts     Settings persistence
      recordingStore.ts      Audio file storage
      modelManager.ts        Local Whisper model download/management
      localServer.ts         Bundled whisper.cpp server (Windows)
      autoUpdater.ts         Auto-update (fail-soft)
      errorHandler.ts        Error categorization & notifications
    renderer/              React UI (settings, overlay, recordings)
    preload/               IPC bridge between main & renderer
  tests/                   Vitest unit tests
.devops/                   CI/CD pipeline configs (electron-builder.yml; the
                           GitHub Actions workflow stays in .github/workflows/)
```

### Tech stack

- [Electron](https://www.electronjs.org/) + [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [electron-vite](https://electron-vite.org/) for build tooling
- [Vitest](https://vitest.dev/) for testing (logic covered ~95%+)
- [koffi](https://koffi.dev/) for native Windows API calls (auto-paste via clipboard + keybd_event)
- macOS auto-paste via `osascript`, Linux via `xdotool`

## Self-hosted / offline mode

Whisperio can work fully offline with any OpenAI-compatible STT server. In Settings > Providers, set:

- **API Base URL** — your server (e.g. `http://localhost:8080/v1`)
- **Model** — model name your server expects (e.g. `whisper-large-v3`)
- **API Key** — leave empty if your server doesn't require one

Compatible servers:

| Server | Install |
|---|---|
| [whisper.cpp](https://github.com/ggerganov/whisper.cpp) | `./server -m ggml-large-v3.bin` |
| [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) | `pip install faster-whisper-server && faster-whisper-server` |
| [LocalAI](https://github.com/mudler/LocalAI) | `docker run -p 8080:8080 localai/localai` |
| [Ollama](https://ollama.com/) | `ollama serve` (with whisper model) |

## Settings

| Setting | Description |
|---|---|
| STT Provider | OpenAI or ElevenLabs |
| API Base URL | Custom endpoint for self-hosted models (leave empty for official OpenAI) |
| Model | Whisper model name (default: gpt-4o-transcribe) |
| Fallback | Auto-switch provider on failure |
| AI Post-Processing | LLM corrects technical terms after transcription |
| Custom Vocabulary | Comma-separated terms for better recognition |
| Transcription Prompt | Guide the STT model's output style |
| Dictation Hotkey | Global shortcut to start/stop recording |
| Dictate & Send Hotkey | Same as above, but presses Enter after paste |
| Output Recording Hotkey | Record system audio instead of microphone |
| Save Recordings | Keep audio files for later review |
| Launch at Startup | Start Whisperio when the system boots |
| Theme | Dark or light |

## License

Whisperio's source is released under the **[PolyForm Noncommercial License 1.0.0](LICENSE.md)**.

- ✅ **You may** read, build, run, study, and modify it for any **noncommercial** purpose — personal use, hobby, research, education, nonprofits, and self-hosting your own copy.
- ❌ **You may not** use it (or a derivative) **commercially**, including selling it or running it as part of a paid product or service.

The **"Whisperio" name and the logo/icons are trademarks of Daniel Kasprzyk** and are **not** covered by the source license — see **[TRADEMARKS.md](TRADEMARKS.md)**. If you publish a fork, rename it and use your own branding.

Want a **commercial license**, or to use the name/logo? Contact the maintainer via the [repo](https://github.com/draenger/whisperio).
