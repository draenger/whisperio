# Feature — Local models (GGML download + bundled whisper.cpp server)

## What it does

Fully offline transcription without any external server setup: the app can download GGML
Whisper models from Hugging Face and (on Windows) download and run a bundled `whisper-server.exe`
(whisper.cpp) on localhost, then point the self-hosted provider at it. On any platform the
user can instead point Whisperio at their own OpenAI-compatible server.

## User-facing flow

1. Settings → Local model: pick a model (tiny → large-v3), watch download progress, or paste a
   custom GGML URL.
2. Start the local server for a downloaded model; server status is shown live.
3. Dictation now transcribes at `http://127.0.0.1:8178` — audio never leaves the machine.

## How it works (code path)

1. The model catalog (tiny/base/small/medium/large-v3-turbo/large-v3) points at
   `huggingface.co/ggerganov/whisper.cpp` (`desktop/src/main/modelManager.ts:39`);
   `getAvailableModels()` (`desktop/src/main/modelManager.ts:118`) merges download state from
   disk (`desktop/src/main/modelManager.ts:122`).
2. `downloadModel()` streams to `userData` with progress callbacks
   (`desktop/src/main/modelManager.ts:155`); progress is broadcast to all windows over IPC
   (`desktop/src/main/index.ts:202`). Custom URLs go through `downloadCustomModel()`
   (`desktop/src/main/modelManager.ts:359`).
3. The server binary is fetched on demand (`desktop/src/main/localServer.ts:64`) and spawned
   with the chosen model on port `8178` (`desktop/src/main/localServer.ts:8`,
   `desktop/src/main/localServer.ts:103`); `stopServer()` kills it
   (`desktop/src/main/localServer.ts:201`). Status changes stream to the UI
   (`desktop/src/main/index.ts:227`).
4. Transcription then uses the self-hosted provider path, which auto-detects the whisper.cpp
   `/inference` endpoint (`desktop/src/main/transcribe.ts:116`).

## Entry points (file:line)

- `desktop/src/main/index.ts:200` — IPC `models:*` handlers.
- `desktop/src/main/index.ts:226` — IPC `server:*` handlers.
- `desktop/src/main/modelManager.ts:155` — `downloadModel()`.
- `desktop/src/main/localServer.ts:103` — `startServer()`.

## Data touched

- Model files in `userData` (`desktop/src/main/modelManager.ts:122` reads the dir).
- Server binary in `userData/whisper-server` (`desktop/src/main/localServer.ts:24`).
- Settings (`openaiBaseUrl`, `whisperModel`) select the local endpoint
  (`desktop/src/main/settingsManager.ts:9`).

## Edge cases

- **Cancel mid-download** — `cancelDownload()` aborts and cleans up the partial file
  (`desktop/src/main/modelManager.ts:320`).
- **Delete a model** (`desktop/src/main/modelManager.ts:330`); custom models are listed
  separately (`desktop/src/main/modelManager.ts:429`).
- **The bundled server is Windows-only** — the binary path is `whisper-server.exe`
  (`desktop/src/main/localServer.ts:30`); macOS/Linux users run their own server and set the
  base URL.
- **Server status is polled/pushed, never assumed** — `getServerStatus()`
  (`desktop/src/main/localServer.ts:51`) is the single source for the UI.

## Related tests

- `desktop/tests/modelManager.test.ts:1` — catalog, download, cancel, delete.
- `desktop/tests/localServer.test.ts:1` — server lifecycle and status.
