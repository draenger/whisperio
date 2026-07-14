import Testing
import Foundation
@testable import WhisperioKit

/// Unit tests for `SyncGating` — the pure mode → behavior decision matrix backing the
/// sync-controls feature (automatic / onOpen / interval / manual). Runs headlessly: no
/// `ModelContainer`, no CloudKit account, no `Timer`/`scenePhase`.
// `.serialized`: the two `persistedSyncMode()` tests below both read/write the real, shared
// `UserDefaults.standard` key `RecordingSyncStore.settingsDefaultsKey` (save/restored via
// `defer`, mirroring `DigestSyncStoreTests`) — run in parallel with each other they'd race on
// that single key and flake. The pure `SyncGating` tests above don't touch global state and are
// unaffected by running serialized too.
@Suite(.serialized) struct SyncGatingTests {
    // MARK: - shouldPublishLiveUpdates

    @Test func onlyAutomaticPublishesLiveUpdates() {
        #expect(SyncGating.shouldPublishLiveUpdates(.automatic) == true)
        #expect(SyncGating.shouldPublishLiveUpdates(.onOpen) == false)
        #expect(SyncGating.shouldPublishLiveUpdates(.interval) == false)
        #expect(SyncGating.shouldPublishLiveUpdates(.manual) == false)
    }

    // MARK: - shouldNudgeOnForeground

    @Test func everyModeExceptManualNudgesOnForeground() {
        #expect(SyncGating.shouldNudgeOnForeground(.automatic) == true)
        #expect(SyncGating.shouldNudgeOnForeground(.onOpen) == true)
        #expect(SyncGating.shouldNudgeOnForeground(.interval) == true)
        #expect(SyncGating.shouldNudgeOnForeground(.manual) == false)
    }

    // MARK: - nextNudgeInterval

    @Test func onlyIntervalModeReturnsARecurringInterval() {
        #expect(SyncGating.nextNudgeInterval(mode: .automatic, minutes: 15) == nil)
        #expect(SyncGating.nextNudgeInterval(mode: .onOpen, minutes: 15) == nil)
        #expect(SyncGating.nextNudgeInterval(mode: .manual, minutes: 15) == nil)
    }

    @Test func intervalModeConvertsMinutesToSeconds() {
        #expect(SyncGating.nextNudgeInterval(mode: .interval, minutes: 15) == 900)
        #expect(SyncGating.nextNudgeInterval(mode: .interval, minutes: 5) == 300)
        #expect(SyncGating.nextNudgeInterval(mode: .interval, minutes: 60) == 3600)
    }

    // A corrupt/zero/negative minutes value can't produce a runaway sub-minute timer — clamped
    // to at least one minute.
    @Test func intervalModeClampsNonPositiveMinutesToOneMinute() {
        #expect(SyncGating.nextNudgeInterval(mode: .interval, minutes: 0) == 60)
        #expect(SyncGating.nextNudgeInterval(mode: .interval, minutes: -5) == 60)
    }

    // MARK: - persistedSyncMode() — read fresh from UserDefaults on every CloudKit event, unlike
    // storageMode which is pinned at ModelConfiguration init. Isolates the shared settings key
    // (save/restore in `defer`, mirroring DigestSyncStoreTests' UserDefaults isolation pattern) so
    // this can't clobber a real persisted blob if `swift test` ever runs against real defaults.

    @available(iOS 17, macOS 14, *)
    @Test func persistedSyncModeDefaultsToAutomaticWhenNoBlobStored() {
        let defaults = UserDefaults.standard
        let key = RecordingSyncStore.settingsDefaultsKey
        let existing = defaults.data(forKey: key)
        defer { if let existing { defaults.set(existing, forKey: key) } else { defaults.removeObject(forKey: key) } }
        defaults.removeObject(forKey: key)

        #expect(RecordingSyncStore.persistedSyncMode() == .automatic)
        #expect(DigestSyncStore.persistedSyncMode() == .automatic)
    }

    @available(iOS 17, macOS 14, *)
    @Test func persistedSyncModeReflectsStoredSettingsForBothStores() throws {
        let defaults = UserDefaults.standard
        let key = RecordingSyncStore.settingsDefaultsKey
        let existing = defaults.data(forKey: key)
        defer { if let existing { defaults.set(existing, forKey: key) } else { defaults.removeObject(forKey: key) } }

        let settings = WhisperioSettings(syncMode: .interval, syncIntervalMinutes: 30)
        defaults.set(try JSONEncoder().encode(settings), forKey: key)

        // Both stores decode the identical shared blob — they must agree.
        #expect(RecordingSyncStore.persistedSyncMode() == .interval)
        #expect(DigestSyncStore.persistedSyncMode() == .interval)
    }
}
