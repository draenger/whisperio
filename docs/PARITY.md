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
TriggerGuides entries. P0.3 (below) replaced that one-time manual audit with two durable,
CI-runnable sweeps — desktop `npm run test:reachability` (vitest) and mobile
`Scripts/check-reachability.sh` — so this list can no longer silently rot._

(currently empty — desktop 13/13 reachable, mobile 70/71 reachable + 1 allowlisted, 0 orphans on both platforms)

### Sweep mechanisms (P0.3)

**Desktop** — `desktop/tests/reachability.spec.ts` (+ `desktop/tests/reachability/analyze.ts`).
Regex-based (no ts-morph/new deps): enumerates every exported, JSX-returning component in
`src/renderer/components/**` + `src/renderer/*.tsx` (outside the three window entrypoints —
`settings/settings.tsx`, `recordings/recordings.tsx`, `dictation/overlay.tsx`), then BFS's the
real JSX call-site graph from those entrypoints (imports alone don't count — a component has to
actually be rendered as `<Name .../>` to count as reachable). Any orphan throws with a
defined-vs-reachable diff. Runs as part of `npm test` / `npm run test:coverage`.

| Desktop | defined | reachable | allowlisted | orphans |
|---|---|---|---|---|
| Sweep result | 13 | 13 | 0 | **0** |

**Mobile** — `mobile/WhisperioApp/Scripts/check-reachability.sh` (+ `reachability_check.py`,
`reachability-allowlist.txt`). Scans `mobile/WhisperioApp/Sources/WhisperioApp/**/*.swift` for
every `struct X: View` (including generic-constrained ones, e.g. `SettGroup<Content: View>`) and
requires a real instantiation call-site (`X(` or the SwiftUI trailing-closure form `X {`) outside
its own declaration line, anywhere in that same tree. Views used only from a `#Preview` block
count as "preview-only", not reachable — they must be explicitly allowlisted with a reason, not
silently passed. Exit 0/1; run manually (`./check-reachability.sh`) since there's no CI runner in
this worktree — see verify notes below for the run that produced this result.

| Mobile | defined | reachable | allowlisted (preview-only) | orphans |
|---|---|---|---|---|
| Sweep result | 71 | 70 | 1 (`GalleryView`) | **0** |

`GalleryView` (Gallery.swift) is a concept/design-system gallery screen exercised only via
`#Preview("Concept gallery") { GalleryView() }` in AppShell.swift — never mounted by a shipped
screen. Allowlisted with reason, not wired up (wiring it into the shipped nav would be a new
feature, out of scope for a reachability sweep).

Both sweeps were run against a real orphan (a throwaway probe component/struct with no call-site)
to confirm they actually fail red before being trusted to report green — see verify notes.

## Phase 0 debt board

| Item | Status |
|---|---|
| P0.1 Click-test harness (Playwright for Electron) + first click tests | OPEN |
| P0.2 safeStorage keyStore (build + migrate provider keys + honest fallback) — **spec said code exists; it does NOT — building from scratch** | OPEN |
| P0.3 Durable reachability sweep (defined-vs-reachable diff, desktop + mobile) | DONE |
| P0.4 Durable IPC-integrity test (renderer↔preload↔ipcMain + registration order) | OPEN |
| P0.5 Durable settings full-loop test (default→UI→save→consumer per key) | OPEN |
| P0.6 v1.5 release prep refresh → HUMAN-GATED STOP | OPEN |
