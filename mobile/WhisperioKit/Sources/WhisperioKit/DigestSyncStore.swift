import Foundation
import SwiftData
import CoreData
import CloudKit
import os

/// Pure, container-free helpers backing `DigestSyncStore`. Kept off the `@available`
/// SwiftData surface so the migration/dedup logic stays unit-testable headlessly (no
/// ModelContainer, no CloudKit account required). Mirrors `RecordingSync`.
public enum DigestSync {
    /// UserDefaults flag marking the one-time journal.json → SwiftData migration as done.
    /// Distinct from `RecordingSync.migratedFlagKey` — the two migrations are independent.
    public static let migratedFlagKey = "digestMigratedV1"

    /// Decode a legacy `journal.json` blob into value types. Tolerant of a missing or
    /// unreadable file (returns `[]`) so a fresh install migrates to nothing gracefully.
    public static func decodeLegacy(_ data: Data) -> [DailyDigest] {
        (try? JSONDecoder().decode([DailyDigest].self, from: data)) ?? []
    }

    /// Collapse duplicate day keys, keeping the row with the newest `modifiedAt` — true
    /// last-writer-wins, independent of the order `rows` arrives in. Dedup keys on the real
    /// write clock (max-by-`modifiedAt` per `dayKey`, via a dictionary) rather than on any
    /// particular fetch/sort order.
    ///
    /// This deliberately does NOT dedup by sorting on `DailyDigest.date` and keeping the first
    /// duplicate: `date` is the journaled *day*, not a write clock, and CloudKit can produce two
    /// rows for the same `dayKey` with different `date` values — e.g. a digest backfilled from
    /// one device at 11pm and regenerated on another device at 7am the next day both stamp
    /// `dayKey` the same but `date` differently. Whichever happened to sort first by `date` would
    /// then silently win even if it held the older write. Only `modifiedAt` (see
    /// `DigestEntity.modifiedAt`) is a real write clock, so dedup must key on it directly.
    /// Callers are responsible for sorting the survivors for display afterward — see
    /// `DigestSyncStore.reload()`.
    public static func dedupByDayKeyLastWriterWins(
        _ rows: [(digest: DailyDigest, modifiedAt: Date)]
    ) -> [DailyDigest] {
        var winners: [String: (digest: DailyDigest, modifiedAt: Date)] = [:]
        for row in rows {
            if let current = winners[row.digest.id], current.modifiedAt >= row.modifiedAt {
                continue
            }
            winners[row.digest.id] = row
        }
        return winners.values.map(\.digest)
    }

    /// `DailyDigest` has no `updatedAt`/`lastWriteAt` field of its own (unlike `Recording`), so
    /// migration approximates a write clock from the best real-world timestamp already on the
    /// value: when the summary was actually generated, falling back to the journaled day itself
    /// for a digest that was only ever grouped (never summarized). Used solely by the one-time
    /// JSON migration below — live local writes use "now" instead (see `DigestSyncStore.upsert`).
    public static func lastWriteAt(for digest: DailyDigest) -> Date {
        digest.summaryGeneratedAt ?? digest.date
    }

    /// On-disk cache file for `DigestSyncStore`. Given an explicit name (rather than the default
    /// unnamed `ModelConfiguration`, which SwiftData resolves to a shared `default.store`), so it
    /// can never collide with `RecordingSync.storeURL()`'s file — the two stores register
    /// disjoint single-entity schemas (`DigestEntity`-only vs `RecordingEntity`-only) and
    /// SwiftData throws on init if two configs with different schemas point at the same file.
    /// Shares `RecordingSync.applicationSupportDirectory()` so both stores agree on the parent
    /// directory. Used by both the convenience init and `DigestStore.migrateCurrentLibraryToCloud()`,
    /// which must open the identical file.
    public static func storeURL() throws -> URL {
        try RecordingSync.applicationSupportDirectory().appendingPathComponent("Digests.store")
    }

