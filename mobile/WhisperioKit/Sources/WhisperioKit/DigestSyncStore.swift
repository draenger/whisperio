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

    /// Collapse duplicate day keys, keeping the first occurrence. CloudKit can't enforce
    /// uniqueness, so the same logical day may arrive as two rows after a sync; this makes
    /// reads deterministic.
    public static func dedupByDayKey(_ digests: [DailyDigest]) -> [DailyDigest] {
        var seen = Set<String>()
        var out: [DailyDigest] = []
        out.reserveCapacity(digests.count)
        for d in digests where seen.insert(d.id).inserted {
            out.append(d)
        }
        return out
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
    /// Note: this notification isn't scoped per-container, so if `RecordingSyncStore` is also
    /// live in-process this store's observer also fires on ITS import/export events (and vice
    /// versa) — harmless (a spurious `reload()`/spinner blip), just not perfectly precise.
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
            let syncing = (endDate == nil)
            MainActor.assumeIsolated {
                self?.isSyncing = syncing
                switch Self.syncEffect(type: type, succeeded: succeeded, endDate: endDate, error: error) {
                case .importSucceeded(let endDate):
                    self?.lastImportAt = endDate
                    self?.reload()
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
        // Newest day first (by the journaled date); among CloudKit-produced duplicates of the
        // same day (identical date), the newest `modifiedAt` sorts first so the keep-first dedup
        // below resolves the collision last-writer-wins.
        let descriptor = FetchDescriptor<DigestEntity>(
            sortBy: [
                SortDescriptor(\.date, order: .reverse),
                SortDescriptor(\.modifiedAt, order: .reverse)
            ]
        )
        let entities: [DigestEntity]
        do {
            entities = try context.fetch(descriptor)
        } catch {
            recordError("Failed to fetch digests: \(error.localizedDescription)")
            return
        }
        digests = DigestSync.dedupByDayKey(entities.map(\.digest))
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

    private func save() {
        do {
            try context.save()
        } catch {
            recordError("Failed to save context: \(error.localizedDescription)")
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
    /// deleting the file — is what prevents a re-import. Mirrors
    /// `RecordingSyncStore.migrateLegacyJSONIfNeeded()`.
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
        save()

        // The flag (not deleting the file) prevents re-import; journal.json stays as the
        // JSON-backend fallback's durable copy.
        defaults.set(true, forKey: DigestSync.migratedFlagKey)
    }
}
