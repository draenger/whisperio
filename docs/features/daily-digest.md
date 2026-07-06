# Feature — Daily digest / Journal (mobile)

## What it does

The mobile app turns a day's dictated notes into a **journal**: one card per day, grouped by
category, with an AI-generated day summary on demand. It is a read-over-history view built on the
same recordings store — dictation feeds it, nothing new is captured.

## User-facing flow

1. Open **Journal** (iPad has a Library / Journal segmented toggle; iPhone routes to it from Home).
   Each day that has completed recordings shows a card: day title, the categories present, and a
   "generate summary" affordance
   (`mobile/WhisperioApp/Sources/WhisperioApp/JournalView.swift:47`).
2. Tap a card → **DigestDayView** for that day: the day's notes grouped by category, and a button to
   generate (or re-read a cached) AI summary
   (`mobile/WhisperioApp/Sources/WhisperioApp/DigestDayView.swift:8`).
3. Generating a summary requires cloud consent + an API key (same gate as Detail's Rewrite); a privacy
   badge marks it as a cloud call (`mobile/WhisperioApp/Sources/WhisperioApp/DigestDayView.swift:133`).

## How it works (code path)

1. **Grouping (pure).** `DigestGrouping` buckets recordings by day
   (`mobile/WhisperioKit/Sources/WhisperioKit/DigestGrouping.swift:20`), groups a day's notes by
   category in a fixed order (`mobile/WhisperioKit/Sources/WhisperioKit/DigestGrouping.swift:31`),
   and isolates uncategorized notes (`mobile/WhisperioKit/Sources/WhisperioKit/DigestGrouping.swift:54`).
   Day keys come from `dayKey(for:calendar:)`
   (`mobile/WhisperioKit/Sources/WhisperioKit/DigestGrouping.swift:13`).
2. **The digest model.** A `DailyDigest`
   (`mobile/WhisperioKit/Sources/WhisperioKit/DailyDigest.swift:34`) holds the day, its `DigestGroup`s
   (`mobile/WhisperioKit/Sources/WhisperioKit/DailyDigest.swift:11`) and the generated summary text.
3. **Prompts (pure).** `DigestPrompt` builds the LLM prompts — a classification prompt to assign
   categories (`mobile/WhisperioKit/Sources/WhisperioKit/DigestPrompt.swift:13`) and a summary prompt
   over the grouped notes (`mobile/WhisperioKit/Sources/WhisperioKit/DigestPrompt.swift:41`).
4. **Generation + cache.** `DigestStore` runs generation
   (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/DigestStore.swift:38`) against a `ChatLLM`
   (`mobile/WhisperioKit/Sources/WhisperioKit/ChatLLM.swift:5`,
   OpenAI client at `mobile/WhisperioApp/Sources/WhisperioApp/Engine/OpenAIChatClient.swift:7`),
   caches the result per day key
   (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/DigestStore.swift:25`), and can backfill missing
   days (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/DigestStore.swift:103`).
5. **Wiring.** The app router exposes `.journal` and `.digestDay` screens
   (`mobile/WhisperioApp/Sources/WhisperioApp/AppShell.swift:141`,
   `mobile/WhisperioApp/Sources/WhisperioApp/AppShell.swift:144`).

## Entry points (file:line)

- `mobile/WhisperioApp/Sources/WhisperioApp/JournalView.swift:8` — the day-index view.
- `mobile/WhisperioApp/Sources/WhisperioApp/DigestDayView.swift:8` — one day's grouped notes + summary.
- `mobile/WhisperioApp/Sources/WhisperioApp/Engine/DigestStore.swift:10` — generate/cache orchestration.
- `mobile/WhisperioKit/Sources/WhisperioKit/DigestGrouping.swift:10` — pure day/category grouping.
- `mobile/WhisperioKit/Sources/WhisperioKit/DigestPrompt.swift:13` — classification/summary prompts.

## Data touched

- Reads completed recordings from the recordings store (no new capture).
- Writes generated summaries into the in-memory `DigestStore` cache keyed by day
  (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/DigestStore.swift:25`).
- Sends the day's note text to the configured cloud LLM only on explicit "generate".

## Edge cases

- **No cloud consent / no key** — generation is gated and routes the user to configure it
  (`mobile/WhisperioApp/Sources/WhisperioApp/DigestDayView.swift:133`).
- **Empty day** — days with no completed recordings produce no journal card
  (`mobile/WhisperioApp/Sources/WhisperioApp/JournalView.swift:39` filters to completed notes).
- **Cached summary** — a day already summarized re-reads from cache instead of re-calling the LLM
  (`mobile/WhisperioApp/Sources/WhisperioApp/DigestDayView.swift:35`).

## Related tests

- `mobile/WhisperioKit/Tests/WhisperioKitTests/DigestTests.swift:1` — grouping, day keys, prompt shape.
