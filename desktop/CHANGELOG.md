# Changelog

## v1.5.0 — 2026-07-14

The provider & cleanup release: dictation output you can shape after the fact,
any AI backend you want (including none), and a bill you can see.

### AI cleanup — rough-first
- Raw transcription pastes **instantly** — cleanup never adds latency.
- On-demand **Clean up** on any recording: full cleanup, formatting templates
  (Email / Notes / Tasks / Message — user-editable), or your own instruction;
  result saved next to the raw text with one-tap copy.
- Full automatic cleanup (filler removal, punctuation, paragraphs,
  self-correction resolution — language-aware, 100+ languages, never
  translates) available as an **opt-in** ("Clean up automatically after
  dictation"). Users of the legacy AI post-processing toggle keep their
  automatic behavior via settings migration.
- Hallucination guard: empty or suspiciously long AI output falls back to the
  raw transcription.

### Providers
- **LLM provider abstraction**: OpenAI, Anthropic, **Replicate**, local
  (Ollama / LocalAI), or any custom OpenAI-compatible endpoint — all cleanup
  runs through it, no vendor lock-in.
- **STT chain gains Replicate** alongside OpenAI, ElevenLabs and self-hosted
  whisper; private STT servers can now send a Bearer token (`sttApiKey`).
- **Model picker**: curated dropdown for known providers, free-text model
  field for local/private endpoints.
- **HTTPS enforced** for every provider URL on public hosts; plain http is
  allowed only for loopback/LAN endpoints.
- **Offline never breaks**: provider down or Wi-Fi off → raw text still
  pastes, no error dialogs; falls back to a local provider when one is
  reachable.

### Usage meter
- Local, on-device usage tracking per provider per month: requests, tokens
  in/out, audio minutes, and **estimated cost** (public price snapshots).
- ElevenLabs counted in **credits**, not dollars; **local/self-hosted always
  $0**. Metering can never block or slow an operation.
- New **Usage** panel in Settings with a reset button.

### Theming
- Single-file design tokens (`docs/design/tokens.css`, `--wsp-*`) drive every
  color, font, radius and motion value — dark (default) and light themes.
- **Teal is the default accent**; the violet palette has been retired
  (existing violet settings map to teal automatically — nothing breaks).

### Notes
- Provider API keys (OpenAI, ElevenLabs, Anthropic, Replicate, self-hosted
  STT) are now stored encrypted with your OS secure storage
  (Keychain/libsecret/DPAPI via Electron `safeStorage`) when it's available on
  your machine, with an automatic one-time migration out of the plaintext
  settings file on first launch. Where OS secure storage isn't available
  (e.g. a Linux box with no keyring daemon running), keys fall back to the
  local settings file exactly as before, and Settings says so honestly next
  to each key field — never a blanket "always encrypted" claim. The GitHub
  sync token continues to use its own Keychain-wrapped vault, unchanged.

## v1.3.0 and earlier
Pre-changelog releases: GitHub encrypted secret store (device-flow OAuth,
AES-256-GCM vault), soft-delete/restore for built-in vocabulary, digest copy
button, config-driven rewrite/categorization prompts, theme groundwork.
