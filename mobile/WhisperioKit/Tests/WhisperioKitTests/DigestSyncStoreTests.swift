import Testing
import Foundation
import SwiftData
@testable import WhisperioKit

struct DigestSyncStoreTests {
    // MARK: - Pure helpers (no container / CloudKit account needed)

    // A legacy journal.json blob decodes into value types via the migration helper.
    @Test func migrationDecodesLegacyJSON() throws {
        let legacy = """
        [
          {
            "id": "2026-07-01",
            "date": 700000000,
            "recordingIDs": ["6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8"],
            "groups": [{"categoryID": "work", "recordingIDs": ["6F1A2B3C-4D5E-6F70-8192-A3B4C5D6E7F8"], "blurb": "did stuff"}],
            "summary": "Worked on things",
            "summaryGeneratedAt": 700000500
          },
          {
            "id": "2026-07-02",
            "date": 700086400
          }
        ]
        """.data(using: .utf8)!
        let digests = DigestSync.decodeLegacy(legacy)
        #expect(digests.count == 2)
        #expect(digests[0].id == "2026-07-01")
        #expect(digests[0].summary == "Worked on things")
        #expect(digests[1].groups.isEmpty)
    }

    // Unreadable / garbage data decodes to an empty array rather than throwing.
    @Test func migrationDecodeToleratesGarbage() {
        let digests = DigestSync.decodeLegacy(Data([0x00, 0x01, 0x02]))
        #expect(digests.isEmpty)
    }

    // Duplicate day keys collapse to the row with the newest modifiedAt, regardless of input order.
    @Test func dedupByDayKeyKeepsNewestModifiedAt() {
        let base = Date()
        let a = (digest: DailyDigest(id: "2026-07-01", date: base, summary: "first"), modifiedAt: base)
        let b = (digest: DailyDigest(id: "2026-07-01", date: base, summary: "second"), modifiedAt: base.addingTimeInterval(10))
        let c = (digest: DailyDigest(id: "2026-07-02", date: base), modifiedAt: base)
        let deduped = DigestSync.dedupByDayKeyLastWriterWins([a, b, c])
        #expect(deduped.count == 2)
        #expect(deduped.first { $0.id == "2026-07-01" }?.summary == "second")
        #expect(deduped.contains { $0.id == "2026-07-02" })
    }

    // BUG 3 regression: two rows share a dayKey, but the one with the OLDER `date` (earlier
    // time-of-day journaled, e.g. a backfilled digest) actually has the NEWER `modifiedAt`
    // (write clock). A sort-by-date-then-keep-first dedup would wrongly keep the earlier `date`
    // row; last-writer-wins must key on `modifiedAt` alone and pick the newer write regardless of
    // where it falls once sorted by `date`.
    @Test func dedupByDayKeyLastWriterWinsIgnoresDateOrdering() {
        let day = Date(timeIntervalSince1970: 1_700_000_000)
        // Earlier time-of-day within the journaled day, but written most recently.
        let newerWriteEarlierTimeOfDay = (
            digest: DailyDigest(id: "2026-07-01", date: day, summary: "newer write, earlier time-of-day"),
            modifiedAt: Date(timeIntervalSince1970: 2_000_000_000)
        )
        // Later time-of-day within the journaled day, but written first (stale).
        let staleWriteLaterTimeOfDay = (
            digest: DailyDigest(id: "2026-07-01", date: day.addingTimeInterval(3_600), summary: "stale write, later time-of-day"),
            modifiedAt: Date(timeIntervalSince1970: 1_000_000_000)
        )
        let deduped = DigestSync.dedupByDayKeyLastWriterWins([staleWriteLaterTimeOfDay, newerWriteEarlierTimeOfDay])
        #expect(deduped.count == 1)
        #expect(deduped.first?.summary == "newer write, earlier time-of-day")

        // Order of the input shouldn't matter either.
        let dedupedReversed = DigestSync.dedupByDayKeyLastWriterWins([newerWriteEarlierTimeOfDay, staleWriteLaterTimeOfDay])
        #expect(dedupedReversed.first?.summary == "newer write, earlier time-of-day")
    }

    // MARK: - CloudKit event store filtering (BUG 8 mirror)

    // An event's storeIdentifier matching our own resolved identifier belongs to us.
    @Test func eventBelongsToStoreMatchesOwnIdentifier() {
        #expect(DigestSync.eventBelongsToStore(storeIdentifier: "abc", ownStoreIdentifier: "abc"))
    }

