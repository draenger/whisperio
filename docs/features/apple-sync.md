# Feature — Apple sync (CloudKit) + storage picker + native Mac app

## What it does

On Apple devices the recording history (transcripts + metadata) syncs across iPhone, iPad, Mac and
Watch through the user's **private CloudKit** database — no Whisperio server involved. The user
picks where history lives (**On this device** vs **iCloud**) in Settings, and a small cloud badge /
spinner shows the sync state. A native macOS app (`WhisperioMac`) renders the same journal from the
same CloudKit store. Cross-ecosystem sync to Windows is deliberately *not* CloudKit — that path is
[GitHub sync](github-sync.md).

## User-facing flow

1. Settings → Storage: choose **On this device** or **iCloud**
   (`mobile/WhisperioApp/Sources/WhisperioApp/SettingsView.swift:55` renders the two rows;
   `mobile/WhisperioApp/Sources/WhisperioApp/SettingsView.swift:46` persists the choice). The change
   applies on the next launch (the store is built once at startup).
2. With **iCloud** selected on a device signed into an Apple ID, recordings made on any device appear
   on the others within a minute or two (CloudKit push + SwiftData mirror is not instant).
3. A teal cloud glyph shows the library is iCloud-backed; a mini spinner appears while an
   import/export is in flight (`mobile/WhisperioApp/Sources/WhisperioApp/Shared.swift:77` is the
   glyph, driven by the store's `isCloudBacked` / `isSyncing`).
4. On Mac, the `WhisperioMac` window shows the same history list — same Apple ID, same private DB.

## How it works (code path)

1. **Store selection.** `RecordingSyncStore` is the SwiftData-backed history store
   (`mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:40`). Its convenience
   initializer reads the persisted `StorageMode`
   (`mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:87`) and, only when iCloud is
   chosen, builds a `ModelConfiguration` bound to the private CloudKit database
   (`mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:92`) using the fixed container
   id `iCloud.ai.whisperio.mobile`
   (`mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:63`).
2. **Sync-state observation.** When the config is cloud-backed the store subscribes to
   `NSPersistentCloudKitContainer.eventChangedNotification`
   (`mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:117`) and maps in-flight
   import/export events onto its `isSyncing` flag
   (`mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:124`) — that flag is what
   spins the glyph.
3. **The record.** Each row is a SwiftData `@Model RecordingEntity`
   (`mobile/WhisperioKit/Sources/WhisperioKit/RecordingEntity.swift:13`) with CloudKit-safe optional/
   default-valued properties (`id`, `timestamp`, `category`, `modifiedAt`, …
   `mobile/WhisperioKit/Sources/WhisperioKit/RecordingEntity.swift:16`).
4. **Last-writer-wins.** Category/render edits bump `modifiedAt`
   (`mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:152`); reads resolve a row by
   the newest `modifiedAt` (`mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:189`)
   and dedup by id at read time
   (`mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:181`, using
   `RecordingSync.dedupByID` at
   `mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:23`).
5. **Legacy migration.** On first run the old on-device `recordings.json` is imported once, idempotent
   on id and gated by the `migratedV2` UserDefaults flag
   (`mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:227`, flag key at
   `mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:12`, set at
   `mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:250`). The original JSON is left
   in place as a durable local backup.
6. **App-side facade.** The app talks to a `RecordingsStore` wrapper that drops to a plain JSON file
   when the CloudKit container can't be built (no account, pre-iOS-17)
   (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/RecordingsStore.swift:12`, iCloud-backed flag at
   `mobile/WhisperioApp/Sources/WhisperioApp/Engine/RecordingsStore.swift:19`) — history is never lost
   when iCloud is unavailable.
7. **Native Mac app.** `WhisperioMac` is a SwiftUI `@main`
   (`mobile/WhisperioApp/MacApp/WhisperioMacApp.swift:13`) whose `WindowGroup`
   (`mobile/WhisperioApp/MacApp/WhisperioMacApp.swift:22`) renders the shared iPad journal over the
   same store. It is a **universal** target sharing bundle id `ai.whisperio.mobile`, so it inherits
   the provisioned App ID + CloudKit container. A `#if DEBUG` one-shot seed
   (`mobile/WhisperioApp/MacApp/WhisperioMacApp.swift:40`) writes a single record to JIT-create the
   CloudKit *Development* schema; it never ships.

## Entry points (file:line)

- `mobile/WhisperioKit/Sources/WhisperioKit/RecordingSyncStore.swift:40` — the CloudKit/SwiftData store.
- `mobile/WhisperioKit/Sources/WhisperioKit/RecordingEntity.swift:13` — the synced record model.
- `mobile/WhisperioKit/Sources/WhisperioKit/Settings.swift:7` — `StorageMode` enum (onDevice / iCloud);
  default is `.iCloud` (`mobile/WhisperioKit/Sources/WhisperioKit/Settings.swift:92`).
- `mobile/WhisperioApp/Sources/WhisperioApp/SettingsView.swift:46` — storage picker action.
- `mobile/WhisperioApp/Sources/WhisperioApp/Shared.swift:77` — the sync-status glyph.
- `mobile/WhisperioApp/MacApp/WhisperioMacApp.swift:13` — the native Mac app entry point.

## Data touched

- SwiftData store in the app container; when iCloud is chosen it mirrors to the user's **private**
  CloudKit DB `iCloud.ai.whisperio.mobile` (per-Apple-ID; no shared/public zones).
- Legacy `Documents/recordings.json` (read-once on migration, then kept as backup).
- `StorageMode` persisted in settings (`mobile/WhisperioKit/Sources/WhisperioKit/Settings.swift:67`).
- App Group `group.ai.whisperio.mobile`
  (`mobile/WhisperioKit/Sources/WhisperioKit/SharedStore.swift:14`) shared with the keyboard/widget.

## Edge cases

- **No iCloud account / unprovisioned dev build** — `RecordingSyncStore` init throws; the app-side
  `RecordingsStore` falls back to on-device JSON so history still works
  (`mobile/WhisperioApp/Sources/WhisperioApp/Engine/RecordingsStore.swift:39`).
- **Concurrent category edits on two devices** — last `modifiedAt` wins (§4); no duplicate rows.
- **CloudKit schema not deployed to Production** — a TestFlight/App-Store build silently fails to sync;
  the schema must be deployed in the CloudKit Console first (see the release steps in
  [runbook.md](../runbook.md)).
- **CloudKit entitlement stripping** — a headless/`xcodebuild` export strips the iCloud container
  entitlement, causing a launch fault when an account is present; CloudKit builds must go through
  Xcode Archive → Distribute (see [runbook.md](../runbook.md)).

## Related tests

- `mobile/WhisperioKit/Tests/WhisperioKitTests/RecordingEntityTests.swift:1` — entity mapping and
  `RecordingSync.dedupByID` last-writer-wins behavior.
- `mobile/WhisperioKit/Tests/WhisperioKitTests/SettingsTests.swift:1` — settings decode incl.
  `StorageMode`.
