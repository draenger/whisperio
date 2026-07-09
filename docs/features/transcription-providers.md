# Feature — Transcription providers (chain + fallback + AI post-processing)

## What it does

Speech-to-text is user-configurable: OpenAI (`gpt-4o-transcribe` by default), ElevenLabs
(Scribe), or any self-hosted OpenAI-compatible server (whisper.cpp, faster-whisper, LocalAI,
Ollama). Providers form an ordered **chain**: if one fails, the next takes over. An optional
**AI post-processing** pass (LLM) fixes technical terms using the user's custom vocabulary.

## User-facing flow

1. Settings → Providers: enter an OpenAI and/or ElevenLabs API key, or a self-hosted base URL
   (+ model name), and order the provider chain.
2. Dictate. If the first provider fails, a toast notifies "X failed. Trying Y..."
   (`desktop/src/main/transcribe.ts:68`) and the fallback transcribes.
3. Optional toggles: AI post-processing, custom vocabulary, transcription prompt, language.

## How it works (code path)

1. `transcribeAudio(buffer, filename)` loads settings and builds the effective chain — the
   configured `providerChain`, or legacy `sttProvider` (+ fallback partner if
   `fallbackEnabled`) (`desktop/src/main/transcribe.ts:36`).
2. Unconfigured providers are filtered out; if nothing is configured the first is still tried
   so the user gets a descriptive error (`desktop/src/main/transcribe.ts:76` decides what
   "configured" means per provider).
3. Per provider:
   - **OpenAI / self-hosted** — multipart upload to `/audio/transcriptions`; base URL defaults
     to `https://api.openai.com/v1` (`desktop/src/main/transcribe.ts:16`); a plain
     whisper.cpp server is auto-detected and hit at `/inference` instead
     (`desktop/src/main/transcribe.ts:116`); default model `gpt-4o-transcribe`
     (`desktop/src/main/transcribe.ts:19`), self-hosted default `whisper-1`
     (`desktop/src/main/transcribe.ts:20`).
   - **ElevenLabs** — `https://api.elevenlabs.io/v1/speech-to-text`
     (`desktop/src/main/transcribe.ts:17`, used at `desktop/src/main/transcribe.ts:325`).
   - Custom vocabulary is folded into the prompt ("use these exact spellings", e.g.
     `desktop/src/main/transcribe.ts:112`).
4. If `aiPostProcessing` is on and a vocabulary exists, the transcript goes through
   `postProcessWithLLM` (`desktop/src/main/transcribe.ts:140`) — an OpenAI
   `chat/completions` call with `gpt-4o-mini` (`desktop/src/main/transcribe.ts:370`,
   model at `desktop/src/main/transcribe.ts:372`).
5. Errors are categorized (auth / rate-limit / network / server) and surfaced as OS
   notifications (`desktop/src/main/errorHandler.ts:22`,
   `desktop/src/main/errorHandler.ts:82`); the last errors are queryable from the UI
   (`desktop/src/main/index.ts:181`).

## Entry points (file:line)

- `desktop/src/main/transcribe.ts:36` — `transcribeAudio()` (the chain).
- `desktop/src/main/index.ts:176` — IPC `dictation:transcribe`.
- `desktop/src/main/index.ts:53` — `reprocessRecording()` (re-transcribe from history).
- `desktop/src/main/settingsManager.ts:9` — `AppSettings` (providerChain, keys, base URL,
  model, vocabulary, prompt, language, aiPostProcessing, fallbackEnabled).

## Data touched

- Reads settings from `userData/settings.json` (`desktop/src/main/settingsManager.ts:68`).
- Sends audio to exactly one external endpoint at a time (the provider being tried); a
  self-hosted base URL keeps audio fully local.
- Recent errors kept in memory only (`desktop/src/main/errorHandler.ts:131`).

## Edge cases

- **All providers fail** → the *first* error is thrown (it's the user's primary provider and
  most actionable) (`desktop/src/main/transcribe.ts:73`).
- **Nothing configured** → "No providers configured. Open Settings..." error
  (`desktop/src/main/transcribe.ts:73`).
- **OpenAI counts as configured with only a base URL** (self-hosted servers often need no
  key) (`desktop/src/main/transcribe.ts:77`).
- **whisper.cpp vs OpenAI-compatible path** — base URLs containing `/v1` are treated as
  OpenAI-compatible; otherwise `/inference` (`desktop/src/main/transcribe.ts:116`).
- **Post-processing is best-effort** — wrapped in try/catch so an LLM failure never loses the
  transcript (`desktop/src/main/transcribe.ts:141`).
- **Transcript logging is dev-only** (`desktop/src/main/transcribe.ts:8`).

## Related tests

- `desktop/tests/transcribe.test.ts:1` — provider selection, endpoints, prompts,
  post-processing.
- `desktop/tests/fallback.test.ts:1` — chain/fallback ordering and error propagation.
- `desktop/tests/errorHandler.test.ts:1` — error categorization and messages.
