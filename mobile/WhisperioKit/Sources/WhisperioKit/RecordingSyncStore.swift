import Foundation
import SwiftData
import CoreData
import CloudKit
import os

/// Pure, container-free helpers backing `RecordingSyncStore`. Kept off the `@available`
/// SwiftData surface so the migration/dedup logic stays unit-testable headlessly (no
/// ModelContainer, no CloudKit account required).
public enum RecordingSync {
    /// UserDefaults flag marking the one-time JSON → SwiftData migration as done.
    public static let migratedFlagKey = "migratedV2"

    /// Decode a legacy `recordings.json` blob into value types. Tolerant of a missing or
    /// unreadable file (returns `[]`) so a fresh install migrates to nothing gracefully.
    public static func decodeLegacy(_ data: Data) -> [Recording] {
        (try? JSONDecoder().decode([Recording].self, from: data)) ?? []
    }

    /// Collapse duplicate ids, keeping the first occurrence. CloudKit can't enforce
    /// uniqueness, so the same logical recording may arrive as two rows after a sync; this
    /// makes reads deterministic.
    public static func dedupByID(_ recordings: [Recording]) -> [Recording] {
        var seen = Set<UUID>()
        var out: [Recording] = []
        out.reserveCapacity(recordings.count)
        for r in recordings where seen.insert(r.id).inserted {
            out.append(r)
        }
        return out
    }

    /// True when the user's storage choice is `.iCloud` but the live library backend isn't
    /// CloudKit-backed — the "split history" mismatch where a device fell back to local-only
    /// (e.g. no iCloud account at launch, or CloudKit container init failed) and got pinned
    /// there because the `ModelConfiguration` is fixed for the process's lifetime. Two devices
    /// in this state each keep accumulating recordings nobody else ever sees.
    public static func iCloudResumeMismatch(storageMode: StorageMode, isCloudBacked: Bool) -> Bool {
        storageMode == .iCloud && !isCloudBacked
    }

    /// Resolves (creating if missing) the per-app "Application Support" directory that backs
    /// both `RecordingSyncStore`'s and `DigestSyncStore`'s on-disk SwiftData caches. Shared here
    /// (rather than duplicated per store) so the two stores — and the app's migration call
    /// sites, which must reopen the identical file — can never disagree on where "Application
    /// Support" is. `FileManager` resolves the same well-known directory on both iOS and macOS,
    /// just under a different sandbox container, so no platform branching is needed.
    public static func applicationSupportDirectory() throws -> URL {
        try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
    }

    /// On-disk cache file for `RecordingSyncStore`. Given an explicit name (rather than the
    /// default unnamed `ModelConfiguration`, which SwiftData resolves to a shared
    /// `default.store`), so it can never collide with `DigestSync.storeURL()`'s file — the two
    /// stores register disjoint single-entity schemas (`RecordingEntity`-only vs
    /// `DigestEntity`-only) and SwiftData throws on init if two configs with different schemas
    /// point at the same file. Used by both the convenience init and
    /// `RecordingsStore.migrateCurrentLibraryToCloud()`, which must open the identical file.
    public static func storeURL() throws -> URL {
        try applicationSupportDirectory().appendingPathComponent("Recordings.store")
    }
}

/// SwiftData + CloudKit-backed facade over the recordings history. Exposes the same surface
/// the app already drives against `RecordingsStore` (`items`, `add`, `delete`, `setCategory`,
/// `setRender`) but persists into a private CloudKit database so history follows the user
/// across devices. Reads dedup on `id` because CloudKit can't enforce uniqueness.
@available(iOS 17, macOS 14, *)
@MainActor
public final class RecordingSyncStore: ObservableObject {
    public struct EventLogEntry: Identifiable, Equatable {
        public let id = UUID()
        public let timestamp: Date
        public let kind: String
        public let state: String
        public let detail: String
    }