    /// Resolve the identifier Core Data stamps into a SQLite store's metadata the first time it's
    /// created (`NSStoreUUIDKey`) — the same identifier `NSPersistentCloudKitContainer.Event
    /// .storeIdentifier` reports on every sync event for that store. Read back from the on-disk
    /// file rather than a live store object because SwiftData's `ModelContainer` doesn't expose
    /// the underlying `NSPersistentStoreCoordinator`/`NSPersistentStore` to ask directly — this is
    /// the only piece of a `ModelConfiguration` that's both retrievable through public API and
    /// stable for the store's lifetime, which is what lets `eventBelongsToStore` below tell "an
    /// event about MY on-disk store" apart from "an event about the sibling `RecordingSyncStore`'s
    /// store" despite both stores sharing one process-wide notification (see
    /// `DigestSyncStore.observeCloudKitEvents()`). Returns `nil` for an in-memory configuration
    /// (nothing on disk to read — used by tests, which never call `observeCloudKitEvents()`
    /// anyway) or if the metadata read fails for any other reason; callers must treat `nil` as
    /// "can't determine ownership", not "belongs to nobody" — see `eventBelongsToStore`.
    @available(iOS 17, macOS 14, *)
    public static func ownStoreIdentifier(for configuration: ModelConfiguration) -> String? {
        guard !configuration.isStoredInMemoryOnly else { return nil }
        let metadata = try? NSPersistentStoreCoordinator.metadataForPersistentStore(
            type: .sqlite,
            at: configuration.url
        )
        return metadata?[NSStoreUUIDKey] as? String
    }

    /// True when a CloudKit sync event's `storeIdentifier` names this store's own persistent
    /// store rather than a sibling store's. `NSPersistentCloudKitContainer
    /// .eventChangedNotification` is posted process-wide with `object == nil` regardless of which
    /// container triggered it, so a `DigestSyncStore` and a `RecordingSyncStore` alive in the same
    /// process both see every event — this is the filter that tells them apart. Pulled out as a
    /// pure `Bool`-in/`Bool`-out function (mirrors `syncEffect` below) so the filtering decision
    /// is unit-testable without a running `NSPersistentCloudKitContainer`.
    public static func eventBelongsToStore(storeIdentifier: String, ownStoreIdentifier: String?) -> Bool {
        guard let ownStoreIdentifier else {
            // Ownership undeterminable (see `ownStoreIdentifier(for:)`) — fail OPEN rather than
            // silently dropping every event, which would be worse than the imprecise-but-working
            // status quo this replaces.
            return true
        }
        return storeIdentifier == ownStoreIdentifier
    }
}

/// SwiftData + CloudKit-backed facade over the daily digest / journal history. Exposes the same
/// surface `DigestStore` already drives (`digests`, upsert-through-save) but persists into the
/// private CloudKit database so the journal follows the user across devices. Reads dedup on
/// `dayKey` because CloudKit can't enforce uniqueness. Mirrors `RecordingSyncStore` 1:1.
@available(iOS 17, macOS 14, *)
@MainActor
public final class DigestSyncStore: ObservableObject {
    /// Current digests, newest day first, deduped on day key. Recomputed after every mutation.
    @Published public private(set) var digests: [DailyDigest] = []

    /// True while a CloudKit import/export is in flight (event `endDate == nil`). Drives the
    /// UI sync spinner. Always false for a non-cloud (on-device / in-memory) store.
    @Published public private(set) var isSyncing = false

    /// Whether this store persists into CloudKit (private DB). False for on-device / in-memory
    /// stores. Set once at init; used by the UI to decide whether to show the iCloud badge.
    @Published public private(set) var isCloudBacked: Bool

    /// Last local CloudKit/SwiftData error surfaced by this store. Useful for in-app diagnostics
    /// when sync silently falls back or a save/fetch starts failing.
    @Published public private(set) var lastErrorMessage: String?

    /// Last successful import/export timestamps. Useful for cross-device comparison.
    @Published public private(set) var lastImportAt: Date?
    @Published public private(set) var lastExportAt: Date?

    private let container: ModelContainer
    private var context: ModelContext { container.mainContext }

