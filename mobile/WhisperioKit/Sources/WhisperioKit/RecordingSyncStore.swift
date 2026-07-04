import Foundation
import SwiftData
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
}

/// SwiftData + CloudKit-backed facade over the recordings history. Exposes the same surface
/// the app already drives against `RecordingsStore` (`items`, `add`, `delete`, `setCategory`,
/// `setRender`) but persists into a private CloudKit database so history follows the user
/// across devices. Reads dedup on `id` because CloudKit can't enforce uniqueness.
@available(iOS 17, macOS 14, *)
@MainActor
public final class RecordingSyncStore: ObservableObject {
    /// Current recordings, newest first, deduped on id. Recomputed after every mutation.
    @Published public private(set) var items: [Recording] = []

    private let container: ModelContainer
    private var context: ModelContext { container.mainContext }

    private static let log = Logger(subsystem: "ai.whisperio", category: "RecordingSyncStore")

    /// The private CloudKit database the schema syncs against. Mirrors the app's iCloud
    /// container id; the entitlement must list the same identifier.
    public static let cloudKitContainerID = "iCloud.ai.whisperio.mobile"

    /// Build the store, syncing through CloudKit only when an iCloud account is actually available.
    /// Without a signed-in account (simulator, signed-out user, or an unsigned build) a
    /// CloudKit-backed `ModelContainer` FAULTS at creation — SwiftData's CloudKit mirroring needs a
    /// live account + the `remote-notification` background mode + a provisioned container — and that
    /// fault is not catchable, so it would crash the app on launch. In that case we persist locally
    /// (plain on-disk SwiftData, no CloudKit) so history still works and sync silently resumes once
    /// the user signs in and a fresh launch upgrades to the CloudKit configuration.
    public convenience init() throws {
        let config: ModelConfiguration
        if FileManager.default.ubiquityIdentityToken != nil {
            config = ModelConfiguration(cloudKitDatabase: .private(RecordingSyncStore.cloudKitContainerID))
        } else {
            config = ModelConfiguration()
        }
        try self.init(configuration: config)
    }

    /// Designated init — takes an explicit `ModelConfiguration` so tests can inject an
    /// in-memory, CloudKit-free store.
    public init(configuration: ModelConfiguration) throws {
        container = try ModelContainer(for: RecordingEntity.self, configurations: configuration)
        migrateLegacyJSONIfNeeded()
        reload()
    }

    // MARK: - Surface

    /// Insert a recording. Idempotent on id: if a row with the same id already exists it is
    /// updated in place rather than duplicated.
    public func add(_ r: Recording) {
        upsert(r)
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

    // MARK: - Reads

    private func reload() {
        let descriptor = FetchDescriptor<RecordingEntity>(
            sortBy: [SortDescriptor(\.timestamp, order: .reverse)]
        )
        let entities: [RecordingEntity]
        do {
            entities = try context.fetch(descriptor)
        } catch {
            Self.log.error("Failed to fetch recordings: \(error.localizedDescription)")
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
        if let existing = firstEntity(id: r.id) {
            existing.apply(r)
        } else {
            context.insert(RecordingEntity(r))
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
            Self.log.error("Failed to save context: \(error.localizedDescription)")
        }
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
