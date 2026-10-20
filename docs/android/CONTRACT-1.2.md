# Whisperio for Android — v1.2.0 contract (delta on CONTRACT.md and CONTRACT-1.1.md)

> Status: 2026-10-19, before code. Opus review done (CHANGES, all 12 applied); lanes may start. Everything in
> CONTRACT.md and CONTRACT-1.1.md stays in force unless this file changes it. Version: `versionCode 10200`; public `versionName 1.0.0`
> (queenbee/Daniel 2026-10-19: the Play debut is always 1.0.0, so v1 + 1.1 + 1.2 ship together as 1.0.0; 1.1/1.2 stay internal milestone names). Whisperio stays free: no billing, ads or accounts.

## 1. Goal and rule
Parity-first (queenbee, 2026-10-19): v1.2 ports only features that iOS (`mobile/`) or desktop (`desktop/src`) already
ship, and only the parts that work on the device without a server, sync, an LLM or payments. Nothing Android-first.
Where Android differs from the source, the difference is listed in §6.

Parity survey 2026-10-19 (Explore + Opus check). App = `mobile/WhisperioApp/Sources/WhisperioApp/`,
Kit = `mobile/WhisperioKit/Sources/WhisperioKit/`:
- Weekly recap: App `RecapView.swift:11-130` (stats), `:52-54` (word count), `:60-67` (WPM, minutes saved),
  `:139-141` (streaks), `:164-170` (category split), `:211-252` (share text + card).
- Categories: App `Categories.swift:25-75` (seeds, custom hue cycle), Kit `Models.swift:93-95` (field),
  Kit `Settings.swift:95-113` (`CustomCategory`), add/delete UI App `DigestPromptEditorView.swift:160-198`, assign
  App `DetailView.swift:722-740`, filter row App `HomeView.swift:92-96`, search matches the category label
  App `HomeView.swift:318`.
- Word count in the detail header: App `DetailView.swift:90`.
- Row gestures: App `HomeView.swift:436-440,521-535,569-600`.
- Delete this day: desktop `desktop/src/renderer/.../RecordingsPanel.tsx:258-273,660-684`.
- Absent on iOS and desktop, so NOT in 1.2: transcript editing, text replacements/snippets, per-language vocabulary.

## 2. Scope

### In v1.2
| # | Feature | Parity source | Size |
|---|---|---|---|
| F1 | Weekly recap screen (Monday to Sunday) | iOS `RecapView.swift` | M |
| F2 | Recap share (text plus a numbers-only card image) | iOS `RecapView.swift:211-252` | S |
| F3 | Categories: 6 built-in + custom (add/delete), assigned by hand, tag on rows, filter chips, search, recap split | iOS `Categories.swift`, `DigestPromptEditorView.swift`, `DetailView.swift`, `HomeView.swift` | M |
| F4 | Word count in the detail header | iOS `DetailView.swift:90` | XS |
| F5 | Row gestures: swipe to delete (with Undo), double-tap to copy | iOS `HomeView.swift:436-440,569-600` | S |
| F6 | Delete a whole day (from the day header) | desktop `RecordingsPanel.tsx:258-273` | S |

### Out of v1.2
Transcript editing, replacements/snippets, per-language vocabulary (no source). Auto-categorize, daily digest, journal,
rewrite presets, cleanup templates, command mode, tone map (LLM). GitHub/iCloud sync. Speaker naming (cloud
diarization). Prices/cost in the recap (D1). Editing a custom category (iOS has none). Replicate provider. On-device models.

## 3. Shared code (pinned before lanes start)
- `core`: `ai.whisperio.core.WordCount.kt` with `fun wordCount(text: String?): Int` — null/blank → 0; otherwise the
  number of maximal runs of characters that are not `Char.isWhitespace()` (covers U+00A0 and other Unicode spaces, as
  iOS `isWhitespace || isNewline`). Owned by the Codex job; lanes R and K call it, never re-implement it.
- `core`: `ai.whisperio.core.Category.kt`: `data class CategoryDef(val id: String, val custom: Boolean, val hueIndex: Int)`,
  `object Categories { val SEED_IDS = listOf("work","personal","ideas","messages","code","todo"); fun customHue(index: Int): Long }`
  (custom palette, iOS `customHueCycle`: `0x4A8CF7, 0xFBBF24, 0xF472B6, 0xA78BFA, 0x34D399, 0x22D3EE`, by
  `hueIndex % 6`). Owned by lane K; lane R starts with a local stub `category: String? = null` and switches to it after K merges.
- `core`: `ai.whisperio.core.Recap.kt` (pure metrics, F1). Owned by lane R.
- UI slots: lane R's "This week" card is its own composable `RecapCard` in `ui/recap/`; R adds the single call line in
  `HistoryScreens` after K merged. Conflicts in `strings.xml`/`plurals` between lanes are expected and resolved at merge.

## 4. Feature contracts

### F1 Weekly recap
- Entry: a "This week" card at the top of History (tap opens the Recap screen). Hidden when the week has no item with text.
- Week = `[Monday.atStartOfDay(zone), nextMonday.atStartOfDay(zone))` built with `ZonedDateTime`/`LocalDate`; the zone is
  a parameter (unit tests run with `-Duser.timezone=UTC`, `app/build.gradle.kts:109`), never read inside the function.