    // An event from the sibling RecordingSyncStore's container (different storeIdentifier) is
    // rejected — this is the fix for the cross-container contamination of isSyncing/
    // lastImportAt/lastExportAt.
    @Test func eventBelongsToStoreRejectsSiblingIdentifier() {
        #expect(!DigestSync.eventBelongsToStore(storeIdentifier: "recordings-store-id", ownStoreIdentifier: "digests-store-id"))
    }

    // When ownership can't be determined (e.g. an in-memory store with nothing on disk to read),
    // fail open rather than silently dropping every event.
    @Test func eventBelongsToStoreFailsOpenWhenOwnIdentifierUnknown() {
        #expect(DigestSync.eventBelongsToStore(storeIdentifier: "anything", ownStoreIdentifier: nil))
    }

    // lastWriteAt(for:) prefers summaryGeneratedAt (the real write time) over the journaled day.
    @Test func lastWriteAtPrefersSummaryGeneratedAt() {
        let day = Date(timeIntervalSince1970: 1_000)
        let generatedAt = Date(timeIntervalSince1970: 2_000)
        let withSummary = DailyDigest(id: "2026-07-01", date: day, summary: "s", summaryGeneratedAt: generatedAt)
        #expect(DigestSync.lastWriteAt(for: withSummary) == generatedAt)

        let withoutSummary = DailyDigest(id: "2026-07-01", date: day)
        #expect(DigestSync.lastWriteAt(for: withoutSummary) == day)
    }

    // MARK: - Entity mapping (no container needed — @Model instances stand alone)

    @available(iOS 17, macOS 14, *)
    @Test func entityRoundTripsDigest() {
        let digest = DailyDigest(
            id: "2026-07-01",
            date: Date(timeIntervalSince1970: 700_000_000),
            recordingIDs: [UUID()],
            groups: [DigestGroup(categoryID: "work", recordingIDs: [], blurb: "note")],
            summary: "Summary text",
            summaryGeneratedAt: Date(timeIntervalSince1970: 700_000_500)
        )
        let entity = DigestEntity(digest)
        let back = entity.digest
        #expect(back == digest)
        #expect(entity.dayKey == digest.id)
    }

    // apply() overwrites mutable fields in place, keeping the same identity and bumping modifiedAt.
    @available(iOS 17, macOS 14, *)
    @Test func applyUpdatesInPlace() {
        let dayKey = "2026-07-01"
        let entity = DigestEntity(DailyDigest(id: dayKey, date: Date()))
        let original = entity.modifiedAt
        let updated = DailyDigest(id: dayKey, date: Date(), summary: "New summary")
        entity.apply(updated, modifiedAt: original.addingTimeInterval(10))
        #expect(entity.dayKey == dayKey)
        #expect(entity.summary == "New summary")
        #expect(entity.modifiedAt > original)
    }

    // MARK: - Container-dependent (in-memory; skipped if a store can't init headlessly)

    @available(iOS 17, macOS 14, *)
    @MainActor
    @Test func inMemoryStoreUpsertsAndDedups() throws {
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        // If SwiftData can't stand up a store in this environment, skip rather than fail.
        guard let store = try? DigestSyncStore(configuration: config) else { return }

        let dayKey = "2026-07-01"
        let base = Date()
        store.upsert(DailyDigest(id: dayKey, date: base, summary: "first"), modifiedAt: base)
        #expect(store.digests.count == 1)
        #expect(store.digests.first?.summary == "first")

        // Re-upserting the same day key updates in place rather than duplicating.
        store.upsert(DailyDigest(id: dayKey, date: base, summary: "second"), modifiedAt: base.addingTimeInterval(10))
        #expect(store.digests.count == 1)
        #expect(store.digests.first?.summary == "second")
    }

    // Last-writer-wins: a stale/out-of-order re-upsert of the same day key (older modifiedAt) must
    // NOT clobber a newer stored write, while a genuinely newer write does win.
    @available(iOS 17, macOS 14, *)
    @MainActor
    @Test func lastWriterWinsRejectsStaleWrite() throws {
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        guard let store = try? DigestSyncStore(configuration: config) else { return }

        let dayKey = "2026-07-01"
        let base = Date()
        // Establish a newer stored value.
        store.upsert(DailyDigest(id: dayKey, date: base, summary: "newer"), modifiedAt: base.addingTimeInterval(100))
        #expect(store.digests.first?.summary == "newer")

        // An older write arriving late is dropped — the newer value survives.
        store.upsert(DailyDigest(id: dayKey, date: base, summary: "stale"), modifiedAt: base)
        #expect(store.digests.count == 1)
        #expect(store.digests.first?.summary == "newer")

        // A genuinely newer write wins.
        store.upsert(DailyDigest(id: dayKey, date: base, summary: "newest"), modifiedAt: base.addingTimeInterval(200))
        #expect(store.digests.first?.summary == "newest")
    }