    /// Retained token for the `NSPersistentCloudKitContainer` event observer. Kept for the
    /// store's lifetime (the store lives as long as the app), so we never remove it.
    private var cloudEventObserver: NSObjectProtocol?

    /// This store's own persistent store identifier, resolved once at init — see
    /// `DigestSync.ownStoreIdentifier(for:)`. Used by `observeCloudKitEvents()` to filter out the
    /// sibling `RecordingSyncStore`'s sync events, which land on the same process-wide
    /// notification. `nil` when it couldn't be determined (e.g. an in-memory test store).
    private let ownStoreIdentifier: String?

    private static let log = Logger(subsystem: "ai.whisperio", category: "DigestSyncStore")

    /// The user's persisted storage choice, decoded from the settings blob in UserDefaults.
    /// Defaults to `.iCloud` (the shipped behavior) when the blob is absent or undecodable.
    /// Mirrors `RecordingSyncStore.persistedStorageMode()` — reads the same settings key (via
    /// `RecordingSyncStore.settingsDefaultsKey`) so both stores agree on the user's choice.
    private static func persistedStorageMode() -> StorageMode {
        guard let data = UserDefaults.standard.data(forKey: RecordingSyncStore.settingsDefaultsKey),
              let s = try? JSONDecoder().decode(WhisperioSettings.self, from: data) else {
            return .iCloud
        }
        return s.storageMode
    }

    /// The user's persisted sync mode, decoded from the same settings blob. Mirrors
    /// `RecordingSyncStore.persistedSyncMode()` — defaults to `.automatic`, and is read fresh on
    /// every CloudKit event (not cached at init) so a mode change takes effect without a relaunch.
    nonisolated static func persistedSyncMode() -> SyncMode {
        guard let data = UserDefaults.standard.data(forKey: RecordingSyncStore.settingsDefaultsKey),
              let s = try? JSONDecoder().decode(WhisperioSettings.self, from: data) else {
            return .automatic
        }
        return s.syncMode
    }

    /// Build the store, honoring the user's storage choice (Settings → Storage). Uses CloudKit
    /// only when the user picked `.iCloud` AND an iCloud account is present; otherwise a plain
    /// on-disk SwiftData store, which never touches CloudKit and so can't fault. The ubiquity
    /// guard means a signed-out device always falls back to local and never crashes. Reuses
    /// `RecordingSyncStore.cloudKitContainerID` — same private CloudKit container as recordings,
    /// just a different record type (`CD_DigestEntity`).
    ///
    /// NOTE: the SwiftData `ModelContainer` config is fixed at init, so **changing the storage
    /// mode only takes effect on the next launch** — the UI tells the user as much.
    public convenience init() throws {
        let mode = DigestSyncStore.persistedStorageMode()
        let useCloudKit = (mode == .iCloud)
            && FileManager.default.ubiquityIdentityToken != nil
        // Explicit, distinct on-disk file (not the unnamed-config default `default.store`) so
        // this store never collides with `RecordingSyncStore`'s own cache file — see
        // `DigestSync.storeURL()`.
        let url = try DigestSync.storeURL()
        let config = useCloudKit
            ? ModelConfiguration(url: url, cloudKitDatabase: .private(RecordingSyncStore.cloudKitContainerID))
            : ModelConfiguration(url: url)
        try self.init(configuration: config, isCloudBacked: useCloudKit)
    }

    /// Designated init — takes an explicit `ModelConfiguration` so tests can inject an
    /// in-memory, CloudKit-free store. `isCloudBacked` marks whether the config syncs against
    /// CloudKit; when true the store observes sync events to drive `isSyncing`.
    public init(configuration: ModelConfiguration, isCloudBacked: Bool = false) throws {
        self.isCloudBacked = isCloudBacked
        container = try ModelContainer(for: DigestEntity.self, configurations: configuration)
        // Resolved from the same `configuration` right after the container opens the file, so the
        // on-disk metadata this reads is guaranteed to already exist — see
        // `DigestSync.ownStoreIdentifier(for:)`.
        ownStoreIdentifier = DigestSync.ownStoreIdentifier(for: configuration)
        migrateLegacyJSONIfNeeded()
        reload()
        if isCloudBacked {
            observeCloudKitEvents()
        }
    }