- Week items = `status == DONE` with non-blank `transcript` and `createdAt` in the week (iOS excludes items without text).
- Metrics (pure, in `Recap.kt`; inputs: list of (createdAt, durationMs, transcript, status, provider, category), `now`, `zone`):
  - words = sum of `wordCount`; notes = number of week items.
  - minutes spoken = sum `durationMs` / 60000.0 over week items.
  - speaking WPM = round(words / minutes spoken), shown as "—" when minutes spoken ≤ 0.05 (iOS `:60-62`).
  - minutes saved = max(0, round(words / 38 − minutes spoken)), rounded to nearest (iOS `:64-67`, `typingWPM = 38`).
  - words per day Mon..Sun (7 values) for a bar chart.
  - streak current / best: all-time, a day counts when it has **any** recording of any status (iOS `:139-141`); current
    counts if the run ends today or yesterday.
  - note of the week = the week item with the most words (ties: newest).
  - split by category (uncategorised as "None", F3) and minutes per provider (no prices, D1).
- Chart drawn with Compose `Canvas` (no chart dependency). Numbers in the device locale; counts via `plurals`
  (`1 dzień`, `2 dni`, `5 dni`, `12 dni`, `22 dni`; `1 notatka`, `2 notatki`, `5 notatek`, `12 notatek`, `22 notatki`).
- No stored recap; recomputed from `observeAll()`.

### F2 Recap share
- "Share" → `Intent.createChooser(ACTION_SEND)` with the text (EN/PL version of iOS `:211`: words, notes, minutes
  saved, streak) and a PNG card (1080x1350): week label, words, notes, minutes saved, WPM, current/best streak (iOS
  `:217-227`). Numbers only, never transcript text.
- The card is drawn with `android.graphics.Canvas` into a `Bitmap` (deterministic, unit-testable under Robolectric), not
  by capturing a Compose layout off-screen.
- Written to `cacheDir/share/recap.png` (overwritten each share), shared through a `FileProvider` with authority
  `${applicationId}.share`, `exported="false"`, `grantUriPermissions="true"`, paths `<cache-path name="share" path="share/"/>`;
  the intent sets `ClipData` (share-sheet preview) and `FLAG_GRANT_READ_URI_PERMISSION`.

### F3 Categories
- Seeds (iOS `Categories.swift`): `work` #4A8CF7, `personal` (theme amber), `ideas` #FBBF24, `messages` #F472B6,
  `code` #A78BFA, `todo` #34D399. Labels EN/PL: Work/Praca, Personal/Prywatne, Ideas/Pomysły, Messages/Wiadomości,
  Code/Kod, To-do/Do zrobienia. Icons from material-icons-extended.
- Custom (iOS parity): **add and delete only.** Add = a name (trimmed, 1-24 chars, not equal to an existing label;
  §6 D6); id `c_` + UUID; `hueIndex` = next slot in creation order (stored, so colours never drift); icon fixed
  (`Icons.Outlined.AutoAwesome`, the "spark"). No edit, no colour/icon picker, no count limit. Stored as a JSON list
  under one key in the **existing `settings` DataStore**, so `settings.clear()` in Erase all covers it. Managed in
  Settings > Categories.
