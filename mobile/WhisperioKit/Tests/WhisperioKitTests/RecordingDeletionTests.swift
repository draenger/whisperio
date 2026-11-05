import Testing
import Foundation
import SwiftData
@testable import WhisperioKit

/// Deleting recordings: only the chosen one goes, every row of a duplicated id goes (two devices can
/// leave two rows with the same id after a CloudKit merge; a leftover row would resurrect it in
/// `items`), an unknown id is a harmless no-op, and the delete is durable on disk.
// Nested in SwiftDataSerialTests: SwiftData suites must not run in parallel with each other.
extension SwiftDataSerialTests {
struct RecordingDeletionTests {
    private static func tempStoreURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("deletion-\(UUID().uuidString).store")
    }

    private static func removeStore(_ url: URL) {
        for suffix in ["", "-shm", "-wal"] { try? FileManager.default.removeItem(atPath: url.path + suffix) }
    }

    @MainActor private static func rows(_ container: ModelContainer, id: UUID) -> Int {
        let descriptor = FetchDescriptor<RecordingEntity>(predicate: #Predicate { $0.id == id })
        return (try? container.mainContext.fetchCount(descriptor)) ?? -1
    }

    @available(iOS 17, macOS 14, *)
    @MainActor
    @Test func deleteRemovesOnlyTheChosenRecording() throws {
        guard let store = try? RecordingSyncStore(configuration: ModelConfiguration(isStoredInMemoryOnly: true)) else { return }
        let a = Recording(filename: "a.caf", duration: 1, transcription: "a")
        let b = Recording(filename: "b.caf", duration: 1, transcription: "b")
        let c = Recording(filename: "c.caf", duration: 1, transcription: "c")
        store.add([a, b, c])
        store.delete(b)
        #expect(Set(store.items.map(\.id)) == [a.id, c.id])
        #expect(store.lastErrorMessage == nil)
    }

    @available(iOS 17, macOS 14, *)
    @MainActor
    @Test func deleteRemovesEveryRowOfADuplicatedID() throws {
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        guard let container = try? RecordingSyncStore.buildContainer(configuration: config) else { return }
        let id = UUID()
        let keep = Recording(filename: "keep.caf", duration: 1)
        // Two rows with one id, as a CloudKit merge from two devices can leave them.
        container.mainContext.insert(RecordingEntity(Recording(id: id, filename: "x.caf", duration: 1, transcription: "one")))
        container.mainContext.insert(RecordingEntity(Recording(id: id, filename: "x.caf", duration: 1, transcription: "two")))
        container.mainContext.insert(RecordingEntity(keep))
        try container.mainContext.save()
        #expect(Self.rows(container, id: id) == 2)

        let store = RecordingSyncStore(container: container, ownStoreURL: config.url)
        #expect(store.items.filter { $0.id == id }.count == 1) // deduped for display
        store.delete(Recording(id: id, filename: "x.caf", duration: 1))

        #expect(Self.rows(container, id: id) == 0)
        #expect(store.items.map(\.id) == [keep.id])
    }

    @available(iOS 17, macOS 14, *)
    @MainActor
    @Test func deletingAnUnknownIDChangesNothingAndRecordsNoError() throws {
        guard let store = try? RecordingSyncStore(configuration: ModelConfiguration(isStoredInMemoryOnly: true)) else { return }
        let a = Recording(filename: "a.caf", duration: 1)
        store.add(a)
        store.delete(Recording(filename: "never-saved.caf", duration: 1))
        #expect(store.items.map(\.id) == [a.id])
        #expect(store.lastErrorMessage == nil)
    }

    @available(iOS 17, macOS 14, *)
    @MainActor
    @Test func deleteIsDurableAcrossReopeningTheStoreFile() throws {
        let url = Self.tempStoreURL()
        defer { Self.removeStore(url) }
        let a = Recording(filename: "a.caf", duration: 1)
        let b = Recording(filename: "b.caf", duration: 1)
        do {
            guard let store = try? RecordingSyncStore(configuration: ModelConfiguration(url: url)) else { return }
            store.add([a, b])
            store.delete(a)
        }
        guard let reopened = try? RecordingSyncStore(configuration: ModelConfiguration(url: url)) else { return }
        #expect(reopened.items.map(\.id) == [b.id])
    }
}
}
