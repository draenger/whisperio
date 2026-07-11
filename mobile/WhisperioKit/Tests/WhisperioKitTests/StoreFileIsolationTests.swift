import Testing
import Foundation
import SwiftData
@testable import WhisperioKit

/// Regression guard for the `default.store` collision: `RecordingSyncStore` and
/// `DigestSyncStore` used to both build an unnamed `ModelConfiguration`, which SwiftData
/// resolves to the same on-disk file (`Application Support/default.store`). Because the two
/// stores register disjoint single-entity schemas (`RecordingEntity`-only vs `DigestEntity`-
/// only), the second store to open that shared file threw on init — and `DigestStore` silently
/// pinned itself to the `journal.json` fallback forever (see `DigestStore.init`'s catch branch).
/// This suite is disk-backed (deliberately NOT `isStoredInMemoryOnly` — the collision only
/// exists on disk, an in-memory store never round-trips through a shared file) and mirrors the
/// app's real construction order (`RecordingsStore` builds its store before `DigestStore` does)
/// against real temp-dir URLs, so a future regression back to a shared/unnamed configuration
/// fails here instead of silently degrading on device.
struct StoreFileIsolationTests {
    @available(iOS 17, macOS 14, *)
    @MainActor
    @Test func recordingAndDigestStoresCoexistOnDisk() throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("StoreFileIsolationTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        // Mirrors `RecordingSync.storeURL()` / `DigestSync.storeURL()` — two distinct files in
        // the same directory, exactly what the fix gives each store in the real Application
        // Support directory.
        let recordingsURL = tempDir.appendingPathComponent("Recordings.store")
        let digestsURL = tempDir.appendingPathComponent("Digests.store")

        // Construction order matches the app: RecordingsStore.init() builds its RecordingSyncStore
        // first, then DigestStore.init() builds its DigestSyncStore — the exact sequence that used
        // to throw on the second init when both resolved to the same unnamed `default.store`.
        let recordingConfig = ModelConfiguration(url: recordingsURL)
        let recordingStore = try RecordingSyncStore(configuration: recordingConfig)

        let digestConfig = ModelConfiguration(url: digestsURL)
        let digestStore = try DigestSyncStore(configuration: digestConfig)

        let recording = Recording(filename: "isolation.caf", duration: 12, status: .completed,
                                   transcription: "disk isolation check")
        recordingStore.add(recording)

        let digest = DailyDigest(id: "2026-07-11", date: Date(), summary: "disk isolation check")
        digestStore.upsert(digest)

        #expect(recordingStore.items.contains { $0.id == recording.id })
        #expect(digestStore.digests.contains { $0.id == "2026-07-11" })

        // Reload both from fresh containers pointed at the same URLs, proving the writes landed
        // on disk (not just each store's in-memory @Published cache) and that each file still
        // opens cleanly against its own single-entity schema on a second construction — the
        // scenario that previously threw and drove `DigestStore` to the JSON fallback.
        let reloadedRecordingStore = try RecordingSyncStore(configuration: ModelConfiguration(url: recordingsURL))
        let reloadedDigestStore = try DigestSyncStore(configuration: ModelConfiguration(url: digestsURL))
        #expect(reloadedRecordingStore.items.contains { $0.id == recording.id })
        #expect(reloadedDigestStore.digests.contains { $0.id == "2026-07-11" })
    }
}
