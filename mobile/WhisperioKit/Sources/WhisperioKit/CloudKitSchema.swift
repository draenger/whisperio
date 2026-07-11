#if DEBUG
import Foundation
import CoreData
import CloudKit

/// DEBUG-only CloudKit schema bootstrap for WhisperioKit's SwiftData models.
///
/// SwiftData's `ModelContainer` doesn't expose the `NSPersistentCloudKitContainer` running
/// underneath it, so there is no supported way to ask a `ModelContainer` to push its schema to
/// CloudKit directly. Instead this builds a **separate, throwaway** `NSManagedObjectModel` — by
/// hand — that describes the same CloudKit-safe shape `RecordingEntity`/`DigestEntity` already
/// use (entity names `CD_RecordingEntity` / `CD_DigestEntity`, matching what SwiftData itself
/// names the record types it generates; every attribute optional, no unique constraints), points
/// a scratch `NSPersistentCloudKitContainer` at it, and calls `initializeCloudKitSchema(options:)`
/// to force CloudKit to materialize the record types. This replaces the old "add one seed row and
/// hope the container's own JIT schema creation notices" trick with an explicit, deliberate call.
///
/// RELEASE STEP — read this before shipping any build that depends on a NEW record type (e.g.
/// adding `DigestEntity`'s `CD_DigestEntity`, which today's Production schema does not have):
/// 1. Run a DEBUG build once (Mac or iOS), signed into iCloud, so `initializeSchemaForDevelopment()`
///    actually executes — this creates the schema in the CloudKit **Development** environment only.
/// 2. Open CloudKit Console → the `iCloud.ai.whisperio.mobile` container → Schema → confirm the
///    new record type(s) now exist under Development.
/// 3. Promote Development → Production: either "Deploy Schema Changes to Production" in the
///    CloudKit Console UI, or from the command line: `cktool export-schema` against Development
///    followed by `cktool import-schema` against Production.
/// 4. Only AFTER that promotion ships, release the TestFlight/App Store build that syncs the new
///    record type — Production CloudKit environments never lazily create schema on first write
///    the way Development does, so a build that syncs a record type Production doesn't know about
///    will simply fail to sync those rows, silently, with no schema error surfaced to the user.
public enum WhisperioCloudKit {
    /// Builds the `NSPersistentCloudKitContainer` schema for `RecordingEntity` + `DigestEntity`
    /// and pushes it to CloudKit's Development environment. Safe to call more than once (CloudKit
    /// no-ops when the record type already matches); callers typically still gate the call behind
    /// a UserDefaults "already ran" flag to avoid the local-store + network round-trip on every
    /// launch (see `WhisperioMacApp.seedCloudKitSchema()`).
    ///
    /// Blocks the calling thread until the scratch local store finishes loading — deliberately
    /// synchronous because this is a rare, one-shot DEBUG bootstrap call (never on a hot path),
    /// and `initializeCloudKitSchema(options:)` itself is a synchronous, throwing network call.
    ///
    /// Throws if the scratch local store can't load, or if CloudKit rejects the schema push (no
    /// iCloud account signed in, container unreachable, etc).
    ///
    /// `@MainActor` only because it reads `RecordingSyncStore.cloudKitContainerID`, which is
    /// isolated to `RecordingSyncStore`'s actor; callers (DEBUG app bootstrap code) already run
    /// this from the main actor.
    @MainActor
    public static func initializeSchemaForDevelopment() throws {
        let model = NSManagedObjectModel()
        model.entities = [recordingEntityDescription(), digestEntityDescription()]

        let container = NSPersistentCloudKitContainer(name: "WhisperioCloudKitSchemaInit", managedObjectModel: model)

        // A dedicated, throwaway local store in a temp location — never the app's real SwiftData
        // store — so this one-off schema push can't collide with (or corrupt) real persisted data.
        let scratchURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("WhisperioCloudKitSchemaInit-\(UUID().uuidString).sqlite")
        let description = NSPersistentStoreDescription(url: scratchURL)
        description.cloudKitContainerOptions = NSPersistentCloudKitContainerOptions(
            containerIdentifier: RecordingSyncStore.cloudKitContainerID
        )
        // NSPersistentCloudKitContainer requires history tracking + remote-change notifications
        // to be enabled on any store it manages, even one that (like this scratch store) is only
        // ever used for the one-time schema push and never read from again.
        description.setOption(true as NSNumber, forKey: NSPersistentHistoryTrackingKey)
        description.setOption(true as NSNumber, forKey: NSPersistentStoreRemoteChangeNotificationPostOptionKey)
        container.persistentStoreDescriptions = [description]

        var loadError: Error?
        let loaded = DispatchSemaphore(value: 0)
        container.loadPersistentStores { _, error in
            loadError = error
            loaded.signal()
        }
        loaded.wait()
        if let loadError { throw loadError }

        try container.initializeCloudKitSchema(options: [])

        // The schema has been pushed to CloudKit by this point — the local scratch file served
        // its one purpose (satisfying NSPersistentCloudKitContainer's "must have a loaded store"
        // requirement) and shouldn't linger on disk.
        try? FileManager.default.removeItem(at: scratchURL)
    }

