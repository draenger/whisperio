/* Whisperio Apple — screens. iPhone (Home / Recording / Detail), iPad+Mac split, Watch.
   Ported from HomeView / RecordingView / DetailView / iPadView / WatchView.swift.
   DELTAS to check vs current SwiftUI: (a) AppleSplit has a Library/Journal segmented
   toggle + AppleJournal (per-day AI daily summary, category groups); (b) WatchApp is
   VIEW-ONLY — the 3 most recent transcripts synced from iPhone, NO on-watch dictation. */

// RecRow: 38x38 rounded-12 source-icon chip (accentLite) | 2-line title (14.5 medium) |
//   CategoryTag | meta row (app · when · dur, mono 11 faint) + trailing lock/cloud icon
//   (green on-device / amber cloud). Trailing 36x36 copy button (accentLite, ->green check).

// PhoneHome: WHeader "Whisperio" + right {book square-btn, cog square-btn}. Search pill
//   (surfaceUp, faint "Search transcripts"). Horizontal category filter chips (All + M_CATS).
//   Scroll: "Today" group + "Earlier" group, each a surface card (radius 18) of RecRows.
//   Floating 72x72 gradient mic FAB, bottom-center, 6px accent-alpha ring, over a bg->transparent
//   gradient scrim (height 130, paddingBottom 34).

// PhoneRecording: bg2. Top row: EngineChip ("Apple Speech · on-device" / "Transcribing…") +
//   mono clock. Big live text (FD 23, minHeight 140). Waveform (34 bars, h70) while listening;
//   spinner + "Working…" while processing. Bottom controls: 56 cancel (x), 84 stop (red, ring),
//   spacer — centered, gap 30.

// PhoneDetail: WHeader "Transcript" back + right more. Badges row (SourceBadge, PrivacyBadge,
//   CategoryTag). meta (app·when·dur·words). Transcript card (surface, radius 18, label + text 17).
//   Rewrite: loading card (spinner + "Rewriting…") then "Action items" card (cloud badge, pre-wrap).
//   Bottom 3 GhostBtns: Copy / Share / Rewrite.

// AppleSplit(engineBar, journal=true): optional engineBar (Engines: On-device → OpenAI →
//   ElevenLabs, device badge). journal toggle row: segmented [Library(list), Journal(book)].
//   Library = sidebar (320, logo+device badge, Search, All/Keyboard/Watch tabs, rec list w/
//   2-line title) + detail (source/privacy badges, Copy/Insert; "CLEANED UP ON-DEVICE" label,
//   FD 28 title, waveform card). Journal = AppleJournal.

// AppleJournal: left day-index (320): Journal label, day cards (Today/Yesterday) w/ note count,
//   CategoryTags, "Generate summary"/"Summary ready". Right: day header + "Daily summary" card
//   (Generate -> spinner "Summarizing your day…" -> summary text + Regenerate) + category groups
//   (SectionLabel + CategoryTag, surface card of items: 30 icon chip, title 14, meta mono).

// WatchApp (VIEW-ONLY): black bg. Header logo+"Whisperio" + green "9:41". "LATEST TRANSCRIPTS"
//   mono label. List of 3 recent (M_RECS.slice(0,3)) cards (#15131c): 2-line title (11.5) +
//   green "{when} · synced" with check. NO record button, NO dictation.