    /// Current recordings, newest first, deduped on id. Recomputed after every mutation.
    @Published public private(set) var items: [Recording] = []

    /// True while a CloudKit import/export is in flight (event `endDate == nil`). Drives the
    /// UI sync spinner. Always false for a non-cloud (on-device / in-memory) store.
    @Published public private(set) var isSyncing = false

    /// Whether this store persists into CloudKit (private DB). False for on-device / in-memory
    /// stores. Set once at init; used by the UI to decide whether to show the iCloud badge.
    @Published public private(set) var isCloudBacked: Bool

    /// Last local CloudKit/SwiftData error surfaced by this store. Useful for in-app diagnostics
    /// when sync silently falls back or a save/fetch starts failing.
    @Published public private(set) var lastErrorMessage: String?

    /// Most recent CloudKit sync events, newest first, capped for diagnostics.
    @Published public private(set) var recentEvents: [EventLogEntry] = []

    /// Last successful import/export timestamps. Useful for cross-device comparison.
    @Published public private(set) var lastImportAt: Date?
    @Published public private(set) var lastExportAt: Date?

    private let container: ModelContainer
    private var context: ModelContext { container.mainContext }

    /// Retained token for the `NSPersistentCloudKitContainer` event observer. Kept for the
    /// store's lifetime (the store lives as long as the app), so we never remove it.
    private var cloudEventObserver: NSObjectProtocol?

    private static let log = Logger(subsystem: "ai.whisperio", category: "RecordingSyncStore")

    /// The private CloudKit database the schema syncs against. Mirrors the app's iCloud
    /// container id; the entitlement must list the same identifier.
    public static let cloudKitContainerID = "iCloud.ai.whisperio.mobile"

    /// UserDefaults key the app's `SettingsStore` persists the `WhisperioSettings` JSON blob under.
    /// Kept in sync with `SettingsStore.key`; decoded here so the store can honor the user's
    /// on-device / iCloud choice without a compile dependency on the app target.
    public static let settingsDefaultsKey = "whisperio.settings.v1"

    /// The user's persisted storage choice, decoded from the settings blob in UserDefaults.
    /// Defaults to `.iCloud` (the shipped behavior) when the blob is absent or undecodable.
    private static func persistedStorageMode() -> StorageMode {
        guard let data = UserDefaults.standard.data(forKey: settingsDefaultsKey),
              let s = try? JSONDecoder().decode(WhisperioSettings.self, from: data) else {
            return .iCloud
        }
        return s.storageMode
    }

