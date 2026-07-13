# Whisperio v1.5.0 — Shape your dictation, choose your AI, see your bill

**Raw text pastes instantly. AI polish is yours to summon — from any provider, or none at all.**

## ✨ Highlights

**Rough-first AI cleanup.** Your words paste the moment transcription ends — zero added latency. When you want polish, hit **Clean up** on any recording: full cleanup (fillers gone, punctuation fixed, "let's do Tuesday— no, Friday" resolved to Friday), a formatting template (Email, Notes, Tasks, Message — or your own), or a custom instruction. Works in 100+ languages, never translates, never invents. Prefer the old way? Flip on automatic cleanup and it runs before every paste.

**Bring your own AI.** Cleanup runs through a provider abstraction: OpenAI, Anthropic, **Replicate**, a local model via Ollama/LocalAI, or any OpenAI-compatible endpoint you host. The STT chain gains Replicate too, and private whisper servers can now authenticate with a token. Known providers get a curated model dropdown; private endpoints get a free-text field.

**Your bill, visible.** A local, on-device usage meter tracks requests, tokens and audio minutes per provider each month, with estimated cost. ElevenLabs shows credits; **local models always show $0**. Nothing leaves your machine.

**Locked-down connections.** Public provider endpoints must be HTTPS — plain http is only accepted for loopback and LAN hosts (your private server stays easy, the internet stays encrypted).

**Offline never breaks.** Wi-Fi off with a local model → full transcription and cleanup. Wi-Fi off with nothing → raw text still pastes. No error dialogs, ever.

**A cooler look.** New teal-forward design driven by a single token file — dark and light. The violet palette retired; old violet settings map to teal automatically.

## 🔧 Under the hood
- LLM/STT provider abstractions with availability caching and automatic local fallback
- Idempotent settings migrations — no key is ever dropped
- 492 tests, ~96% coverage; typecheck + coverage gates enforced in CI

## 📝 Notes
- Provider API keys live in the app's local settings file (as in previous releases); the GitHub sync token continues to use OS secure storage. Moving provider keys to OS secure storage is planned.
- Full changelog: `desktop/CHANGELOG.md`
