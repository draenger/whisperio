# wz2 delta queue — live design chase ledger
Updated: 2026-07-20 — LOOP CLOSED (round 14 dry). All D1-D12 deltas shipped; history below.

Desktop (wz-*) — NO changes (wz-recordings diff is unicode-escape cosmetics only).
New vendored refs: mob-single.jsx (Screens gallery / device entry), mob-home-options.jsx
(6 home concepts — canvas exploration, NOT app scope; Home stays option 1 "Library").
.prev files hold the previous pulls for exact diffs.

## Deltas D1-D12 (all SHIPPED via waves 1-2 + parity rounds)

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

## Parity round 11 (2026-07-20) — 3 raw → 3 confirmed → all fixed (0c1333f)
Speaker 7+ fallback = t.cyan (no modulo wrap); This-week widget headline = real week sum;
Recent widget trailing count via optional WidgetSnapshot.totalRecordings.

## Parity round 12 (2026-07-20) — 2 raw → 2 confirmed → both fixed (328ad86)
totalRecordings WRITE landed for real this time (r11's replace-anchor miss); Scratchpad
header curly apostrophe. Both were completions of prior rounds' own edits.

## Parity round 13 (2026-07-20) — 1 raw → 1 confirmed → fixed (077eb28)
Widget snapshot refresh centralized on items.didSet (covers delete/edits/CloudKit arrivals,
not just add). Three of four clusters returned EMPTY.

## Parity round 14 (2026-07-20) — 0 raw → 0 confirmed. DRY. Loop closed.
Final trajectory: 13 → 16 → 1 → 5 → 1 → 2 → 3 → 7 → 4 → 3 → 3 → 2 → 1 → 0 (60 gaps fixed
across 13 fix rounds; every fix adversarially confirmed, gated, and pushed to main).

## Settings repair wave (2026-07-20) — 23 planned gaps → rulings R1-R11 → shipped
Real features from design: ProviderID.replicate + .selfHosted with full TranscriptionProvider
implementations (Replicate HTTP API w/ files+predictions+polling; Self-hosted = OpenAI-compatible
/v1/audio/transcriptions for whisper.cpp/faster-whisper — consent-sheet SKIPPED for self-hosted,
design's green own-server banner instead); Apple Intelligence row in On-device models backed by
REAL FoundationModels (SystemLanguageModel availability drives the row; AppleIntelligenceChatClient
serves digest/categorize/rewrites when no OpenAI key — OpenAI preferred when configured); OpenAI +
ElevenLabs model chip pickers (new elevenLabsModel setting; scribe_v2/v1 verified real); categorize
page rebuilt per design (Auto-categorize toggle honored by DigestStore, single Categorization
prompt = classificationInstruction, Categories group with REAL custom-category CRUD persisted in
settings); rewrite preset seeds = design's 6 (authored Action items + Summary prompts; dropped
english-message/slack/tweet seeds); language row = inline chip grid (Menu removed); hub rows on
SettRow (17pt chevron); SettGroup title optional (modelsList group label dropped); Quick dictation
= two-up GhostButtons (Siri tip in sheet, shortcuts:// open); triggers/keyboard/storage copy fixes.
RULED SUPERSETS (richer than mock, kept + logged): 6-trigger guide hub w/ drill-ins; keyboard
live-detection steps + status + mic explainer; GitHub 5-field BYO-token + Status/Sync now (no fake
OAuth CTA) + design lead copy restored; iCloudMismatchBanner; Developer pending-sync-queue;
self-hosted optional Bearer field; real "Open server dashboard" button (mock's was a no-op).

## Sizing audit r1 (2026-07-20) — 42 raw → 29 confirmed (adversarial verify) → fixed
Highlights: SquareIconButton glyph 19→17; CategoryFilterChip 12.5/12px/gap5; My-journal tile
r16 + asymmetric 12/14 padding + eyebrow 10; 7 iPad gaps; 5 keyboard-extension gaps (incl.
rewrite-preset popover font 14→13); watch + onboarding + journal singles. Detail's Rewrite
button CONFIRMED 1:1 (report's root cause was label truncation on narrow widths → global
minimumScaleFactor guard on GhostButton/GradButton labels, 09f2a85).

## Sizing loop rounds 2-14 (2026-07-20/21) — DRY at round 14
Trajectory 29 → 22 → 14 → 9 → 9 → 10 → 1 → 1 → 2 → 2 → 1 → 1 → 2 → 0: 103 adversarially-
confirmed box-model/typography gaps fixed across 13 rounds (commits f1970c2, 8bddce2, 270cf7f,
9977dcf, f001008, f85b96e, 5038785, 353bb72, fe2d7ee, b3e9bc6, 37117e2, 1fcb187). Notable
class-level lessons institutionalized: Spacer inside a spacing HStack participates in spacing
(keyboard row-2 inset); .frame(alignment: .leading) vertical-centers (Recording/Conversation
status blocks → .topLeading); ZStack default-centers a fixed-height keyboard panel (→ bottom
anchor); .fixedSize() hug is a ROW-flex idiom — column-flex children stretch (Restore-templates);
semantic fonts (.footnote/.caption2) drift from literal design px on watchOS; @GestureState is
the only stuck-proof store for row-swipe state (RecRow scroll fix). CategoryFilterChip = FUI face
+ tinted selected state (CategoryTag stays mono — different component). TestFlight: build 59
(settings wave + audio/scroll), build 60 (rounds 4-6 + gesture rework + Copy-on-card), build 61
(rounds 7-13 tail: watch 11.5/11pt, keyboard inset+anchor, tinted chips, dashed key field,
composer CTA guard, tracking nits).

## User-directed deviations (2026-07-20, override design)
Detail: Copy moved OFF the bottom bar onto the transcript/conversation card header (26×26 ghost
icon, check-flip); bottom bar is now Share + Rewrite two-up. Categorize seed rows render without
chevron/onTap (mock's onTap is a no-op stub — no dead affordances).

## Feature-gap wave (2026-07-21) — 7 confirmed design-feature gaps -> shipped (0d566b7)
Completeness audit (existence/behavior, 6 finders + skeptics, 0 refuted): EdgeStates finally WIRED
(real NWPathMonitor offline banner on Home; ProviderChain.onFallback consumed -> cloud->on-device
warn banner in Recording/Scratchpad, no Retry ruled OK; OldDeviceView real capability gate via
SFSpeechRecognizer.supportsOnDeviceRecognition, once-only, toggle bound to real cloudConsentGranted;
Conversation skipped honestly - no chain there); onboarding languages persist (preferredLanguages +
language=first); Recap reachable in the split shell (streak pill + dimmed panel, RecapView(bare:),
mount point invented - design had none, logged); REAL Live Activity dictation (ActivityKit Lock
Screen + Dynamic Island, Stop via LiveActivityIntent -> SharedStore flag, all recording exit paths,
silent-skip when activities disabled, iOS-gated for Mac); desktop chain labels + platform launch
label. Kit 220 tests green.

## Feature-gap round 2 (2026-07-21) — 6 confirmed -> shipped
r2 dryness check (workflow stalled on infra; redone via direct agents): 3 MAJOR onboarding
no-mock violations fixed — step 2 languages now seed from REAL installed keyboards (+one-shot
migration repairing build 62's "pl"-as-language regression for untouched seeds only); step 3
"Go to Settings" actually opens Settings and drives the keyboard toggle from the real
keyboardEverLoaded heartbeat (Full Access never claimed); step 5 guided dictation is a REAL
LiveDictation session with mic+speech permissions (canned typewriter survives only as the
labeled permission-denied demo). Minors: Home first-run empty state = the designed StateHome
scene; iPad/Mac sidebar search + All/Keyboard/Watch tabs are real filters; Live Activity gained
the honest post-save "Saved · tap to record" phase (success paths only, 6s linger,
whisperio://dictate tap). RULED: LA compact regions show check+"Saved" (full copy on lock
screen/expanded — ActivityKit width constraint); processing window keeps .recording phase (no
fabricated third state).

## Feature-gap round 3 (2026-07-21) — DRY. Feature-completeness loop closed.
All 13 shipped fixes from waves 1-2 re-verified in place (file:line audit), onboarding 0-8
honest, LA both phases, working tree clean, Kit 220/220. Trajectory: 7 -> 6 -> 0.
Every design surface now: pixel parity (sizing loop, 103 gaps) + feature parity (13 gaps) +
honest-state policy enforced end to end. TestFlight: 63 VALID.

## Process
Weaker agents plan → Fable verifies/corrects plans → weaker agents implement
(fresh-read + surgical-edit protocol, per-file ownership) → build gates
(iPhone/Keyboard/Widget/Watch sim builds, Kit swift test) → Fable verifies parity
until dry → commit+push.

## DONE (previous waves)
See SYNC-NOTES.md — settings hub, engines (Groq/Deepgram/AssemblyAI/Mistral),
model-order slots, journal books, RecRow variant D, JournalComposer, onboarding v1,
widgets on snapshot data, watch, iPad split, desktop e1/titlebar/overlay/COMMAND.

## Mac-native parity wave — Electron shortcuts + overlay (2026-07-23)
User: "Ta wersja na macos nie ma funkcjonalnosci ktore ma appka elektronowa czyli skroty i overlay."
Ported natively into the WhisperioMac target (MacApp/):
- MacHotkeys.swift — Carbon RegisterEventHotKey global hotkeys mirroring desktop/src/main/dictation/hotkeyManager.ts: dictation ⌃⇧Space, command ⌃⇧C, dictate&send opt-in; persisted wz.mac.hotkey.*; KeyComboRecorderView + "Shortcuts" section in MacGeneralSettingsView.
- MacOverlay.swift — NSPanel pill per screen (nonactivating, .screenSaver level, all Spaces + fullscreen, bottom-center +40pt), phases armed/recording/transcribing/pasting/done, teal #1cc8b4 / command #7cc0fb, hover hint, on-device badge.
- MacDictationSession.swift — toggle state machine with monotonic sessionId, 60s transcribing timeout, Esc global+local monitors while active; reuses shared LiveDictation + SettingsStore; command mode rewrites CLIPBOARD via makeChatClient (never pastes the spoken instruction).
- MacAutoPaste.swift — NSPasteboard + CGEvent ⌘V (AXIsProcessTrusted gate; untrusted → notification, text left on clipboard), optional Enter for dictate&send.
- WhisperioMacApp.swift — hotkey wiring at init, MenuBarExtra (Dictate/Open/Settings/Quit).
DEFERRED (logged): Electron's outputRecordingHotkey (system-audio capture) — needs ScreenCaptureKit audio tap; separate wave.
Also: onboarding privacy copy now says iPad/Mac instead of a literal "this iPhone" (OnboardingView.deviceWord).
Gates: WhisperioMac + WhisperioApp (iPad sim) builds green.

## OpenAI diarization — both apps (2026-07-23)
Design promise "OpenAI up to 4 speakers" delivered (was the last conversation-engine gap):
- iOS/Mac: OpenAIProvider conforms to DiarizingProvider via gpt-4o-transcribe-diarize (response_format=diarized_json); OpenAISegmentMapper in WhisperioKit/Conversation.swift (+tests, 224 green); priority ElevenLabs → OpenAI → Deepgram → AssemblyAI in makeConversationTranscriber/conversationEngineHint; copy updated in ConversationView/Onboarding.
- Electron: openAITranscribeDiarized in transcribe.ts + openAISegments mapper (first-appearance speaker ids); same priority order; RecordingsPanel hint copy; tests extended (693 green, coverage 91.8%).
Gates: swift test + iOS/Mac builds + desktop typecheck/coverage all green.

## Mac desktop-design Settings wave (2026-07-23)
User: native Mac didn't match the desktop design; trigger settings missing/broken.
- NEW MacApp/MacSettingsShell.swift — wz-shell-SPEC 1:1: Settings window 760×780, sidebar 198 ("SETTINGS", tab list, version badge), StatusHeader (status dot / dictate keycaps / engine chain / AI cleanup), autosave footer pulse; tabs General (launch-at-login + dark toggle on shared wz.split.dark), Hotkeys (4 KeyComboRecorderView rows), Updates (TestFlight card).
- NEW MacApp/MacSettingsTabs2.swift — Providers (full chain + per-provider keys/models on real WhisperioSettings fields), Audio (input device list → wz.mac.inputDevice; honest note it's not consumed by LiveDictation yet), Recordings (real AudioStore/RecordingsStore stats + Reveal in Finder).
- Gear in split shell on macOS opens the native Settings window (showSettingsWindow:); iPad keeps full-shell takeover.
- SettingsView macOS: broken "Set up dictation triggers" (iOS-only TriggerGuides) replaced with "Global hotkeys" row opening the native window.
Deviations logged in-code: single vocabulary field doubles as OpenAI prompt (engine has one field); "AI vocabulary correction" maps to cleanupEnabled. Gates: Mac + iOS builds green (both agents, first attempt).

## Model-settings repair wave (ultracode, 2026-07-23)
User: "settingsy modeli zjebane na wszystkich appkach / strona edycji remote modeli nie pokazuje się / model pickery / scroll". Diagnose workflow (3 investigators + 17 adversarially confirmed findings) → fix workflow (3 implementers + fresh-eyes reviewer). Shipped:
- ROOT CAUSE: SettingsView modelCategory expanded provider config rendered AFTER the whole 8-row connector list (~550pt off-viewport, pickers detached under Self-hosted) → TRUE ACCORDION: providerConfig(id) inline under the tapped connectionRow (connectorSection helper), transition+animation preserved; consent flow untouched. Same fix in Mac ⌘, Providers tab (configPanel inline under expanded chainRow; whole row clickable, was gear-only).
- ElevenLabs model chips were a dead control (model never passed to provider) — threaded via provider(for:); Replicate chips persisted bare slugs forming invalid API paths — catalogModelPaths mapping + '/'-passthrough + openai/whisper fallback; whisper-diarization chip REMOVED (schema mismatch — file_url/file_string input, segments-only output; would be a dead control).
- Empty-string model defaults now display-highlight the catalog default chip (effectiveModelID, no storage write); OpenAI free-text field honestly labeled as same storage as chips.
- CloudConsentSheet scrollable (accept/cancel were clipped in .medium detent).
- Hub<->category scroll reset: .id on the ScrollView ITSELF (reviewer empirically proved content-level .id keeps contentOffset).
- Split-shell engine menu: 3 → all ProviderID cases with existing consent gating.
- Mac: DigestPromptStore injected in both scenes (crash on Categorization prompts); Providers tab rebuilt on modelOrder slots (duplicates safe, move/remove by index); Settings window minHeight 780→580.
Gates: iOS+Mac builds, Kit 224 tests — green. Reviewer verdicts: 2 residuals found and fixed inline (scroll .id placement, diarization chip).

## Build-68 Settings-crash response + Intelligence provider config (2026-07-23)
CRASH (iPhone build 68, "entering Settings kills the app"): hunt workflow (3 hunters + verify, 13 agents) EXONERATED the committed 65→68 range — static hunk audit + dynamic Release-sim replay with seeded hostile user state (duplicate slots, stale replicateModel, pl/en, custom cats/presets) = zero crashes; ASC has no crash submissions. Prime remaining suspects: (a) CloudKit mirroring SIGTRAP (real .ips on this Mac today, build 49, com.apple.coredata.cloudkit.queue PFCloudKitSetupAssistant) — timing matches the Production schema deploy, fires ~5s after launch regardless of visible screen; (b) SwiftUI-internal teardown traps in 68's only entry-path structural deltas. Shipped low-risk hardening: ScrollView .id() page-swap reset replaced with ScrollViewReader+scrollTo (hierarchy stays intact), providerConfig explicit per-provider .id, Developer diagnostics guards ubiquityIdentityToken before CKContainer(identifier:) (uncatchable NSException otherwise). Awaiting the tester's .ips for definitive confirmation.
NEW FEATURE: explicit STT-vs-LLM split — WhisperioKit IntelligenceProvider {auto, appleIntelligence, openAI} (tolerant decode, 4 new Kit tests), makeChatClient honors the pin, "Intelligence" section in iOS Settings (provider chips + chat-model chips gpt-4o-mini/4o/4.1-mini + split footnote) and in Mac ⌘, Providers tab. Reviewer's two findings fixed: ModelsView Apple-Intelligence row now honors the pin; Mac hides the chat-model picker for pinned-but-unavailable AI (mirrors iOS honesty), status copy no longer implies an OpenAI fallback serves.
Gates: Kit 228, iOS+Mac builds green.

## CloudKit crash-loop breaker (2026-07-23, build 70)
Build 69 still dies for the user → confirms the non-UI suspect (CloudKit mirroring SIGTRAP, uncatchable in-process). Shipped LaunchSentinel (WhisperioKit): consecutive-early-death counter in UserDefaults; 2 straight launches that die before 10s-alive (or before backgrounding/graceful quit) → next launch pins BOTH sync stores to local via the existing no-account fallback path (storageMode untouched, iCloudResumeAvailable=true so the Settings "Resume iCloud sync" banner shows; manual resume resets the streak). Wired in RecordingSyncStore/DigestSyncStore convenience inits + iOS AppShell delegate + WhisperioMacApp init. 6 new Kit tests (234 total). App can no longer be perma-killed by broken cloud state.

## Settings-crash — BREAKTHROUGH (2026-07-24, in progress)
Pulled device diagnostics over USB (pymobiledevice3 crash pull → /Volumes/DevDisk/whisperio-build/iphone-crashes/). NO WhisperioApp .ips exist on device; the daily analytics file (Analytics-2026-07-24-020007...synced) contains ~20 Whisperio crash aggregates: **"Thread stack size exceeded" / "Could not determine thread index for stack guard region" — EXC_BAD_ACCESS SIGSEGV KERN_PROTECTION_FAILURE at stack-guard addresses = STACK OVERFLOW (infinite recursion), main thread**, app 1.4.1, one record tagged bundleVersion 68, several without the field (schema suggests they may PREDATE 68 — the 65→68 exoneration hunt may have searched the wrong range), TWO deviceIds (iPhone + likely iPad). Reproduces deterministically for the user on entering Settings; clean-state sim (Debug+Release, hub+models+open accordion) does NOT reproduce → recursion depth is user-state-dependent.
Also found: JetsamEvent 2026-07-23 killed `kbd` with per-process-limit — the WhisperioKeyboard extension likely blows the extension memory cap (SEPARATE bug, unaddressed).
Ruled out: modelOrder↔providerChain accessor cycle (providerChain reads stored modelOrder, no cycle); self-recursive-function scan of shared sources found only benign delegation overloads.
NEXT: hunt MUTUAL recursion / recursive SwiftUI layout loops reachable from SettingsView (incl. pre-65 code: custom-categories WZCategories, sync banner, hub rows) with the stack-overflow signature; consider asking user to test build 64/65 to bound the range; keyboard jetsam fix as follow-up. Build 70 (breaker) is VALID on both platforms; main = fb12e84.

## Settings stack-overflow — ROOT CAUSE FOUND + FIXED (2026-07-24, build 71)
Got the symbolicated backtrace from the user's TestFlight feedback (~/Downloads/testflight_feedback/crashlog.crash, build 70, iPhone13,2 arm64e). NOT user data, NOT iCloud, NOT recursion in our code: it's the Swift RUNTIME's type-metadata instantiation overflowing the main-thread stack — `SettingsView.swift:330` → __swift_instantiateConcreteTypeFromMangledNameV2 → swift_getTypeByMangledName → TypeDecoder::decodeMangledType → decodeGenericArgs recursing ~600 frames deep → EXC_BAD_ACCESS at the stack guard ("Could not determine thread index for stack guard region"). SettingsView.body's concrete generic type got deep enough (accordion + ScrollViewReader + intelligence section landed by build 68) that instantiating it overflows the DEVICE's 1MB main-thread stack. Never reproduced on the simulator because the sim's main thread gets an 8MB stack — that's the whole reason builds 68/69/70 crashed only on device and every sim repro (real settings, 34 recordings, journal, all categories, all provider accordions, max Dynamic Type) survived.
FIX: type-erase the body's branch (`_ConditionalContent<hub,category>` → AnyView both arms) and the 7-way categoryView switch (each arm AnyView, explicit returns), plus the three heaviest modelCategory sub-sections (modelOrderSection, the 8 connector accordions, intelligenceSection). Caps the instantiated generic depth well under the 1MB stack. Behavior-identical (AnyView renders the same); Settings is a cold path so the erasure cost is irrelevant.
Verification: iOS + Mac gate builds green; on-device confirmation via TestFlight build 71 (dev mode is off on the user's phone, so TestFlight is the test loop).

## Mac Settings gear not opening (2026-07-24, build 72)
User: on macOS the Settings gear does nothing (no crash, just doesn't open). Cause: the split-shell gear used `NSApp.sendAction(Selector("showSettingsWindow:"), to: nil, from: nil)` — that private first-responder selector no longer fires on macOS 26 (⌘, and the app-menu "Settings…" still worked, proving the Settings scene itself is fine). Fix: use SwiftUI's supported `@Environment(\.openSettings)` action (macOS 14+) in both the iPadView split-toolbar gear and SettingsView's macOS "Global hotkeys" row. Verified: old "showSettingsWindow" string fully absent from the rebuilt binary; openSettings is the same action the working ⌘, menu item triggers. Gate: Mac + iOS builds green.