    /// Build the store, honoring the user's storage choice (Settings → Storage). Uses CloudKit
    /// only when the user picked `.iCloud` AND an iCloud account is present; otherwise a plain
    /// on-disk SwiftData store, which never touches CloudKit and so can't fault. The ubiquity
    /// guard means a signed-out device always falls back to local and never crashes.
    ///
    /// NOTE: the SwiftData `ModelContainer` config is fixed at init, so **changing the storage
    /// mode only takes effect on the next launch** — the UI tells the user as much.
    public convenience init() throws {
        let mode = RecordingSyncStore.persistedStorageMode()
        let useCloudKit = (mode == .iCloud)
            && FileManager.default.ubiquityIdentityToken != nil
        // Explicit, distinct on-disk file (not the unnamed-config default `default.store`) so
        // this store never collides with `DigestSyncStore`'s own cache file — see
        // `RecordingSync.storeURL()`.
        let url = try RecordingSync.storeURL()
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
        container = try ModelContainer(for: RecordingEntity.self, configurations: configuration)
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
            let kind = Self.kindLabel(for: event.type)
            let type = event.type
            let endDate = event.endDate
            let succeeded = event.succeeded
            let error = event.error
            let syncing = (endDate == nil)
            MainActor.assumeIsolated {
                self?.isSyncing = syncing
                if let endDate {
                    let state = succeeded ? "succeeded" : "failed"
                    let detail = error?.localizedDescription ?? "done"
                    self?.appendEvent(
                        timestamp: endDate,
                        kind: kind,
                        state: state,
                        detail: detail
                    )
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
    }

    /// Human-readable label for a CloudKit sync event's type, used both for the diagnostic event
    /// log (`appendEvent`) and to compose `recordError` messages.
    nonisolated static func kindLabel(for type: NSPersistentCloudKitContainer.EventType) -> String {
        if type == .setup { return "setup" }
        if type == .import { return "import" }
        if type == .export { return "export" }
        return "sync"
    }

    /// The follow-up effect for a CloudKit sync event, once it has already been appended to the
    /// diagnostic log (that append happens unconditionally in `observeCloudKitEvents` for every
    /// terminal event; this decides what — if anything — else changes). Pulled out as a pure,
    /// `nonisolated` function so the `.setup` / `.import` / `.export` × succeeded/failed decision
    /// matrix is unit-testable without a running `NSPersistentCloudKitContainer` — see
    /// `CloudKitEventHandlingTests`.
    enum SyncEffect: Equatable {
        /// Nothing further to do: the event is still in flight (`endDate == nil`), or it's a
        /// terminal event with no store mutation of its own — e.g. `.setup` succeeding, which has
        /// already been logged but has no rows to reload.
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
                // `.setup` (or any other future terminal-success type) — already logged above,
                // nothing else to mutate.
                return .none
            }
        }
        // Terminal failure. Mirrors the previous behavior: only surface `recordError` when
        // CloudKit actually attached an error; a failed event with no error is logged (above) but
        // not otherwise actionable.
        guard let error else { return .none }
        return .recordError(message: "CloudKit \(kindLabel(for: type)) failed: \(error.localizedDescription)")
    }

    private func appendEvent(timestamp: Date, kind: String, state: String, detail: String) {
        recentEvents.insert(.init(timestamp: timestamp, kind: kind, state: state, detail: detail), at: 0)
        if recentEvents.count > 12 {
            recentEvents = Array(recentEvents.prefix(12))
        }
    }

    // MARK: - Surface

    /// Insert a recording. Idempotent on id: if a row with the same id already exists it is
    /// updated in place rather than duplicated.
    public func add(_ r: Recording) {
        upsert(r)
        save()
        reload()
    }

    /// Seed this store from an existing recording snapshot. Duplicate ids are upserted, so the
    /// newest version of each record wins without creating extra rows.
    public func add(_ recordings: [Recording]) {
        for r in recordings { upsert(r) }
        save()
        reload()
    }

    /// Remove every row matching the recording's id.
    public func delete(_ r: Recording) {
        deleteByID(r.id)
        save()
        reload()
    }

    /// Reassign a recording's category. No-op if no matching row exists.
    public func setCategory(_ id: String, for recordingID: UUID) {
        guard let entity = firstEntity(id: recordingID) else { return }
        entity.category = id
        entity.modifiedAt = Date()
        save()
        reload()
    }

    /// Persist an AI-rewritten render + the preset that produced it. No-op if no matching
    /// row exists.
    public func setRender(_ text: String, presetID: String, for recordingID: UUID) {
        guard let entity = firstEntity(id: recordingID) else { return }
        entity.render = text
        entity.renderPresetID = presetID
        entity.modifiedAt = Date()
        save()
        reload()
    }

    /// Re-read the local SwiftData snapshot into `items`. This is honest about what it can and
    /// can't do: SwiftData exposes no public API to force an `NSPersistentCloudKitContainer`
    /// fetch, so this call does **not** reach out to CloudKit. The previous implementation posted
    /// `UIApplication.didBecomeActiveNotification` here, which was misleading busywork — nothing
    /// in this process observes that notification, and it isn't wired to CloudKit's import
    /// machinery regardless. All this method actually does is surface rows CloudKit has *already*
    /// imported into the local store since the last read (e.g. an import that landed in the
    /// background). Real cross-device delivery is push-driven: a silent remote-notification push
    /// wakes the process so `NSPersistentCloudKitContainer` can import on its own; there is no
    /// foreground call that substitutes for that.
    public func requestRefresh() {
        reload()
    }

