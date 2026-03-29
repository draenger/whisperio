<p align="center">
  <img src="icons/whisperio_large.png" alt="Whisperio" width="128" />
</p>

<h1 align="center">Whisperio</h1>

<p align="center">
  Global dictation for Windows, macOS, and Linux — press a hotkey, speak, and your words are transcribed and auto-pasted into any app.
</p>

<p align="center">
  <a href="https://github.com/draenger/whisperio/releases/latest">Download</a> &middot;
  <a href="https://whisperio.danielkasprzyk.com">Website</a> &middot;
  <a href="https://github.com/sponsors/draenger">Sponsor</a>
</p>

---

## How it works

1. Press a global hotkey (works from any application)
2. Speak into your microphone — a minimal overlay shows recording status
3. Press the hotkey again to stop
4. Your speech is transcribed via cloud API and instantly pasted into the focused app

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

## Requirements

- **Windows** 10/11, **macOS** 12+, or **Linux** (X11 — requires `xdotool`)
- An API key from [OpenAI](https://platform.openai.com/api-keys) and/or [ElevenLabs](https://elevenlabs.io/), **or** a self-hosted OpenAI-compatible STT server

## Installation

Download the latest build for your platform from [Releases](https://github.com/draenger/whisperio/releases/latest):

| Platform | Format |
|---|---|
| Windows | `.exe` installer (NSIS) |
| macOS | `.dmg` (x64 & Apple Silicon) |
| Linux | `.AppImage` or `.deb` |

On first launch, open Settings from the system tray and enter your API key.

> **Unsigned builds:** The app is not code-signed yet. Windows will show a SmartScreen warning — click "More info" → "Run anyway". On macOS, you may need to right-click → Open, or run `xattr -cr /Applications/Whisperio.app` in Terminal. To avoid warnings entirely, clone the repo and build from source (see below).

> **Linux note:** Auto-paste requires `xdotool`. Install it with `sudo apt install xdotool` (Debian/Ubuntu) or your distro's package manager.

## Run without installing

If you have Node.js 18+ installed, you can run Whisperio directly from source:

```powershell
git clone https://github.com/draenger/whisperio.git
cd whisperio
powershell -ExecutionPolicy Bypass -File start.ps1
```

Or manually:

```bash
git clone https://github.com/draenger/whisperio.git
cd whisperio
npm install
npm run dev
```

## Development

```bash
npm install       # Install dependencies
npm run dev       # Run in development mode
npm test          # Run tests
npm run typecheck # Type-check

# Build installer (pick your platform)
npm run build:win
npm run build:mac
npm run build:linux
```

### Project structure

```
src/
  main/           Electron main process
    dictation/      Hotkey state machine, overlay windows, auto-paste
    transcribe.ts   OpenAI & ElevenLabs STT with fallback
    settingsManager.ts   Settings persistence
    recordingStore.ts    Audio file storage
    errorHandler.ts      Error categorization & notifications
  renderer/       React UI
    components/     Settings form, overlay, recordings panel
  preload/        IPC bridge between main & renderer
tests/            Vitest unit tests
```

### Tech stack

- [Electron](https://www.electronjs.org/) + [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [electron-vite](https://electron-vite.org/) for build tooling
- [Vitest](https://vitest.dev/) for testing
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
| Launch at Startup | Start Whisperio when Windows boots |
| Theme | Dark or light |

## License

[MIT](LICENSE)
