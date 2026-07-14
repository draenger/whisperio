# Whisperio ↔ Wispr Flow — parity ledger

_Living document. Updated every PR by the autonomous build loop (see AUTOBUILD-SPEC.md).
Statuses are honest: "shipped" means merged to main AND live-click-tested on the platform
noted; "pending human smoke" means gates green but no human ran the packaged build._

Last update: 2026-07-14 · Phase 0 in progress

| Wispr Flow capability | Whisperio status | Reachable? | Tested (live)? | Notes |
|---|---|---|---|---|
| Dictation + AI cleanup | on main (v1.5.0 prep) — rough-first: raw pastes instantly, on-demand Clean up (full/templates/custom), auto opt-in | ✅ desktop | unit+boot ✅ / clicks pending P0.1 harness | pending human smoke |
| Context-aware tone | ❌ MISSING | — | — | Phase 1 #1 — no-screenshot variant (process name + window title only) |
| Snippets | ❌ MISSING | — | — | Phase 1 #2 — exact-match first, semantic (local MiniLM) as better-than |
| Personal dictionary | manual vocab ✅ (custom + soft-deletable defaults) | ✅ | unit ✅ | auto-learn from edits = Phase 1 #3 |
| Command / rewrite | partial — on-demand transform on recordings (templates/custom instruction) | ✅ desktop | unit ✅ | select-text-anywhere command mode = Phase 1 #4 |
| Wake word | ❌ MISSING | — | — | Phase 1 #5 — local only, ONNX via JS runtime, no Python |
| Scratchpad | ❌ MISSING | — | — | Phase 1 #6 |
| History | ✅ desktop RecordingsPanel + mobile history/journal | ✅ | unit ✅ | |
| Multi-platform | desktop Win/mac/Linux + iOS + watchOS + iCloud sync | ✅ | mobile sim ✅ / installers CI | Wispr: mac+win only |
| **Moat: offline** | ✅ fail-soft everywhere; Wi-Fi off → raw pastes, local provider → full cleanup | ✅ | unit ✅ | zero-config bundled server mac/Linux = Phase 2 |
| **Moat: provider freedom** | ✅ OpenAI / Anthropic / Replicate / ElevenLabs / local / custom endpoint; model picker; HTTPS gate | ✅ | unit ✅ | |
| **Moat: no-account / open** | ✅ no account, PolyForm NC source | ✅ | — | |
| **Moat: usage meter** | ✅ per-provider/month, local-only; ElevenLabs credits; local=$0 | ✅ | unit ✅ | |
| **Moat: no-screenshot** | ✅ (no context feature yet — nothing reads the screen at all) | n/a | — | becomes marketable with Phase 1 #1 |

## Orphan list (defined-but-unreachable views) — must stay EMPTY

_2026-07-14 wiring pass (46 findings) closed: desktop `recordings:cleanup` IPC handler,
CleanupPanel/ModelPicker/UsagePanel mounting, mobile OnboardingView / DigestPromptEditorView /
TriggerGuides entries. Durable automated reachability + IPC-integrity tests land in P0.3/P0.4 —
until then this list is maintained by audit._

(currently empty)

## Phase 0 debt board

| Item | Status |
|---|---|
| P0.1 Click-test harness (Playwright for Electron) + first click tests | OPEN |
| P0.2 safeStorage keyStore (build + migrate provider keys + honest fallback) — **spec said code exists; it does NOT — building from scratch** | OPEN |
| P0.3 Durable reachability sweep (defined-vs-reachable diff, desktop + mobile) | OPEN |
| P0.4 Durable IPC-integrity test (renderer↔preload↔ipcMain + registration order) | OPEN |
| P0.5 Durable settings full-loop test (default→UI→save→consumer per key) | OPEN |
| P0.6 v1.5 release prep refresh → HUMAN-GATED STOP | OPEN |
