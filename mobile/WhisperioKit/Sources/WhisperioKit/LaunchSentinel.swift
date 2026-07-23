import Foundation
import os

/// Crash-loop breaker for the CloudKit-backed stores.
///
/// A broken CloudKit mirroring setup can SIGTRAP the process on
/// `com.apple.coredata.cloudkit.queue` seconds after launch (`PFCloudKitSetupAssistant
/// _initializeCloudKitForObservedStore`). The trap is not catchable in-process, so the only
/// defense is cross-launch: notice that recent launches died young with the cloud-backed store
/// enabled, and bring the next launch up on the plain local store instead. The user's
/// `storageMode` setting is never touched — the store lands in the existing "pinned local for
/// this process" state, so Settings' "Resume iCloud sync" banner appears exactly as it does for
/// the no-account fallback.
///
/// Lifecycle per launch (runs only when a cloud-backed store is about to be used — the sync
/// stores consult `blocksCloudThisLaunch()` while deciding cloud vs local):
///  1. First call in the process does the accounting: a leftover "in flight" stamp means the
///     previous cloud-enabled launch never reached `markAlive()` → one more consecutive early
///     death; no stamp means it survived → streak resets. Then this launch is stamped in flight.
///     The result is latched so both stores (recordings + digests) get the same answer.
///  2. The app entry points call `markAlive()` once the process has provably outlived the
///     setup-trap window (~10s alive, or reaching background / a graceful quit) — clearing the
///     stamp and the streak.
///  3. `breakerThreshold` straight early deaths make `blocksCloudThisLaunch()` answer true for
///     the whole process: both stores start local, sync paused for this launch only.
/// `noteManualCloudResume()` (the Settings banner action) also clears the streak, so the user's
/// explicit return to cloud is honored on the next launch too.
@MainActor
public enum LaunchSentinel {
    /// Stamp (epoch seconds) written when a cloud-enabled launch starts; cleared by `markAlive()`.
    /// Its presence at the NEXT launch is the "previous launch died young" signal.
    static let inFlightAtKey = "whisperio.launchSentinel.inFlightAt.v1"
    /// Consecutive cloud-enabled launches that died before `markAlive()`.
    static let earlyDeathsKey = "whisperio.launchSentinel.earlyDeaths.v1"

    /// Two straight young deaths ⇒ the third launch comes up local.
    public static let breakerThreshold = 2

    /// How long the process must stay alive before the launch counts as survived — comfortably
    /// past the seconds-after-launch window the CloudKit setup trap kills in.
    public static let survivalSeconds: TimeInterval = 10

    private static let log = Logger(subsystem: "ai.whisperio", category: "LaunchSentinel")

    // Latched on first query so the per-launch accounting runs exactly once per process and
    // both sync stores agree — nil until the first cloud-enabled store init asks.
    private static var blocksCloud: Bool?

    /// Consulted by `RecordingSyncStore`/`DigestSyncStore`'s convenience inits at the moment
    /// they would opt into CloudKit. True ⇒ this launch must pin both stores to local storage.
    public static func blocksCloudThisLaunch(defaults: UserDefaults = .standard) -> Bool {
        if let blocksCloud { return blocksCloud }
        var deaths = defaults.integer(forKey: earlyDeathsKey)
        if defaults.object(forKey: inFlightAtKey) != nil {
            deaths += 1   // previous cloud-enabled launch never reached markAlive()
        } else {
            deaths = 0
        }
        defaults.set(deaths, forKey: earlyDeathsKey)
        defaults.set(Date().timeIntervalSince1970, forKey: inFlightAtKey)
        let tripped = deaths >= breakerThreshold
        if tripped {
            // One-shot diagnostic so a sysdiagnose/console capture shows the breaker fired.
            log.error("Crash-loop breaker TRIPPED: \(deaths) consecutive early deaths with CloudKit enabled — starting LOCAL stores this launch, iCloud sync paused (resume via Settings banner).")
        }
        blocksCloud = tripped
        return tripped
    }

    /// This launch provably survived the setup-trap window — clear the in-flight stamp and the
    /// early-death streak. Safe to call more than once, and when no stamp was ever written.
    public static func markAlive(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: inFlightAtKey)
        defaults.set(0, forKey: earlyDeathsKey)
    }

    /// The user explicitly resumed iCloud sync from the Settings banner — clear the streak so
    /// the next launch tries cloud again instead of staying pinned local.
    public static func noteManualCloudResume(defaults: UserDefaults = .standard) {
        defaults.set(0, forKey: earlyDeathsKey)
    }

    /// Test-only: forget the per-process latch so a single test process can simulate several
    /// launches. Never called from production code.
    static func resetProcessLatchForTesting() {
        blocksCloud = nil
    }
}