- Delete a custom category sets every recording with that id back to `null` (one Room `UPDATE`).
- Assign by hand: detail screen "Category" menu (seeds, customs, "None"), via a dedicated DAO
  `@Query("UPDATE recording SET category = :c WHERE id = :id")` (never `row.copy` + `update`; `DictationController.kt:358`
  writes back whole rows). The menu is hidden while the item is RECORDING/TRANSCRIBING. The controller's existing
  whole-row writes must carry `category` through (re-read before write, as 1.1's `retryWith`).
- Rows show a tag (dot + label) when categorised, nothing when not (D2). History gets a category chip row (+ "None"),
  AND-combined with search and the 1.1 chips. Search also matches the category label (iOS `HomeView.swift:318`).
- **Room migration 1 → 2**: `MIGRATION_1_2` = `ALTER TABLE recording ADD COLUMN category TEXT` (nullable, no
  default), registered with `.addMigrations(MIGRATION_1_2)` in `AppGraph.kt:67`; no destructive fallback.
  `android { sourceSets["test"].assets.srcDir("$projectDir/schemas") }` so `MigrationTestHelper` runs under
  Robolectric. Lane K writes the migration and the test (from `1.json`, rows incl. a WIDGET row, data intact,
  `category` null) but **cannot write `2.json`** (KSP output with an identity hash): the batch gate generates it and it
  is committed there.

### F4 Word count
- Detail header: "<source> · <time> · <duration> · N words", via `wordCount`; plurals (`1 słowo`, `2 słowa`,
  `5 słów`, `12 słów`, `22 słowa`). Hidden for items without text.

### F5 Row gestures
- Swipe end-to-start (`SwipeToDismissBox`) removes the row and shows "Deleted · Undo" (D3). Pending-delete policy:
  - at most one pending delete; a second swipe commits the first at once;
  - the commit (Room delete + audio file) runs in the app-level scope (`appScope`, never cancelled with the screen) when
    the snackbar times out or is dismissed without Undo, or when the app goes to the background (`ProcessLifecycleOwner`
    `ON_STOP`);
  - Erase all, entering selection mode, Delete a day and export flush the pending delete first;
  - until committed the item is hidden only in History; the recap, the widget and export never see it because of the
    flush rule above, and the recap filters it out by id;
  - if the process dies before commit, the item comes back (accepted, written down; nothing is lost).
- Disabled in selection mode and for an item that is RECORDING/TRANSCRIBING.
- Double-tap a row copies its transcript (same path as detail Copy: clipboard with the sensitive flag as in 1.0, 1.1 F9
  haptic, "Copied" snackbar). Single tap opens detail; long-press still selects (1.1). No-op without text.
- TalkBack: custom actions "Delete" and "Copy" on each row.

### F6 Delete a day
- Day header overflow "Delete this day" → confirm "Delete N recordings from <day>? Audio is deleted too." → deletes the
  items of that day that match the current search/filters (the dialog says so when a filter is active; N counts only
  those). No undo (it is confirmed). Items RECORDING/TRANSCRIBING are skipped.

## 5. Non-functional
- No new permissions, no new network destinations, no new dependencies (FileProvider is in androidx.core).
- Strings in `values` and `values-pl`, plurals for counts, TalkBack labels per lane.
- Tests: unit (`wordCount` incl. U+00A0, tabs, newlines, Polish; recap week bounds across DST, Sunday 23:59:59.999 vs
  Monday 00:00 in a non-UTC zone, WPM at 0.05 min, rounding of minutes saved, streak today/yesterday/broken counting
  failed items; category add/delete + hueIndex stability + delete resets items; pending-delete policy as a pure state
  machine), Room migration test, Roborazzi (recap screen + card bitmap, category chips/tags/menu/settings, detail header,
  day-header menu; phone + tablet + font 2x, EN/PL).
- **Erase all data** (`AppGraph.eraseAllData`, `:110-118`) additionally deletes `cacheDir/share/`, and flushes/drops a
  pending delete; custom categories go with `settings.clear()`.
- Gate: batched heavy gate (generates `2.json`), lint clean; emulator smoke: recap with seeded data, share sheet,
  **upgrade** from an installed 1.1 build with data (not a reinstall), swipe + undo + background commit, delete a day.
- Privacy / Data safety: no change (categories and recap stay on the device; backup and device transfer already exclude
  every domain in `data_extraction_rules.xml`; a share the user starts is not "sharing" under Play's definition).
- Store listing bullets (EN/PL) in the last merge; screenshots re-run with the kit (History changes visibly).

## 6. Lanes (Sonnet, up to 4 + 1 Codex, code only, no gradle)
1. **Codex — F4 + `wordCount`** (small, first).
2. **Lane K — categories (F3)** incl. `Category.kt`, migration + test, DAO, settings screen, chips, tags, search.
3. **Lane R — recap (F1, F2)** incl. `Recap.kt`, `RecapCard`, Recap screen, share card, FileProvider.
4. **Lane G — history gestures (F5, F6)** incl. the pending-delete state machine.
Base: `android/1.1-lang` (v1.1 complete). Merge order: Codex → K → R → G, Opus review per lane, `--no-ff`; the version
bump to 1.2.0 and the listing go in the last merge.

## 7. Decisions and deviations from the source
- D1: no prices/cost in the recap (iOS estimates from a hard-coded table); minutes per provider are kept.
- D2: uncategorised items show no tag and filter as "None" (iOS shows Work, `Categories.swift:41,72`, `RecapView.swift:167`).
- D3: swipe deletes on a full swipe with Undo (iOS reveals a Delete button, `HomeView.swift:436-440`, and deletes at
  once); Material convention, and a stray swipe cannot lose audio.
- D4: Delete a day respects the active search/filters. Desktop hides day headers while searching, so the case does not
  arise there; on Android headers stay visible with filters, so the dialog states what is deleted.
- D5: the share card holds numbers only, the same as iOS (`RecapView.swift:217-227`).
- D6: custom names are trimmed and compared case-insensitively against all labels (iOS checks exact duplicates only), to
  avoid two "Work" chips.
- D7: the background commit of a pending delete uses the activity's `ON_STOP` (`LifecycleEventEffect`) instead of
  `ProcessLifecycleOwner`, because `lifecycle-process` would be a new dependency. It also flushes when another
  activity covers the main one.
- D8: deleting a custom category asks for confirmation (dialog). Selecting several category chips in History is an OR
  within the row, as the 1.1 source chips; the row stays AND-combined with search and the other filters. The "Copied"
  snackbar is skipped while an Undo snackbar is showing.
- Not taken (noted): iOS long-press menu Copy/Delete on rows (`HomeView.swift:518-525`) — long-press is selection on
  Android since 1.1; Copy/Delete are reachable by double-tap, swipe and TalkBack actions.
