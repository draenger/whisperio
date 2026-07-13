# Whisperio Desktop

Electron + React + TS voice-dictation app (electron-vite, Vitest, CI coverage gate).
Run `npm run typecheck` and `npm run test:coverage` from `desktop/` — both must be
green before any merge.

## Feature-line invariants (v1.4+)
- STT/LLM calls go through src/main/llm provider abstraction. No inline fetch.
- Never break offline: every network path fails soft to local/raw. Wi-Fi off must still transcribe+paste.
- Context = process name + window title only. No screenshots/pixels, ever.
- UI colors/fonts come ONLY from docs/design/tokens.css (Rezme-cool teal). Match layouts to docs/design/*.html.
  Violet is legacy-only (data-theme="violet-legacy").
- Settings additive + migrated; never drop keys. Language-agnostic (100+).
- DoD: typecheck + test:coverage green + tests for new logic. One work item per PR.
