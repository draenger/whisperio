# Repo→mock sync notes (from draenger/whisperio@main, 2026-07-20 — post wz2 delta waves + 14 parity rounds, DRY)

## wz2 delta status (current shipped state, main @ 077eb28+)
Two delta implementation waves + fourteen adversarially-verified parity rounds landed the wz2
redesign 1:1 across all surfaces. Net: solid-primary theme (gradient reserved for decorative
surfaces), 9-step onboarding as the real first-run flow, live iPad/Mac library + journal,
multi-engine diarization, real GitHub journal-book mirroring, recap usage&cost, real capture-
channel source tagging. Parity harvest (14 rounds, adversarially confirmed): 13→16→1→5→1→2→3→7→4→3→3→2→1→0 — DRY at round 14; 60 gaps closed total.
Ruled deviations are in DELTA-QUEUE.md (App Group / CloudKit-production remain the only
portal-gated open items). Sections below reflect the CURRENT code, not the pre-delta repo.

## Theme (Theme.swift)
- primary = accent (solid teal); primaryInk = #02110f dark / #ffffff light (contrast ink on teal).
  All action fills (buttons, mic circles, icon tiles, record circle) use primary/primaryInk.
  gradient token kept ONLY for decorative surfaces: recap hero card, dynamic-island circle,
  dock tile, contact avatars.

## Home (HomeView.swift)
- Header right: weekly cloud-spend badge (USD, real ProviderPricing aggregation, hidden at $0,
  tap→Recap) · HomeSyncButton (manual) or HeaderSyncGlyph · settings. No edit/book icons.
- Pinned row above search (never scrolls): "My journal" tile (primary pencil badge, MY JOURNAL
  eyebrow, real digest preview, 2-line clamp) + 76pt Recap streak tile (bolt, real streak "Xd"
  / em-dash at 0, uppercase RECAP) → openRecap.
- HomeSyncButton: compact 38pt tri-state header icon (due sync-arrows / syncing spinner /
  done cloud), driven by real recordings/digests sync state.
- Dictate pill: SOLID primary h56 r16, no border overlay; people btn 56×56.
- RecRow meta: category dot+label (hue) · when · dur · spacer · engine icon (cloud→amber /
  lock→green). Leading glyph = real capture channel (Recording.source: app/mic/watch/keyboard).
- Empty states: mic 34 faint "No recordings yet"; filtered: cat icon "Nothing in X".

## Recording (RecordingView.swift)
- bg=t.bg2. Top: EngineChip(label: processing?"Transcribing…":engineLabel, icon: processing?'spark':'cpu') + clock mono15.
- engineLabel: "Apple Speech · on-device"/"OpenAI · cloud"/"ElevenLabs · cloud".
- Status SectionLabel: Starting…/Listening…/Transcribing…/Couldn't transcribe.
- Main text FD 23 med lh6: live transcript (text color) else hint muted; error red.
- ListeningGhost(phase, 96) centered, above waveform. phases: processing→note, error→wtf, else listening.
- Waveform 34 bars h70 accent | processing: spinner+"Working…" mono13 accentLite | h70 empty.
- Controls: X circle 56 surfaceUp+line · stop 84 white stop icon 30, bg red when listening else elevated, ring red .16 8px; error → second X.

## Conversation (ConversationView.swift) — CLOUD diarize (multi-engine), NOT on-device
- Any diarizing engine the user has configured (ElevenLabs Scribe / Deepgram Nova / AssemblyAI
  Universal), picked by model-order then EL→DG→AAI fallback. EngineChip names the resolved
  engine; consent sheet + setup copy name whichever engine is keyed in (conversationEngineHint).