    /// Observe `NSPersistentCloudKitContainer` sync events so the UI can show a spinner while an
    /// import/export is in flight. SwiftData drives an `NSPersistentCloudKitContainer` under the
    /// hood and posts this notification app-wide; we filter to import/export events and mirror
    /// their in-flight state (`endDate == nil`) onto `isSyncing`. The observer delivers on the
    /// main queue, so we hop to the MainActor to mutate the published property.
    ///
    /// This notification isn't scoped per-container — its `object` is always `nil`, and
    /// `RecordingSyncStore`'s sibling store posts on the very same name in the same process — so
    /// without a second filter this store's `isSyncing`/`lastImportAt`/`lastExportAt` would flap
    /// on the *other* store's sync activity, not just its own. `event.storeIdentifier` is the one
    /// field the notification carries that's specific to which physical store triggered it;
    /// `DigestSync.eventBelongsToStore` gates every mutation below on it matching `ownStoreIdentifier`.
    private func observeCloudKitEvents() {
        cloudEventObserver = NotificationCenter.default.addObserver(
            forName: NSPersistentCloudKitContainer.eventChangedNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let event = note.userInfo?[NSPersistentCloudKitContainer.eventNotificationUserInfoKey]
                    as? NSPersistentCloudKitContainer.Event else { return }
            // `.setup` is the one-time zone/subscription bootstrap the push-driven import path
            // depends on; admitted here (not just `.import`/`.export`) so a setup failure is
            // surfaced instead of silently dropped — see `syncEffect(type:succeeded:endDate:error:)`.
            guard event.type == .setup || event.type == .import || event.type == .export else { return }
            let type = event.type
            let endDate = event.endDate
            let succeeded = event.succeeded
            let error = event.error
            let storeIdentifier = event.storeIdentifier
            let syncing = (endDate == nil)
            MainActor.assumeIsolated {
                // Drop events from the sibling `RecordingSyncStore`'s Recordings container
                // BEFORE touching any published state — `isSyncing` included, which previously
                // flapped on the other store's activity (see doc comment above).
                guard DigestSync.eventBelongsToStore(
                    storeIdentifier: storeIdentifier,
                    ownStoreIdentifier: self?.ownStoreIdentifier
                ) else { return }
                self?.isSyncing = syncing
                switch Self.syncEffect(type: type, succeeded: succeeded, endDate: endDate, error: error) {
                case .importSucceeded(let endDate):
                    // See the matching comment in `RecordingSyncStore.observeCloudKitEvents()`:
                    // `lastImportAt` always stamps (diagnostic truth); only the live `reload()` —
                    // which republishes `digests` — is gated on the sync mode's live-publish rule.
                    self?.lastImportAt = endDate
                    if SyncGating.shouldPublishLiveUpdates(DigestSyncStore.persistedSyncMode()) {
                        self?.reload()
                    }
                case .exportSucceeded(let endDate):
                    self?.lastExportAt = endDate
                case .recordError(let message):
                    self?.recordError(message)
                case .none:
                    break
                }
            }
        }
    }

    /// The effect for a CloudKit sync event, pulled out of the notification closure as a pure,
    /// `nonisolated` function so the `.setup` / `.import` / `.export` × succeeded/failed decision
    /// matrix is unit-testable without a running `NSPersistentCloudKitContainer` — see
    /// `CloudKitEventHandlingTests`. Mirrors `RecordingSyncStore.SyncEffect`/`syncEffect`, minus the
    /// event log (`DigestSyncStore` has no `appendEvent`/`recentEvents` of its own, so a `.setup`
    /// success — nothing to reload — is a true no-op here, not just "log only").
    enum SyncEffect: Equatable {
        /// Nothing further to do: the event is still in flight (`endDate == nil`), or it's a
        /// terminal event with nothing to mutate — e.g. `.setup` succeeding.
        case none
        /// A terminal failure with a concrete error — surface it via `recordError`.
        case recordError(message: String)
        /// A terminal `.import` success — reload rows and stamp `lastImportAt`.
        case importSucceeded(endDate: Date)
        /// A terminal `.export` success — stamp `lastExportAt`.
        case exportSucceeded(endDate: Date)
    }

