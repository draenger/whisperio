import Testing
import Foundation
import SwiftData
@testable import WhisperioKit

struct RecordingEntityTests {
    // MARK: - Pure helpers (no container / CloudKit account needed)

    // A legacy recordings.json blob decodes into value types via the migration helper.
    @Test func migrationDecodesLegacyJSON() throws {
        let legacy = """
        [
          {
            "id": "6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8",
            "filename": "clip.caf",
            "timestamp": 700000000,
            "duration": 4.2,
            "status": "completed",
            "provider": "ondevice",
            "transcription": "hello world"
          },
          {
            "id": "11111111-2222-3333-4444-555555555555",
            "filename": "two.caf",
            "timestamp": 700000100,
            "duration": 1.0,
            "status": "pending"
          }
        ]
        """.data(using: .utf8)!
        let recs = RecordingSync.decodeLegacy(legacy)
        #expect(recs.count == 2)
        #expect(recs[0].transcription == "hello world")
        #expect(recs[0].provider == .onDevice)
        #expect(recs[1].status == .pending)
    }

    // Unreadable / garbage data decodes to an empty array rather than throwing.
    @Test func migrationDecodeToleratesGarbage() {
        let recs = RecordingSync.decodeLegacy(Data([0x00, 0x01, 0x02]))
        #expect(recs.isEmpty)
    }

    // Duplicate ids collapse to the first occurrence; order is otherwise preserved.
    @Test func dedupByIDKeepsFirst() {
        let shared = UUID()
        let a = Recording(id: shared, filename: "a.caf", duration: 1, transcription: "first")
        let b = Recording(id: shared, filename: "b.caf", duration: 1, transcription: "second")
        let c = Recording(filename: "c.caf", duration: 1)
        let deduped = RecordingSync.dedupByID([a, b, c])
        #expect(deduped.count == 2)
        #expect(deduped[0].transcription == "first")
        #expect(deduped[1].filename == "c.caf")
    }

    // MARK: - iCloud resume mismatch (pure — no container, no CloudKit account needed)

    // storageMode == .iCloud but the live store fell back to non-cloud-backed → the "split
    // history" mismatch a Settings banner should surface with a one-tap resume.
    @Test func iCloudResumeMismatchDetectsFallback() {
        #expect(RecordingSync.iCloudResumeMismatch(storageMode: .iCloud, isCloudBacked: false))
    }

    // Matching states — iCloud choice with a cloud-backed store, or on-device choice regardless
    // of backend — are not a mismatch.
    @Test func iCloudResumeMismatchIgnoresConsistentStates() {
        #expect(!RecordingSync.iCloudResumeMismatch(storageMode: .iCloud, isCloudBacked: true))
        #expect(!RecordingSync.iCloudResumeMismatch(storageMode: .onDevice, isCloudBacked: false))
        #expect(!RecordingSync.iCloudResumeMismatch(storageMode: .onDevice, isCloudBacked: true))
    }

    // MARK: - Entity mapping (no container needed — @Model instances stand alone)

    @available(iOS 17, macOS 14, *)
    @Test func entityRoundTripsRecording() {
        var rec = Recording(
            filename: "clip.caf",
            duration: 4.2,
            status: .completed,
            provider: .openAI,
            transcription: "hello"
        )
        rec.category = "ideas"
        rec.render = "Hello!"
        rec.renderPresetID = "email"

        let entity = RecordingEntity(rec)
        let back = entity.recording
        #expect(back == rec)
        #expect(entity.id == rec.id)
        #expect(entity.statusRaw == "completed")
        #expect(entity.providerRaw == "openai")
    }

    // Regression: `RecordingEntity.init(_:modifiedAt:)`'s default must seed `modifiedAt` from
    // the recording's own `lastWriteAt`, never from wall-clock `Date()`. A fresh `Recording` has
    // `updatedAt == nil`, so `lastWriteAt == timestamp`; if the default instead captured `Date()`
    // at call time, `entity.modifiedAt` would almost never exactly equal `entity.timestamp` (two
    // separate `Date()` calls, nanoseconds apart), so the "never edited" check in `recording`
    // (`modifiedAt == timestamp`) would spuriously fail and project a non-nil `updatedAt` for a
    // record nobody ever edited — silently corrupting the LWW clock for every recording made this
    // way (this is exactly what broke `entityRoundTripsRecording` above before the fix).
    @available(iOS 17, macOS 14, *)
    @Test func entityDefaultModifiedAtSeedsFromLastWriteAtNotWallClock() {
        let rec = Recording(filename: "clip.caf", duration: 1)
        #expect(rec.updatedAt == nil)

        let entity = RecordingEntity(rec)
        #expect(entity.modifiedAt == rec.timestamp)
        #expect(entity.modifiedAt == rec.lastWriteAt)
        #expect(entity.recording.updatedAt == nil)

        // An explicitly-edited recording (updatedAt set) must seed modifiedAt from that edit
        // time, not from timestamp — the default has to track lastWriteAt in both directions.
        let editedAt = rec.timestamp.addingTimeInterval(42)
        var edited = rec
        edited.updatedAt = editedAt
        let editedEntity = RecordingEntity(edited)
        #expect(editedEntity.modifiedAt == editedAt)
    }

    // Unknown raw strings decode tolerantly: bad status → .pending, bad provider → nil.
    @available(iOS 17, macOS 14, *)
    @Test func entityTolerantDecodeOfUnknownRaws() {
        let entity = RecordingEntity(
            id: UUID(),
            filename: "x.caf",
            duration: 1,
            statusRaw: "not-a-status",
            providerRaw: "not-a-provider"
        )
        let rec = entity.recording
        #expect(rec.status == .pending)
        #expect(rec.provider == nil)
    }