- During listening/paused/processing: static "Speaker 1"(accent) / "Speaker 2"(#3da2f7) chips +
  faint "2 voices" caption (diarization-enabled cue; NO fake active-speaker pulse — no realtime
  per-speaker signal exists).
- bg2. Phases: starting/setup/listening/paused/processing/error.
- Top: EngineChip("<engine> · speakers", people) or ("Transcribing…", spark) + clock.
- SectionLabel status: Starting…/Setup needed/Recording conversation…/Paused/Transcribing speakers…/Couldn't transcribe.
- Hint FD23 muted: listening "Recording everyone near the microphone. Pause anytime — tap stop when the conversation is over."; paused "Recording is paused — nothing is being captured. Resume to continue the same conversation."; processing "Detecting who said what…"; setup long text about ElevenLabs Scribe + consent + key.
- setup: GradButton "Open Settings" (settings icon); consent sheet ElevenLabs if no consent.
- Middle: listening→Waveform 34/70; paused→pause icon+"Paused" mono13 accentLite; processing→spinner "Working…".
- Controls: X 56 · stop 84 (red when capturing incl paused, else elevated, disabled) · pause/play 56 (only listening/paused).
- Done: transcript + segments saved; copied to clipboard; → Detail.

## Detail (DetailView.swift)
- Header "Transcript" right: ⋯ more menu 38×38 (Retranscribe audio → Apple on-device / OpenAI /
  Groq / Mistral (cloud) / ElevenLabs / Deepgram / AssemblyAI (keep speakers); disabled "No
  audio saved" when no file; conversation + non-diarizing engine → destructive-role confirm
  "Speakers need the cloud" / "Retranscribe anyway"; makeDiarizingProvider never substitutes).
- Speaker rename: bottom sheet (not alert) — "What they said" up to 3 real quoted excerpts from
  that speaker's segments + name field + suggestion chips (real names from library speakerNames
  + generic roles Me/Boss/Client).
- Badges row: SourceBadge + PrivacyBadge + Spacer + categoryMenu chip (cat icon+label+chevD, hue-tinted pill mono10; menu reassigns → store).
- Meta mono11: app · when · dur · N words.
- Conversation card (segments non-empty): SectionLabel "Conversation" + right "Name with AI" chip (spark, mono10 semibold, accentLite, accent .14 bg pill) or spinner; rows: speaker chip (7px dot color + name mono11 semibold + pencil 8.5, tap→rename alert) + text 16 lh4. Speaker colors: [accent, orange, purple, pink, mint, yellow] by order index.
- Else transcript card: SectionLabel "Transcript" + text 17 lh4 padding 18 surface r18.
- retranscribingCard: spinner + "Retranscribing…" mono13.
- rewriting → spinner "Rewriting…"; render card: SectionLabel preset name + cloud badge, text 16, Copy/Share ghost row.
- Bottom: Copy · Share · Rewrite ghost buttons flex.
- RewriteSheet: title "Rewrite with…" + × circle; sub "Reformat this transcript with AI. Your text is sent to the cloud model."; presets rows (meta sub "Build a new template from your voice"); "Or write your own" mono textarea (min96) + hint + GradButton "Rewrite with this" (disabled empty). Custom id="custom" name "Custom".
- Toasts: Copied! / Rewrite failed / Retranscribed · Apple on-device.

## Scratchpad (ScratchpadView.swift)
- Separate screen from Home (edit icon). Header "Whisperio": clock→back(home) + settings.
- noteHeader: "Today" FD22 semibold + "EEE, MMM d" mono11.5 faint + "N takes · M words".
- Stages idle/listening/processing. processing row: spinner + "Transcribing…" mono11.5 accentLite.
- Empty: "Say something — every take lands here, in one running note for the day." ui14 muted.
- Ghost: 94, listening while listening; note 3.2s on keep; wtf 2.6s on cancel/fail; hidden otherwise. (No 'start' phase in app.)
- Footer idle+has entries: "At midnight this note rolls into your Journal" mono11.
- Controls same as mock (Continue note pill / X-wave-check bar).

## Journal (JournalView.swift)
- No header recap button (recap now via Home's streak tile). Books shelf + horizontal book-chip
  row (real automaticBooks + manual books; no fabricated active chip). Per-book "+" menu (New
  page / New chapter[custom only]); onAdd → composer, onOpenToday → scratchpad (wired on phone
  AND iPad/Mac live journal via sheets).
- Today's day card: primary pencil badge, "TODAY · RUNNING NOTE", real "N takes so far — open
  to continue" → scratchpad. Other days: generic digest card (dayTitle + "N notes" + category
  tags; ready green check "Summary ready" / else GhostBtn "Generate summary").
- Digest day (DigestDayView): no-summary state offers "Generate summary" + "Start from scratch"
  (real dictation → Save via digests.storeComposed). Summary-ready row: single Regenerate ghost
  (Copy moved to context menu). startInManual seeds manual editor from composer's Blank page.

