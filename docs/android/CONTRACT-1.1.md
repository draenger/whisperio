# Whisperio for Android — v1.1.0 contract (delta on CONTRACT.md)

> Status: 2026-10-19, before code. Opus review done (CHANGES, all applied); lanes may start. Everything in CONTRACT.md stays in
> force unless this file changes it. Version: `versionName 1.1.0`, `versionCode 10100` (`android/app/version.properties`).

## 1. Goal
Close the gaps against iOS (the feature source of truth) that make sense on a phone, without a server, sync or LLM,
and add two Android-first features queenbee asked for (text export, language per app). v1.1 ships after 1.0.0 is on the
internal track; it does not change the public launch order (Play production only after iOS).

Parity survey 2026-10-19 (iOS `mobile/WhisperioApp`, desktop `desktop/src`, Android `android/`): iOS has history
search, day grouping, audio playback, retry with a chosen engine, a home-screen widget and haptics; Android has none of
them. Neither iOS nor desktop has bulk export or per-app language.

## 2. Scope

### In v1.1
| # | Feature | Parity source | Size |
|---|---|---|---|
| F1 | History search (transcript text, provider name) | iOS `HomeView.swift:27,62,307-320` | S |
| F2 | History grouped by day (Today, Yesterday, then dates in the device locale) | iOS `HomeView.swift:114-115` | S |
| F3 | History filter chips: source (app / keyboard / tile / shortcut / widget) and status Failed | Android-first; fields already stored (§7.3) | S |
| F4 | Play back kept audio in detail | iOS `DetailView.swift:93-96,863-878` | S |
| F5 | Retry with a chosen provider (from detail) | iOS `DetailView.swift` `chooseEngine` | S |
| F6 | Export text: one, a selection, or all filtered results, as `.txt` or `.md`, through the system file picker | Android-first (queenbee) | M |
| F7 | Language per app (opt-in), plus a language chip in the keyboard | Android-first (queenbee) | M |
| F8 | Home-screen widget "Dictate" (1x1 and 2x1) | iOS `Widget/WhisperioWidget.swift:69-76` | S-M |
| F9 | Haptics on copy, insert and finished transcription (respects the system setting) | iOS `DetailView.swift:704,735` | S |

### Out of v1.1 (moved to 1.2+)
Weekly recap/stats (iOS `RecapView.swift`), categories (iOS `Categories.swift`), editing a transcript, text
replacements/snippets, per-language vocabulary, export of audio files, on-device transcription (still open, CONTRACT §11),
everything already out of v1 (sync, LLM post-processing, Wear OS, full QWERTY).

## 3. Feature contracts

### F1-F3 History list
- Search filters in Kotlin over `observeAll()` (local history is small; no FTS table, no SQL `LIKE`, no schema
  change): `text.lowercase(Locale.ROOT).contains(q.lowercase(Locale.ROOT))` on transcript and provider. Full Unicode
  case folding (Ł/ł, Ż/ż); diacritics still matter (`ł` ≠ `l`), tested. No SQL, so no escaping. Debounce 250 ms. Empty
  query = full list. (SQLite `LIKE`/`lower()` fold ASCII only, which is why this is not a Room query.)
- Day headers are computed in the UI from `createdAt` in the device time zone; no stored field.
- Filter chips combine with search (AND). State survives rotation (`rememberSaveable`), not process death.
- Room stays at `version = 1`: **v1.1 adds no Room migration.** Any feature that needs one moves to 1.2.

### F4 Playback
- `MediaPlayer` on the stored `audioPath` (MPEG-4/AAC, `AudioRecorder.kt:39-43`); play/pause, position, duration.
  Released in `onStop`/leaving the screen. Audio focus `AUDIOFOCUS_GAIN_TRANSIENT`; pauses on focus loss and on
  `ACTION_AUDIO_BECOMING_NOISY`. `AudioFocusRequest` (API 26+) with `USAGE_MEDIA` / `CONTENT_TYPE_SPEECH`.
- Playback is disabled while `DictationController` is recording, and starting a recording stops playback.
- Hidden when the audio file is gone (keep-audio off, retention, "delete all audio"); no error toast.
- No new permission. Playback never starts on its own.

### F5 Retry with provider
- Detail menu "Retry with…" lists configured providers that have a valid key (and self-hosted if set). Runs one
  attempt with that provider only (no fallback chain), same consent and size checks as a normal run (CONTRACT §4.2, §4.4).
  Needs the kept audio; disabled with a reason when it is gone.
- On success the result replaces the transcript and updates `provider`/`model` (the previous text is not kept). On
  failure the item keeps its previous text and status, and the error shows as a snackbar.

### F6 Export
- Entry points: detail ("Export"), and a selection mode in the history list (long-press to select, "Select all" =
  everything matching the current search + filters), then "Export".
- Destination: `ACTION_CREATE_DOCUMENT` (Storage Access Framework). Whisperio writes only to the URI the user picked;
  no storage permission, no `MediaStore`, no background write. Default file name `whisperio-YYYY-MM-DD.{txt|md}`.
- Formats (UTF-8, LF):
  - `.txt`: per item `YYYY-MM-DD HH:mm` line, blank line, transcript, then a `---` separator line; items are separated by a blank line after the `---` line.
  - `.md`: `# Whisperio export` + `## YYYY-MM-DD HH:mm · <source> · <provider>` per item, transcript as a paragraph.
  - Failed items without text are skipped and counted in the result snackbar ("Exported 12, skipped 2 without text").
