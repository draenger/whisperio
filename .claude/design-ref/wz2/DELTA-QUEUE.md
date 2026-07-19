# wz2 delta queue — live design chase ledger
Updated: 2026-07-19 ~21:00 (post-compaction sweep; ALL design files re-pulled and diffed)

Desktop (wz-*) — NO changes (wz-recordings diff is unicode-escape cosmetics only).
New vendored refs: mob-single.jsx (Screens gallery / device entry), mob-home-options.jsx
(6 home concepts — canvas exploration, NOT app scope; Home stays option 1 "Library").
.prev files hold the previous pulls for exact diffs.

## OPEN deltas (mobile) — planning fleets running (wf_de8b8fea, wf_b8e4992d)

Cluster HOME (plan:home)
- D1 home-sync-compact: HomeSyncButton → compact header icon (due/syncing/done states), moves into WHeader right stack; body row removed.
- D2a solid-primary Home: 40x40 group tile, Record pill (border none), 72x72 record circle → solid t.primary.
- D3 recrow-meta: meta row = category dot+name (hue) · when · dur · spacer · engine icon (cloud amber / lock green). Needs real category/duration/engine fields on Recording.

Cluster JOURNAL (plan:journal)
- D4 journal-books-chips: books chip row under Journal section label (real books from DigestStore, active state).
- D4b journal header bolt/recap button removed.
- D6b PhoneJournalNew initialMode prop (gallery affordance — verify if app needs a route param).
- D2b solid-primary: JournalNew 36x36 tile.

Cluster CONVERSATION (plan:conversation)
- D5 conversation-segments: speaker-labeled segments (accent/#3da2f7, speakerNames, "Speaker N") w/ fallback to single title. Real diarization from AssemblyAI/Deepgram/ElevenLabs; storage in Recording model if missing.
- D6a PhoneDetail initialSheet prop (gallery affordance — verify).
- D7 "Engines:" → "Model order:" summary row, value from real Settings.modelOrder.

Cluster SETTINGS (plan:settings)
- D8 remote-connectors: "Connections" → "Remote connectors" BELOW model-order; device row removed from list; engine selection starts nil; expanded engine gains "Manage account · X" / "Usage console" / "Open server dashboard" buttons (real console URLs).
- D9 git-backup: copy += "journals"; new SettRow Journals "Days, weeks and topic books".

Cluster ONBOARDING (plan:onboarding)
- D10 onboarding v2: 9 steps (0-8), 8-seg progress; step1 = 2 selectable privacy cards + REAL provider-connect sheet (ElevenLabs/OpenAI/Deepgram, key verify via API, Keychain, Settings update); NEW step4 Back-Tap (honest detectability), step5 "Good to know" card, NEW step6 triggers grid, NEW step7 features list, step8 badge reflects choice; welcome badge removed.

Cluster RECAP (plan:recap-usage)
- D11 recap usage&cost card: per-engine minutes (real aggregation) + static public rate table costs; SKIP fabricated plan-advisor block.

Cluster THEME (plan:theme-primary)
- D12 primary/primaryInk tokens in WZTheme; GradButton → solid primary + shadow; scratchpad buttons; widget StandBy/ControlCenter/LockScreen-combo tiles; keyboard classic mic; onboarding mic. Gradient stays for decorative surfaces (recap hero, island, dock, avatars).

## Parity round 1 (2026-07-19 ~23:30) — 18 raw → 13 confirmed → 11 fixed (wf_f04d4495)
Intentional deviations (do NOT re-report):
- F4: no "New chapter" for automatic books — auto books are recomputed live from real
  recordings; a manually inserted chapter would be fabricated state. Custom books keep it.
- F9 partial: StorageView ships the honest subset (3-way real usage bar, granular real
  deletes). SKIPPED pending real infra: per-type storage-location policy, Optimize iPhone
  storage / Free up space, Delete-from-iCloud-only, Remove-unused-models.
- F11 adjusted: conversation speaker chips are STATIC (no fake alternating active-speaker
  pulse — no real-time diarization signal exists; batch diarization only).
- Wave-1 Home header bolt button removed again in favor of the design's pinned Recap streak
  tile (F1) — recap entry point is the body tile, per PhoneHome redesign block.

## Process
Weaker agents plan → Fable verifies/corrects plans → weaker agents implement
(fresh-read + surgical-edit protocol, per-file ownership) → build gates
(iPhone/Keyboard/Widget/Watch sim builds, Kit swift test) → Fable verifies parity
until dry → commit+push.

## DONE (previous waves)
See SYNC-NOTES.md — settings hub, engines (Groq/Deepgram/AssemblyAI/Mistral),
model-order slots, journal books, RecRow variant D, JournalComposer, onboarding v1,
widgets on snapshot data, watch, iPad split, desktop e1/titlebar/overlay/COMMAND.