## Settings additions
- PresetEditorView: page "Edit template"/"New template": Name field (ui14.5), Instruction TextEditor mono13 min180, hint "How Whisperio should rewrite a transcript…", GradButton "Save template" (check, disabled unless both), GhostBtn "Delete template" (existing only) + confirm alert (seed: "hides built-in… Restore default templates").
- StateBanner component: tone ok/warn/bad → green/amber/red; icon + title 13.5 semibold + sub 12 + action pill bordered; bg color .10 r14.
- iCloud mismatch banner (sync page, when mode=iCloud but local-only): warn cloud "iCloud sync is paused on this device" + "Resume iCloud sync".

## Keyboard extension (KeyboardRootView.swift) — Classic, themed
- Bare tray: dark bg #0b141f, light #d4d2e2. keyFill white .13/.white; specialFill white .06/black .06; keyText white/#0c1822; accent #1cc8b4/#0f8478; return key = solid accent white text (only colored key).
- Top bar: globe key 30×30 r8 specialFill (if needed) · logo 16 + "Whisperio" 13 semibold · Spacer · ✨ rewrite menu 30×30 (only when lastInserted — honest: extension can only delete-and-replace text IT inserted, no reliable arbitrary-text selection on iOS; menu = non-meta presets) · on-device chip (lock 9.5 + mono 10.5, green .12 bg pill) · mic 38 SOLID accent circle, primaryInk icon, shadow accent .4.
- Full-access banner: ⚠ + "Turn on Full Access in Settings > Keyboard to use the mic." accent tint r12.
- Suggestions row: ≤3 pills specialFill capsule 14.5 medium.
- Rows: letters qwertyuiop / asdfghjkl (inset 16) / shift+zxcvbnm+⌫ (flex 1.5, w63) / 123·space(42h)·return(78w). Planes: numbers row1 1234567890 row2 -/:;()$&@" row3 .,?!' ; symbols []{}#%^*+= _\|~<>€£¥•. Key h40 r7; press: scale .97 opacity .68.
- Mic = bounce-to-app (no inline dictation possible in extension). Keep Pro inline as design concept variant.

## Watch (WhisperioWatchApp.swift) — minimal real UI
- ScrollView: "Whisperio" headline; big circle 78 mic.fill/stop.fill 30 bold white, bg teal #1cc8b4 / red when recording; status caption2 secondary: "Tap to dictate"/"Listening… tap to stop"/"Transcribing on iPhone…"/"Done · sent to iPhone"/"Microphone denied"; transcript footnote in gray .2 r10 card when present.

## Widgets (WhisperioWidget.swift)
- Families: accessoryCircular (mic.fill 22 bold), accessoryRectangular (mic 16 + "Dictate" 15 semibold), systemSmall (mic 30 in teal circle 64 + "Dictate" 14), StandBy (solid accent mic circle, accentInk). Control Center button (iOS18): Label "Dictate" mic.fill tint accent. containerBackground fill.tertiary.
- App Group group.ai.whisperio.mobile pending portal assignment → data-driven widgets show honest empty states until the group is assigned and the entitlements/profiles restored.

## GitHub mirror (WhisperioKit/GitHubSync)
- SyncPlan emits: per-recording transcript.md (+render.md if rewritten), per-day YYYY-MM-DD-
  summary.md, AND journal books — journal/weeks/YYYY-Www.md (ISO week) + journal/topics/
  <category>.md, each linking back to the mirrored transcripts. GitHubSyncView "What syncs"
  checklist: Transcripts / Journals / Daily summaries / Rewrites (kept in lockstep with SyncPlan).

## Onboarding (OnboardingView.swift) — the real first-run flow (SetupView deleted)
- AppShell RootView gates on didCompleteSetup → OnboardingView; finish() sets the flag.
- 9 steps (0-8), 8-seg progress: welcome / privacy (2 cards + real provider-connect sheet:
  ElevenLabs/OpenAI/Deepgram, key VERIFIED via ProviderKeyValidator against each provider's
  auth endpoint, stored in Keychain) / languages / keyboard / Back-Tap (honest — no fake "is on"
  state) / first note (+ Good-to-know card) / capture grid / features / ready (PrivacyBadge
  reflects real choice).

## Recap (RecapView.swift)
- Hero (gradient, decorative), stat cards, words/day chart, Usage&cost card (real per-engine
  minutes × ProviderPricing published rates; on-device Free; advisor block skipped per no-mock),
  categories, note of week. Compact week label (JUN 16–22 same month). Share = real rendered
  recap-card image (ImageRenderer), re-rendered on data/theme change.
