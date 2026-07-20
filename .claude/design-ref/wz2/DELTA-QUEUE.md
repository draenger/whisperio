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

## Parity round 2 (2026-07-20 ~00:15) — 16 raw → 16 confirmed → all fixed (wf_465d6130)
Intentional deviations / rulings (do NOT re-report):
- G1: Home weekly cloud-spend badge is USD-only, real ProviderPricing aggregation, hidden at
  $0. NO USD/EUR toggle (no honest FX source).
- G3: Recording.source tags only honestly-attributable channels (app/mic/watch/keyboard);
  DictateIntent stays nil — Action Button / Back-Tap / Siri are indistinguishable to the app.
- G14: recap engine hues for Deepgram (#d946ef), AssemblyAI (#ec4899), Mistral (#fb7185)
  RULED final (postdate the mock; hue-separated).
- G16: speaker-rename suggestion chips = real names from the library's speakerNames + generic
  roles (Me/Boss/Client) — not the mock's sample names.
- G6: digest summary Copy action lives in the context menu (design shows only Regenerate).

## Parity round 3 (2026-07-20) — dryness check (infra-flaky; finished via direct + subagent verify)
Refuted (honest-platform-constraint, do NOT re-report):
- Keyboard rewrite gated on `lastInserted != nil` (not any typed text): the real keyboard
  extension can only delete-and-replace text IT inserted (known char count); iOS gives no
  reliable "current sentence" selection over arbitrary typed text (documentContextBeforeInput
  is truncated). The JS mock's `field` variable is omniscient in a way no extension is.
  Same class as "keyboard can't paste silently."
Confirmed → fixed in round-3 fix wave:
- iPad/Mac IPadLiveJournal embedded JournalView without onAdd/onOpenToday, leaving the
  per-book "New page", empty-chapter CTA, and today running-note card as dead no-ops.

## Parity round 4 (2026-07-20) — 5 raw → 5 confirmed → all fixed (wf_a5c6407d)
Rulings recorded (do NOT re-report):
- H3: Scratchpad back/history both route to Journal (iPhone go(.journal); iPad = sheet dismiss,
  Journal is beneath).
- H4 appOnly filter = source ∈ {"app","mic"} or nil(legacy); Watch/keyboard excluded — the
  Settings footnote copy was ADJUSTED from the mock's literal text to match this real behavior.
  "Pick per day" = real per-day source-toggle sheet before generation (skipped when the day has
  a single source).
- H5: iPad daySeed mirrors AppShell digestSeed (ai/raw), cleared on openDay/onBack.

## Parity round 5 (2026-07-20) — 3 raw → 1 unique gap → fixed directly (0c88696)
Scratchpad "Summarize the day now" wired at both call sites (iPhone → today's digest;
iPad dismisses the sheet first). settings-all cluster clean.

## Parity round 6 (2026-07-20) — 3 raw → 2 unique gaps → fixed directly (99a057f)
iPad/Mac Settings sheet: deep pages (models / preset editor / categorization prompts /
GitHub sync / storage / onboarding) now swap the sheet content with an in-sheet toast
banner; keyboard-setup row is iOS-only (iOS extension — nothing to install on macOS,
RULED). settings sub-state resets on sheet dismiss.

## Parity round 7 (2026-07-20) — 4 raw → 3 unique gaps → fixed directly (0ce3cfc)
Split-shell dark mode is real+persisted (@AppStorage wz.split.dark drives \.wz env +
preferredColorScheme; Mac hardcoded theme removed); deep-page back restores parent category
(models/system/sync); Library reading-pane Copy wired to the real clipboard. The reading
pane's "Insert" button remains display-only (desktop insert concept — no target field
exists in this shell; RULED, do not re-report).

## Parity round 8 (2026-07-20) — 7 raw → 7 confirmed → all fixed (889db30)
Rulings: keyboard chip = tri-state truth (on-device green / cloud amber / hidden when the
App Group flag is unreadable — no unconditional claims); Watch duration from AVAudioPlayer;
split Copy uses speaker-labeled text for conversations; SETT_PARENT sweep completed
(content ← categorization prompts + template editor); error phase keeps 3-slot row;
platform-aware empty-state copy.

## Parity round 9 (2026-07-20) — 4 raw → 4 confirmed → all fixed (405ab7e)
KeyboardReturnView translated to English; widget digest glyph = tri-state truth via
WidgetSnapshot.digestIsCloud; composer prompt-mic wired to real dictation; shared
DemoRecording.srcIcon (backtap→"command" RULED — both Swift call sites already used it;
the mock's "more" glyph is not adopted).

## Parity round 10 (2026-07-20) — 3 raw → 3 confirmed → all fixed (d0856d8)
digestIsCloud provenance: nil-summary clears the claim, intermediate writes leave it
untouched, only real summarize claims cloud. Shared PulsingDot on scratchpad's live take.
Note-of-week caption = "Captured from <channel> · <weekday>" from real Recording.source.

## Process
Weaker agents plan → Fable verifies/corrects plans → weaker agents implement
(fresh-read + surgical-edit protocol, per-file ownership) → build gates
(iPhone/Keyboard/Widget/Watch sim builds, Kit swift test) → Fable verifies parity
until dry → commit+push.

## DONE (previous waves)
See SYNC-NOTES.md — settings hub, engines (Groq/Deepgram/AssemblyAI/Mistral),
model-order slots, journal books, RecRow variant D, JournalComposer, onboarding v1,
widgets on snapshot data, watch, iPad split, desktop e1/titlebar/overlay/COMMAND.