    nonisolated static func syncEffect(
        type: NSPersistentCloudKitContainer.EventType,
        succeeded: Bool,
        endDate: Date?,
        error: Error?
    ) -> SyncEffect {
        guard let endDate else { return .none }
        if succeeded {
            if type == .import {
                return .importSucceeded(endDate: endDate)
            } else if type == .export {
                return .exportSucceeded(endDate: endDate)
            } else {
                // `.setup` (or any other future terminal-success type) — nothing to log or reload.
                return .none
            }
        }
        // Terminal failure. Mirrors the previous behavior: only surface `recordError` when
        // CloudKit actually attached an error.
        guard let error else { return .none }
        let kind: String
        if type == .setup {
            kind = "setup"
        } else if type == .import {
            kind = "import"
        } else if type == .export {
            kind = "export"
        } else {
            kind = "sync"
        }
        return .recordError(message: "CloudKit \(kind) failed: \(error.localizedDescription)")
    }

    // MARK: - Surface

    /// Insert-or-update a digest. Idempotent on day key: if a row for the same day already
    /// exists it is updated in place (last-writer-wins) rather than duplicated. `modifiedAt`
    /// defaults to "now" — a local edit is, by definition, the newest write for that day.
    public func upsert(_ digest: DailyDigest, modifiedAt: Date = Date()) {
        upsertEntity(digest, modifiedAt: modifiedAt)
        save()
        reload()
    }

    /// Remove every row for the digest's day (CloudKit duplicates included). Mirrors
    /// `RecordingSyncStore.delete` — the deletion propagates to other devices via CloudKit.
    public func delete(_ digest: DailyDigest) {
        let dayKey = digest.id
        let descriptor = FetchDescriptor<DigestEntity>(
            predicate: #Predicate { $0.dayKey == dayKey }
        )
        if let matches = try? context.fetch(descriptor) {
            for entity in matches { context.delete(entity) }
        }
        save()
        reload()
    }

    /// Re-read the local SwiftData snapshot into `digests`. Mirrors
    /// `RecordingSyncStore.requestRefresh()`: SwiftData exposes no public API to force an
    /// `NSPersistentCloudKitContainer` fetch, so this does **not** reach out to CloudKit — it only
    /// surfaces rows CloudKit has already imported into the local store since the last read. Real
    /// cross-device delivery is push-driven (silent remote-notification wakes the process so
    /// `NSPersistentCloudKitContainer` can import on its own).
    public func requestRefresh() {
        reload()
    }

    // MARK: - Reads

    private func reload() {
        // Dedup on the real write clock (`modifiedAt`, max-by-dayKey) FIRST, independent of fetch
        // order — see `DigestSync.dedupByDayKeyLastWriterWins`. Sorting by `date` up front and
        // keeping the first duplicate (the previous approach) is NOT last-writer-wins: `date` is
        // the journaled day, not a write clock, so two devices can produce rows for the same
        // `dayKey` with the same `date` but different times of day, and the wrong one could sort
        // first. Only sort for display AFTER the dedup has already picked the true winner.
        let descriptor = FetchDescriptor<DigestEntity>()
        let entities: [DigestEntity]
        do {
            entities = try context.fetch(descriptor)
        } catch {
            recordError("Failed to fetch digests: \(error.localizedDescription)")
            return
        }
        let deduped = DigestSync.dedupByDayKeyLastWriterWins(
            entities.map { (digest: $0.digest, modifiedAt: $0.modifiedAt) }
        )
        digests = deduped.sorted { $0.date > $1.date }
    }