    // MARK: - Reads

    private func reload() {
        // Newest recording first (by creation timestamp); among CloudKit-produced duplicates of
        // the same recording (identical timestamp), the newest `modifiedAt` sorts first so the
        // keep-first dedup below resolves the collision last-writer-wins.
        let descriptor = FetchDescriptor<RecordingEntity>(
            sortBy: [
                SortDescriptor(\.timestamp, order: .reverse),
                SortDescriptor(\.modifiedAt, order: .reverse)
            ]
        )
        let entities: [RecordingEntity]
        do {
            entities = try context.fetch(descriptor)
        } catch {
            recordError("Failed to fetch recordings: \(error.localizedDescription)")
            return
        }
        items = RecordingSync.dedupByID(entities.map(\.recording))
    }

    private func firstEntity(id: UUID) -> RecordingEntity? {
        // Fetch all matching then keep the first — CloudKit may have produced duplicates,
        // and we mutate a single canonical row (dedup at read hides the rest).
        var descriptor = FetchDescriptor<RecordingEntity>(
            predicate: #Predicate { $0.id == id },
            sortBy: [SortDescriptor(\.modifiedAt, order: .reverse)]
        )
        descriptor.fetchLimit = 1
        return (try? context.fetch(descriptor))?.first
    }

    private func upsert(_ r: Recording) {
        // Last-writer-wins: the incoming record only overwrites the stored row when it is at
        // least as new as what's already there (`lastWriteAt`, i.e. updatedAt ?? timestamp).
        // A stale or out-of-order write — e.g. an older copy arriving after a CloudKit sync —
        // is dropped so it can't clobber newer data. `modifiedAt` is carried from the winning
        // write so subsequent comparisons keep converging on the same latest state.
        let incoming = r.lastWriteAt
        if let existing = firstEntity(id: r.id) {
            guard incoming >= existing.modifiedAt else { return }
            existing.apply(r, modifiedAt: incoming)
        } else {
            context.insert(RecordingEntity(r, modifiedAt: incoming))
        }
    }

    private func deleteByID(_ id: UUID) {
        let descriptor = FetchDescriptor<RecordingEntity>(
            predicate: #Predicate { $0.id == id }
        )
        guard let matches = try? context.fetch(descriptor) else { return }
        for entity in matches { context.delete(entity) }
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

    /// One-time import of the legacy `Documents/recordings.json` history into SwiftData.
    /// Idempotent on id (so a re-run can't duplicate) and gated on the `migratedV2` flag. The
    /// legacy `recordings.json` is deliberately LEFT IN PLACE as a durable local backup: if the
    /// CloudKit-backed container later fails to init (e.g. the user signs out of iCloud) the store
    /// falls back to the JSON backend, which must still find the history. The flag — not deleting
    /// the file — is what prevents a re-import.
    private func migrateLegacyJSONIfNeeded() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: RecordingSync.migratedFlagKey) else { return }

        let fm = FileManager.default
        guard let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let jsonURL = docs.appendingPathComponent("recordings.json")
        guard fm.fileExists(atPath: jsonURL.path) else {
            // No legacy file — nothing to import, but still mark done so we don't re-check.
            defaults.set(true, forKey: RecordingSync.migratedFlagKey)
            return
        }

        guard let data = try? Data(contentsOf: jsonURL) else {
            Self.log.error("Migration: failed to read legacy recordings.json")
            return
        }
        let legacy = RecordingSync.decodeLegacy(data)
        for r in legacy { upsert(r) }
        save()

        // The flag (not deleting the file) prevents re-import; recordings.json stays as the
        // JSON-backend fallback's durable copy.
        defaults.set(true, forKey: RecordingSync.migratedFlagKey)
    }
}