    // apply() overwrites mutable fields in place, keeping the same identity and bumping modifiedAt.
    @available(iOS 17, macOS 14, *)
    @Test func applyUpdatesInPlace() {
        let id = UUID()
        let entity = RecordingEntity(Recording(id: id, filename: "old.caf", duration: 1))
        let original = entity.modifiedAt
        var updated = Recording(id: id, filename: "new.caf", duration: 2, status: .completed)
        updated.category = "work"
        entity.apply(updated, modifiedAt: original.addingTimeInterval(10))
        #expect(entity.id == id)
        #expect(entity.filename == "new.caf")
        #expect(entity.statusRaw == "completed")
        #expect(entity.category == "work")
        #expect(entity.modifiedAt > original)
    }

    // The entity->value projection must carry the LWW clock: an edited row (modifiedAt bumped
    // past the creation timestamp, e.g. by setCategory/setRender) has to report that bumped
    // time as `lastWriteAt`, or a real newer edit can lose to a stale re-insert elsewhere.
    @available(iOS 17, macOS 14, *)
    @Test func recordingProjectionCarriesModifiedAtWhenEdited() {
        let timestamp = Date(timeIntervalSince1970: 1_000_000)
        let editedAt = timestamp.addingTimeInterval(60)
        let entity = RecordingEntity(
            id: UUID(),
            filename: "clip.caf",
            timestamp: timestamp,
            duration: 1,
            modifiedAt: editedAt
        )
        #expect(entity.recording.lastWriteAt == editedAt)
        #expect(entity.recording.updatedAt == editedAt)
    }

    // A never-edited row (modifiedAt == timestamp, as set at creation) must project `updatedAt`
    // as nil so serialization/equality of freshly created records is unchanged.
    @available(iOS 17, macOS 14, *)
    @Test func recordingProjectionOmitsUpdatedAtWhenUnedited() {
        let timestamp = Date(timeIntervalSince1970: 1_000_000)
        let entity = RecordingEntity(
            id: UUID(),
            filename: "clip.caf",
            timestamp: timestamp,
            duration: 1,
            modifiedAt: timestamp
        )
        #expect(entity.recording.updatedAt == nil)
        #expect(entity.recording.lastWriteAt == timestamp)
    }

    // Round-trip: entity -> recording -> RecordingEntity(recording, modifiedAt: recording.lastWriteAt)
    // must preserve the original modifiedAt, so a migrated/re-inserted row (the
    // migrateCurrentLibraryToCloud -> add -> upsert path) keeps the correct LWW clock instead of
    // resetting to the creation timestamp.
    @available(iOS 17, macOS 14, *)
    @Test func recordingProjectionRoundTripsThroughReinsertion() {
        let timestamp = Date(timeIntervalSince1970: 1_000_000)
        let editedAt = timestamp.addingTimeInterval(3600)
        let original = RecordingEntity(
            id: UUID(),
            filename: "clip.caf",
            timestamp: timestamp,
            duration: 1,
            modifiedAt: editedAt
        )
        let projected = original.recording
        let reinserted = RecordingEntity(projected, modifiedAt: projected.lastWriteAt)
        #expect(reinserted.modifiedAt == editedAt)
        #expect(reinserted.recording.lastWriteAt == editedAt)
    }

    // MARK: - Container-dependent (in-memory; skipped if a store can't init headlessly)

    @available(iOS 17, macOS 14, *)
    @MainActor
    @Test func inMemoryStoreAddsDedupsAndMutates() throws {
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        // If SwiftData can't stand up a store in this environment, skip rather than fail.
        guard let store = try? RecordingSyncStore(configuration: config) else { return }

        let id = UUID()
        store.add(Recording(id: id, filename: "a.caf", duration: 1, transcription: "first"))
        // Re-adding the same id upserts rather than duplicating.
        store.add(Recording(id: id, filename: "a.caf", duration: 1, transcription: "updated"))
        #expect(store.items.count == 1)
        #expect(store.items.first?.transcription == "updated")

        store.setCategory("work", for: id)
        #expect(store.items.first?.category == "work")

        store.setRender("Hi!", presetID: "email", for: id)
        #expect(store.items.first?.render == "Hi!")
        #expect(store.items.first?.renderPresetID == "email")

        store.delete(Recording(id: id, filename: "a.caf", duration: 1))
        #expect(store.items.isEmpty)
    }

    // Last-writer-wins: a stale/out-of-order re-add of the same id (older `updatedAt`) must NOT
    // clobber a newer stored write, while a genuinely newer write does win.
    @available(iOS 17, macOS 14, *)
    @MainActor
    @Test func lastWriterWinsRejectsStaleWrite() throws {
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        guard let store = try? RecordingSyncStore(configuration: config) else { return }

        let id = UUID()
        let base = Date()
        // Establish a newer stored value.
        store.add(Recording(id: id, filename: "a.caf", duration: 1,
                            transcription: "newer", updatedAt: base.addingTimeInterval(100)))
        #expect(store.items.first?.transcription == "newer")

        // An older write arriving late is dropped — the newer value survives.
        store.add(Recording(id: id, filename: "a.caf", duration: 1,
                            transcription: "stale", updatedAt: base))
        #expect(store.items.count == 1)
        #expect(store.items.first?.transcription == "newer")

        // A genuinely newer write wins.
        store.add(Recording(id: id, filename: "a.caf", duration: 1,
                            transcription: "newest", updatedAt: base.addingTimeInterval(200)))
        #expect(store.items.first?.transcription == "newest")
    }
}