    private func firstEntity(dayKey: String) -> DigestEntity? {
        // Fetch all matching then keep the first — CloudKit may have produced duplicates, and
        // we mutate a single canonical row (dedup at read hides the rest).
        var descriptor = FetchDescriptor<DigestEntity>(
            predicate: #Predicate { $0.dayKey == dayKey },
            sortBy: [SortDescriptor(\.modifiedAt, order: .reverse)]
        )
        descriptor.fetchLimit = 1
        return (try? context.fetch(descriptor))?.first
    }

    private func upsertEntity(_ digest: DailyDigest, modifiedAt: Date) {
        // Last-writer-wins: the incoming record only overwrites the stored row when it is at
        // least as new as what's already there. A stale or out-of-order write — e.g. an older
        // copy arriving after a CloudKit sync — is dropped so it can't clobber newer data.
        // `modifiedAt` is carried from the winning write so subsequent comparisons keep
        // converging on the same latest state.
        if let existing = firstEntity(dayKey: digest.id) {
            guard modifiedAt >= existing.modifiedAt else { return }
            existing.apply(digest, modifiedAt: modifiedAt)
        } else {
            context.insert(DigestEntity(digest, modifiedAt: modifiedAt))
        }
    }

    /// Persist pending context changes. Returns whether the save actually succeeded — callers
    /// that gate a durable side effect on "the write landed" (e.g. `migrateLegacyJSONIfNeeded()`
    /// setting the one-time migration flag) must check this rather than assume success just
    /// because `save()` was called; a save failure is already surfaced via `recordError`, so
    /// callers that don't need the outcome (`upsert`) can ignore the return value.
    @discardableResult
    private func save() -> Bool {
        do {
            try context.save()
            return true
        } catch {
            recordError("Failed to save context: \(error.localizedDescription)")
            return false
        }
    }

    private func recordError(_ message: String) {
        lastErrorMessage = message
        Self.log.error("\(message, privacy: .public)")
    }

    // MARK: - Migration

    /// One-time import of the legacy `Documents/journal.json` history into SwiftData. Idempotent
    /// on day key (so a re-run can't duplicate) and gated on the `digestMigratedV1` flag. The
    /// legacy `journal.json` is deliberately LEFT IN PLACE as a durable local backup: if the
    /// CloudKit-backed container later fails to init (e.g. the user signs out of iCloud) the
    /// store falls back to the JSON backend, which must still find the history. The flag — not
    /// deleting the file — is what prevents a re-import.
    ///
    /// The flag is set ONLY after `save()` reports success. `context.save()` can fail (disk full,
    /// CloudKit schema not ready yet, etc.) and previously that failure was only logged — the
    /// migration flag was still set unconditionally right after, so a failed import was never
    /// retried and the imported-but-unsaved rows vanished with the context, silently losing the
    /// journal history for good. Leaving the flag unset on failure means the next launch retries;
    /// `upsertEntity`'s day-key upsert keeps that retry idempotent, so partially-saved rows from a
    /// prior attempt can't be duplicated. Mirrors `RecordingSyncStore.migrateLegacyJSONIfNeeded()`.
    private func migrateLegacyJSONIfNeeded() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: DigestSync.migratedFlagKey) else { return }

        let fm = FileManager.default
        guard let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let jsonURL = docs.appendingPathComponent("journal.json")
        guard fm.fileExists(atPath: jsonURL.path) else {
            // No legacy file — nothing to import, but still mark done so we don't re-check.
            defaults.set(true, forKey: DigestSync.migratedFlagKey)
            return
        }

        guard let data = try? Data(contentsOf: jsonURL) else {
            Self.log.error("Migration: failed to read legacy journal.json")
            return
        }
        let legacy = DigestSync.decodeLegacy(data)
        for d in legacy { upsertEntity(d, modifiedAt: DigestSync.lastWriteAt(for: d)) }
        guard save() else {
            // `save()` already called `recordError` — don't mark the migration done so it's
            // retried on the next launch instead of silently dropping the journal history.
            return
        }

        // The flag (not deleting the file) prevents re-import; journal.json stays as the
        // JSON-backend fallback's durable copy.
        defaults.set(true, forKey: DigestSync.migratedFlagKey)
    }
}
