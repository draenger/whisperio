# Whisperio — documentation index

Standardized repo docs per the apex repo-knowledge-structure standard. This folder is the
**single source of "how the app works"**; superseded relics live in [`_legacy/`](_legacy/).

> Note: `docs/` doubles as the GitHub Pages site (`index.html`, `privacy.html`, `CNAME` →
> whisperio.danielkasprzyk.com). The `.md` files here are repo documentation, not website pages.

- [architecture.md](architecture.md) — how the whole app works: desktop (Electron), mobile (Swift), website, data flow, invariants.
- [features/dictation.md](features/dictation.md) — global hotkey → record → transcribe → auto-paste (incl. Dictate & Send, output recording, overlay, cancel).
- [features/transcription-providers.md](features/transcription-providers.md) — provider chain: OpenAI / ElevenLabs / self-hosted, fallback, AI post-processing.
- [features/local-models.md](features/local-models.md) — GGML Whisper model download + bundled whisper.cpp server (offline mode).
- [features/recording-history.md](features/recording-history.md) — save, browse, replay, re-transcribe past recordings.
- [features/settings.md](features/settings.md) — settings window, hotkey recorder, themes, persistence (and where API keys actually live).
- [features/auto-update.md](features/auto-update.md) — electron-updater flow from GitHub Releases.
- [features/mobile-app.md](features/mobile-app.md) — iPhone/iPad/Watch app, keyboard extension, widget, App Intents, WhisperioKit domain core.
- [runbook.md](runbook.md) — run / build / release desktop, ship mobile to TestFlight, CI pipeline, config & secrets.
- [testing.md](testing.md) — how to run the Vitest suite + coverage gate, Swift package tests, how to add a test.
- [docs-manifest.json](docs-manifest.json) — what was consolidated, from where, at which commit.

Repo conventions live in [`.claude/commands/pr.md`](../.claude/commands/pr.md) (verify-before-PR
checklist) and `CONTRIBUTING.md` at the repo root. The root `README.md` stays as the GitHub
landing page; its technical content is absorbed here.