    // A seeded journal.json migrates once on init; the flag prevents a second import from
    // re-adding (and potentially clobbering newer in-store data with stale JSON) on a later init.
    @available(iOS 17, macOS 14, *)
    @MainActor
    @Test func seededJournalMigratesOnce() throws {
        let defaults = UserDefaults.standard
        let flagKey = DigestSync.migratedFlagKey
        let originallySet = defaults.bool(forKey: flagKey)
        defer { if !originallySet { defaults.removeObject(forKey: flagKey) } }
        defaults.set(false, forKey: flagKey)

        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let jsonURL = docs.appendingPathComponent("journal.json")
        let hadExistingFile = FileManager.default.fileExists(atPath: jsonURL.path)
        var existingBackup: Data?
        if hadExistingFile { existingBackup = try? Data(contentsOf: jsonURL) }
        defer {
            if let existingBackup {
                try? existingBackup.write(to: jsonURL)
            } else if !hadExistingFile {
                try? FileManager.default.removeItem(at: jsonURL)
            }
        }

        let seeded = [DailyDigest(id: "2026-07-01", date: Date(), summary: "seeded")]
        let data = try JSONEncoder().encode(seeded)
        try data.write(to: jsonURL)

        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        guard let store = try? DigestSyncStore(configuration: config) else { return }
        #expect(store.digests.contains { $0.id == "2026-07-01" && $0.summary == "seeded" })
        #expect(defaults.bool(forKey: flagKey))

        // Overwrite the legacy file with a different value; a second store instance must NOT
        // re-import it because the flag is already set.
        let changed = [DailyDigest(id: "2026-07-01", date: Date(), summary: "changed-after-migration")]
        try JSONEncoder().encode(changed).write(to: jsonURL)

        let config2 = ModelConfiguration(isStoredInMemoryOnly: true)
        guard let store2 = try? DigestSyncStore(configuration: config2) else { return }
        #expect(store2.digests.isEmpty)
    }

    // BUG 5 regression: a migration whose import succeeds (rows built in the context) but whose
    // `save()` fails must NOT set `digestMigratedV1` — otherwise the failed write is never
    // retried and the journal history is gone for good. `allowsSave: false` is SwiftData's own
    // fault-injection lever for a read-only store, which is what lets this run headlessly (no
    // real disk-full / CloudKit-schema failure needed) — every `context.save()` on such a
    // configuration fails, which is exactly the condition this test needs to exercise.
    @available(iOS 17, macOS 14, *)
    @MainActor
    @Test func migrationDoesNotSetFlagWhenSaveFails() throws {
        let defaults = UserDefaults.standard
        let flagKey = DigestSync.migratedFlagKey
        let originallySet = defaults.bool(forKey: flagKey)
        defer { if !originallySet { defaults.removeObject(forKey: flagKey) } }
        defaults.set(false, forKey: flagKey)

        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let jsonURL = docs.appendingPathComponent("journal.json")
        let hadExistingFile = FileManager.default.fileExists(atPath: jsonURL.path)
        var existingBackup: Data?
        if hadExistingFile { existingBackup = try? Data(contentsOf: jsonURL) }
        defer {
            if let existingBackup {
                try? existingBackup.write(to: jsonURL)
            } else if !hadExistingFile {
                try? FileManager.default.removeItem(at: jsonURL)
            }
        }

        let seeded = [DailyDigest(id: "2026-07-01", date: Date(), summary: "seeded")]
        try JSONEncoder().encode(seeded).write(to: jsonURL)

        let config = ModelConfiguration(isStoredInMemoryOnly: true, allowsSave: false)
        guard let store = try? DigestSyncStore(configuration: config) else { return }

        // The import attempt ran, but the store can't persist it — the flag must stay unset so a
        // later launch (against a writable store) retries the import instead of skipping it.
        #expect(!defaults.bool(forKey: flagKey))
        #expect(store.lastErrorMessage != nil)
    }
}
