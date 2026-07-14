# Whisperio ↔ Wispr Flow — parity ledger

_Living document. Updated every PR by the autonomous build loop.
Statuses are honest: "shipped" means merged to main AND live-click-tested on the platform
noted; "pending human smoke" means gates green but no human ran the packaged build._

Last update: 2026-07-14 · **Phase 0 COMPLETE + tone/sync-controls/polish merged** · v1.5.0 FINAL, human-gated

| Wispr Flow capability | Whisperio status | Reachable? | Tested (live)? | Notes |
|---|---|---|---|---|
| Dictation + AI cleanup | main, v1.5.0 — rough-first (raw pastes instantly), on-demand Clean up (full/templates/custom), auto opt-in | ✅ desktop | clicks ✅ (toggle persist, usage reset, fail-soft); dictation hotkey flow not yet click-driven | pending human smoke |
| Context-aware tone | IMPLEMENTED on branch `feat/p1.1-context-tone` (rebased onto post-P0/P2 main) — no-screenshot variant: process name only by default (matching is process-name-substring only), window title read-but-unmatched and only ever captured behind an explicit opt-in button; toneMap editable in Settings as a Section card in the polished settings shell; tone resolved at recording time and persisted on the RecordingEntry so on-demand cleanup reuses it later instead of re-reading a possibly-different foreground app | ✅ desktop | unit ✅ (context.ts privacy/matching, settingsManager seeding, transcribe.ts/postprocess wiring, recordingStore snapshot) / clicks ✅ (toggle persist + reopen, toneMap add-entry persist + reopen) | Phase 1 #1 — merge-hold until v1.5 ships |
| Snippets | ❌ MISSING | — | — | Phase 1 #2 — exact-match first, semantic (local MiniLM) later |
| Personal dictionary | manual vocab ✅ (custom + soft-deletable defaults) | ✅ | unit ✅ | auto-learn from edits = Phase 1 #3 |
| Command / rewrite | partial — on-demand transform on recordings (templates/custom instruction) | ✅ desktop | clicks ✅ (fail-soft path) | select-text-anywhere = Phase 1 #4 |
| Wake word | ❌ MISSING | — | — | Phase 1 #5 — local ONNX via JS runtime, no Python |
| Scratchpad | ❌ MISSING | — | — | Phase 1 #6 |
| History | ✅ desktop RecordingsPanel + mobile history/journal | ✅ | clicks ✅ (desktop) | |
| Multi-platform | desktop Win/mac/Linux + iOS + watchOS + iCloud sync | ✅ | macOS live ✅, iOS sim build ✅; Win/Linux = CI installers only | never claim a platform verified that wasn't exercised |
| **Moat: offline** | ✅ fail-soft everywhere; click-tested (Clean up with no provider → inline hint, raw intact) | ✅ | clicks ✅ | zero-config bundled server mac/Linux = Phase 2 |
| **Moat: provider freedom** | ✅ OpenAI / Anthropic / Replicate / ElevenLabs / local / custom; model picker; HTTPS gate | ✅ | unit ✅ | |
| **Moat: no-account / open** | ✅ no account, PolyForm NC source | ✅ | — | |
| **Moat: usage meter** | ✅ per-provider/month, local-only; ElevenLabs credits; local=$0 | ✅ | clicks ✅ (reset) | |
| **Moat: keys in OS secure storage** | ✅ NEW (P0.2): safeStorage keyStore, round-trip-verified migration, honest fallback copy | ✅ | unit ✅ + real Keychain migration observed in dev boot | "where available", never "always" |
| **Moat: no-screenshot** | ✅ nothing reads the screen; privacy guardian test lands with tone | n/a | — | |
| Phase 2 sync-controls | ✅ IMPLEMENTED — branch `feat/mobile-sync-controls` (worktree); `SyncMode` (automatic/onOpen/interval/manual) gates live CloudKit-import publishing + foreground/timer nudges; Home gets a bigger Sync button + timestamp in `.manual`; Settings picker + honest "iOS may still receive changes in the background" copy | ✅ mobile (Kit) | Kit unit ✅ (130/130, 12 new); iOS sim build ✅; reachability ✅ (72/72, 0 orphans) | ON MAIN — ships with mobile build 41 |

## Orphan list (defined-but-unreachable views) — must stay EMPTY

Durable guardians active (orphan = failing test):
- Desktop: `tests/reachability.spec.ts` — 13 defined / 13 reachable / 0 allowlisted / **0 orphans**
- Mobile: `mobile/WhisperioApp/Scripts/check-reachability.sh` — 72 defined / 71 reachable / 1 allowlisted (`GalleryView`, preview-only) / **0 orphans**
- Both mutation-sanity-checked (a planted orphan fails the mechanism).

## Phase 0 debt board — ✅ COMPLETE (2026-07-14)

| Item | Status |
|---|---|
| P0.1 Click-test harness | ✅ Playwright `_electron` drives the real built app; 3 click specs; CI (xvfb) |
| P0.2 safeStorage keyStore | ✅ built FROM SCRATCH (spec claimed it existed — it did not); migration w/ round-trip verify before plaintext clear; honest fallback |
| P0.3 Durable reachability sweep | ✅ desktop test + mobile script, allowlists justified, mutation-checked |
| P0.4 Durable IPC-integrity guardian | ✅ 10 tests: renderer↔preload↔ipcMain three-way match + registration order |
| P0.5 Durable settings full-loop guardian | ✅ 8 tests; **caught a real bug**: `inputDeviceId` saved but never fed to `getUserMedia` (mic picker was a silent no-op) — fixed |
| P0.6 Release prep → HUMAN-GATED STOP | ✅ this commit — see below |

## Final v1.5.0 sweep (2026-07-14, after tone + sync-controls + polish)

typecheck 0 · **610/610** unit (desktop) · **5/5 e2e clicks** · Kit **130/130** · iOS sim build ✅ · reachability ✅ (0 orphans both platforms) · coverage 96.74/90.75/98.94/96.74 · new guardian: privacy-grep-gate (no-screenshot moat)

## HUMAN GATE — what ships v1.5.0 (Claude never does these)

1. Desktop: manual smoke on a packaged build → `git push origin main:release`
   (pipeline tags v1.5.0 + builds NSIS / signed+notarized dmg / AppImage+deb + publishes).
2. Mobile: Xcode → archive → TestFlight — **build 41** on main (includes sync fix, digest
   sync, wiring, sync-controls).