- Pure formatter in `core` (unit-tested: ordering newest first, escaping of Markdown-significant leading characters
  `#`, `>`, `-`, `+`, `*`, any `\d+[.)]`, and a line that is only `---` or `===` (would become a heading or
  rule), by a backslash; empty selection).
- The existing share sheet (`ACTION_SEND`) stays for one item.

### F7 Language per app
- Off by default. Settings > Language > "Remember language per app" (switch). Only when on:
  the keyboard stores `EditorInfo.packageName -> language` the moment the user changes the language with the keyboard's
  language chip, and uses that language the next time it opens in the same app. Apps without a stored entry use the
  global language.
- Keyboard language chip: shows the current code (`PL`, `EN`, `Auto`…); tap opens the same list as Settings §7.4.
  Without the per-app switch, the chip changes the global language (same as Settings).
- Storage: a local DataStore map, max 200 entries (LRU by last use). Never sent anywhere, not in history, not in logs,
  not exported. Turning the switch off deletes the map. "Erase all data" deletes it. Settings shows "Apps with a saved
  language: N" with "Clear".
- Fields where `ImeCommitPolicy.isPasswordField` is true (including number passwords) or `isNoPersonalizedLearning`
  is set, or where `packageName` is null, never store an entry (same rule as Gboard's personalised learning).
- Privacy: package names stay on the device, so Play Data safety does not change (it covers data sent off the device;
  see `play-data-safety.md` §0; Play's "Installed apps" type covers collection only, and package names come from
  `EditorInfo`, no `QUERY_ALL_PACKAGES`). `play-data-safety.md` §3 gets the line "Installed apps: not collected (F7
  package names stay on device; from `EditorInfo`, no `QUERY_ALL_PACKAGES`)". The privacy policy gets one sentence in
  §8.3 Keyboard of `docs/privacy.html` (per-app language list, package names only, on device, off by default, deleted
  on switch-off or Erase all). Legal review (Opus) of that sentence.

### F8 Widget
- `AppWidgetProvider` with RemoteViews (no Glance dependency): one "Dictate" button that starts the same
  `DictateActivity` as the QS tile and shortcut (CONTRACT §6), `PendingIntent.FLAG_IMMUTABLE`. Sizes 1x1 and 2x1
  (2x1 adds the label). Recording `source = WIDGET` is new: add `WIDGET` to `RecordingSource`; stored as text in the
  existing `source` column (Room enum name in TEXT, no TypeConverter, exported schema unchanged), so no migration.
  An older build reading `WIDGET` would throw, so app versions are never downgraded onto the same database
  (internal-track rollback = uninstall). `DictateActivity.sourceFor` maps `"widget"` to `WIDGET` (unit test; today any
  non-"shortcut" extra becomes `TILE`). The `PendingIntent` is explicit, so `exported="false"` stays.
- No periodic updates (`updatePeriodMillis = 0`), no data shown on the widget (no transcript on the home screen).

### F9 Haptics
- `View.performHapticFeedback(HapticFeedbackConstants.CONFIRM)` (API 30+, `VIRTUAL_KEY` below) on copy, keyboard insert
  and finished transcription. No `VIBRATE` permission. Follows the system "touch feedback" setting. In Compose use
  `LocalHapticFeedback` (`Confirm` / `VirtualKey`); the finished-transcription haptic fires only while a view is attached.

## 4. Non-functional
- No new runtime permissions, no new network destinations, no new dependencies except `androidx.media` only if
  `MediaPlayer` proves insufficient (decide in review, default: none).
- All new strings in `values` and `values-pl`, and TalkBack labels (keyboard chip, player, selection mode, widget
  `contentDescription`), per lane, not at the end.
- Tests: unit tests for search escaping, day grouping, export formatter, per-app language map (LRU, password rule,
  wipe on switch-off and on Erase all), retry-with-provider (single attempt, no fallback). Roborazzi for history (search,
  headers, chips, selection), detail (player, retry menu), keyboard chip, widget layout; phone + tablet + font 2x, EN/PL.
- Gate: gradle through the heavy queue (`-Dorg.gradle.workers.max=2 -Xmx3g`), lint clean, emulator smoke of F6 (real
  SAF picker), F7 (two apps, two languages) and F8 (widget on the launcher).
- Store listing: update the feature bullets (EN/PL) after F6-F8 land; screenshots only if the history screen changes
  visibly (it will: re-run the kit, verify gate).

## 5. Lanes (Sonnet, max 2 at a time)
1. **Lane A — history:** F1, F2, F3, F6 (formatter in `core` first, then UI).
2. **Lane B — playback/retry/system:** F4, F5, F9, F8.
3. **Lane C — language (after A or B merges):** F7 + privacy sentence.
Each lane: branch from `android/skeleton`, PR-equivalent review (Opus, 1 round), merge `--no-ff`. Version bump and
release notes in the last merge.

## 6. Decisions (Opus review 2026-10-19: CHANGES, all applied)
- D1: per-app language is off by default (privacy by default, RODO art. 25); an opt-in switch.
- D2: `source = WIDGET` is a new value (honest history), with the F3 chip and the `sourceFor` mapping above.
- D3: no `.json` export in 1.1 (no consumer yet; 1.2 if asked).
