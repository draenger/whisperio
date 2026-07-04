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
}
