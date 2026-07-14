import Foundation

/// Pure, container-free decision functions for `SyncMode` — kept off the `@available` SwiftData
/// surface (mirrors `RecordingSync`/`DigestSync`) so the mode → behavior matrix is unit-testable
/// headlessly, with no `ModelContainer`, no CloudKit account, and no `Timer`/`scenePhase` required.
///
/// HONESTY NOTE (repeated from `SyncMode`'s doc comment because it's the whole reason this type
/// exists): none of these functions can or do pause iOS's own background CloudKit import — that
/// stays outside this app's control on SwiftData+CloudKit. They only decide (a) whether an
/// already-landed import is published live into the UI, and (b) when the app proactively nudges
/// CloudKit to check for more while it's in the foreground.
public enum SyncGating {
    /// Whether a CloudKit import event should publish straight into the UI (`RecordingSyncStore
    /// .items` / `DigestSyncStore.digests`) the moment it lands, or be held in the local SwiftData
    /// store until the next explicit nudge/refresh asks for it. Only `.automatic` publishes live —
    /// every other mode still lets iOS import into the on-disk store in the background (nothing
    /// here can stop that), it just doesn't surface the result until the mode's own nudge fires.
    public static func shouldPublishLiveUpdates(_ mode: SyncMode) -> Bool {
        mode == .automatic
    }

    /// Whether the app should fire one immediate refresh/nudge when it enters the foreground
    /// (`scenePhase` transitioning to `.active`). True for every mode except `.manual`:
    /// `.automatic` already publishes live off CloudKit's own events, but a foreground nudge is
    /// cheap insurance against a stalled sync (mirrors the pre-existing behavior); `.onOpen` and
    /// `.interval` both use the on-open nudge as their baseline refresh. `.manual` never nudges
    /// without an explicit tap.
    public static func shouldNudgeOnForeground(_ mode: SyncMode) -> Bool {
        mode != .manual
    }

    /// The interval at which the app should proactively re-nudge while it stays in the foreground,
    /// or `nil` if no recurring timer should run for this mode. Only `.interval` returns a
    /// concrete interval, built from the user's chosen `minutes` and clamped to be positive (at
    /// least 1 minute) so a corrupt or zero setting can't produce a runaway sub-second timer.
    /// `.automatic`/`.onOpen` rely solely on their one-shot foreground nudge (see
    /// `shouldNudgeOnForeground`); `.manual` never schedules anything.
    public static func nextNudgeInterval(mode: SyncMode, minutes: Int) -> TimeInterval? {
        guard mode == .interval else { return nil }
        return TimeInterval(max(1, minutes) * 60)
    }
}