    private static func attribute(_ name: String, _ type: NSAttributeType) -> NSAttributeDescription {
        let attr = NSAttributeDescription()
        attr.name = name
        attr.attributeType = type
        attr.isOptional = true
        return attr
    }

    /// Mirrors `RecordingEntity`'s CloudKit-safe shape (see RecordingEntity.swift) field-for-field
    /// — every attribute optional, matching the "optional-or-defaulted, never unique" schema rule.
    ///
    /// `internal` (not `private`) so `@testable import WhisperioKit` can reach it from
    /// `CloudKitSchemaParityTests` without widening the public API — `initializeSchemaForDevelopment()`
    /// stays the only symbol package A depends on.
    static func recordingEntityDescription() -> NSEntityDescription {
        let entity = NSEntityDescription()
        entity.name = "CD_RecordingEntity"
        entity.managedObjectClassName = NSStringFromClass(NSManagedObject.self)
        entity.properties = [
            attribute("id", .UUIDAttributeType),
            attribute("filename", .stringAttributeType),
            attribute("timestamp", .dateAttributeType),
            attribute("duration", .doubleAttributeType),
            attribute("statusRaw", .stringAttributeType),
            attribute("providerRaw", .stringAttributeType),
            attribute("transcription", .stringAttributeType),
            attribute("error", .stringAttributeType),
            attribute("category", .stringAttributeType),
            attribute("render", .stringAttributeType),
            attribute("renderPresetID", .stringAttributeType),
            attribute("modifiedAt", .dateAttributeType)
        ]
        return entity
    }

    /// Mirrors `DigestEntity`'s CloudKit-safe shape (see DigestEntity.swift) field-for-field —
    /// every attribute optional, matching the "optional-or-defaulted, never unique" schema rule.
    ///
    /// `internal` (not `private`) so `@testable import WhisperioKit` can reach it from
    /// `CloudKitSchemaParityTests` without widening the public API — `initializeSchemaForDevelopment()`
    /// stays the only symbol package A depends on.
    static func digestEntityDescription() -> NSEntityDescription {
        let entity = NSEntityDescription()
        entity.name = "CD_DigestEntity"
        entity.managedObjectClassName = NSStringFromClass(NSManagedObject.self)
        entity.properties = [
            attribute("dayKey", .stringAttributeType),
            attribute("date", .dateAttributeType),
            attribute("recordingIDsData", .binaryDataAttributeType),
            attribute("groupsData", .binaryDataAttributeType),
            attribute("summary", .stringAttributeType),
            attribute("summaryGeneratedAt", .dateAttributeType),
            attribute("modifiedAt", .dateAttributeType)
        ]
        return entity
    }
}
#endif
