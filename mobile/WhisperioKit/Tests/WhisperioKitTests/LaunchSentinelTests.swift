import Testing
import Foundation
@testable import WhisperioKit

/// Unit tests for `LaunchSentinel` — the crash-loop breaker that pins the sync stores to local
/// storage after consecutive early deaths with CloudKit enabled. Runs headlessly against a
/// dedicated UserDefaults suite; each "launch" is simulated by resetting the per-process latch.
// `.serialized`: the per-process latch is shared mutable state — parallel tests would race on it.
@MainActor
@Suite(.serialized) struct LaunchSentinelTests {
    private static let suiteName = "whisperio.launchSentinelTests"

    private func freshDefaults() -> UserDefaults {
        let defaults = UserDefaults(suiteName: Self.suiteName)!
        defaults.removePersistentDomain(forName: Self.suiteName)
        LaunchSentinel.resetProcessLatchForTesting()
        return defaults
    }

    /// One simulated launch: reset the latch (new process) and ask the gate.
    private func launch(_ defaults: UserDefaults) -> Bool {
        LaunchSentinel.resetProcessLatchForTesting()
        return LaunchSentinel.blocksCloudThisLaunch(defaults: defaults)
    }

    @Test func firstLaunchAllowsCloudAndStampsInFlight() {
        let defaults = freshDefaults()
        #expect(launch(defaults) == false)
        #expect(defaults.object(forKey: LaunchSentinel.inFlightAtKey) != nil)
        #expect(defaults.integer(forKey: LaunchSentinel.earlyDeathsKey) == 0)
    }

    @Test func twoEarlyDeathsTripTheBreakerOnThirdLaunch() {
        let defaults = freshDefaults()
        #expect(launch(defaults) == false)   // launch 1: dies young (stamp never cleared)
        #expect(launch(defaults) == false)   // launch 2: one early death so far — still cloud
        #expect(defaults.integer(forKey: LaunchSentinel.earlyDeathsKey) == 1)
        #expect(launch(defaults) == true)    // launch 3: two straight early deaths — local
        #expect(defaults.integer(forKey: LaunchSentinel.earlyDeathsKey) == 2)
    }

    @Test func decisionIsLatchedPerProcessAndAccountingRunsOnce() {
        let defaults = freshDefaults()
        _ = launch(defaults)                 // launch 1 dies young
        LaunchSentinel.resetProcessLatchForTesting()
        // Launch 2: both stores ask — the counter must only move once.
        #expect(LaunchSentinel.blocksCloudThisLaunch(defaults: defaults) == false)
        #expect(LaunchSentinel.blocksCloudThisLaunch(defaults: defaults) == false)
        #expect(defaults.integer(forKey: LaunchSentinel.earlyDeathsKey) == 1)
    }

    @Test func markAliveClearsStampAndStreak() {
        let defaults = freshDefaults()
        _ = launch(defaults)                 // dies young
        _ = launch(defaults)                 // dies young again — streak at 1, stamped
        LaunchSentinel.markAlive(defaults: defaults)
        #expect(defaults.object(forKey: LaunchSentinel.inFlightAtKey) == nil)
        #expect(defaults.integer(forKey: LaunchSentinel.earlyDeathsKey) == 0)
        // Next launch starts a clean slate: cloud allowed.
        #expect(launch(defaults) == false)
        #expect(defaults.integer(forKey: LaunchSentinel.earlyDeathsKey) == 0)
    }

    @Test func survivedLaunchResetsStreakOnNextLaunchAccounting() {
        let defaults = freshDefaults()
        _ = launch(defaults)                 // launch 1 dies young
        _ = launch(defaults)                 // launch 2 — streak 1...
        LaunchSentinel.markAlive(defaults: defaults)   // ...but survives
        _ = launch(defaults)                 // launch 3: no stamp → streak reset, then dies young
        #expect(launch(defaults) == false)   // launch 4: streak back at 1, not 2 — cloud allowed
        #expect(defaults.integer(forKey: LaunchSentinel.earlyDeathsKey) == 1)
    }

    @Test func manualResumeClearsStreakSoNextLaunchTriesCloud() {
        let defaults = freshDefaults()
        _ = launch(defaults)
        _ = launch(defaults)
        #expect(launch(defaults) == true)    // breaker tripped, running local
        LaunchSentinel.noteManualCloudResume(defaults: defaults)
        // This (local, breaker-tripped) launch then dies young — but the user's explicit
        // resume means the next launch counts from that single death, not the old streak.
        #expect(launch(defaults) == false)
        #expect(defaults.integer(forKey: LaunchSentinel.earlyDeathsKey) == 1)
    }
}
