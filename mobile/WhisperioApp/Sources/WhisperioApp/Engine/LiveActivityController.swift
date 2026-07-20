import Foundation
#if canImport(ActivityKit) && os(iOS)
import ActivityKit
#endif

// Starts/ends the real Dynamic Island + Lock Screen Live Activity for an in-progress dictation
// (mob-triggers.jsx:196-241). RecordingView calls start() the moment capture actually begins and
// end() on every exit path (stop, cancel, error, interruption) — never leaves a stale Activity
// running. iOS-only: on macOS (which also compiles Sources/WhisperioApp) every call below is a
// silent no-op via #if canImport(ActivityKit).
@MainActor
final class LiveActivityController {
    static let shared = LiveActivityController()
    private init() {}

    #if canImport(ActivityKit) && os(iOS)
    @available(iOS 16.2, *)
    private static var _activity: Activity<WhisperioLiveActivityAttributes>?
    #endif

    /// Begin a Live Activity for a fresh capture session. Honest no-op — never a fake/placeholder
    /// Activity — when: Live Activities are disabled system-wide (Settings toggle), the OS is
    /// too old, one is already running, or the request throws (e.g. the user disabled them for
    /// this app specifically). Recording itself is entirely unaffected either way.
    func start(isOnDevice: Bool) {
        #if canImport(ActivityKit) && os(iOS)
        guard #available(iOS 16.2, *) else { return }
        guard Self._activity == nil else { return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attributes = WhisperioLiveActivityAttributes(startedAt: Date())
        let state = WhisperioLiveActivityAttributes.ContentState(isOnDevice: isOnDevice)
        do {
            Self._activity = try Activity.request(
                attributes: attributes,
                content: .init(state: state, staleDate: nil)
            )
        } catch {
            Self._activity = nil
        }
        #endif
    }

    /// End whatever Live Activity is running, if any. Safe to call even when none was started
    /// (every recording exit path calls this unconditionally).
    func end() {
        #if canImport(ActivityKit) && os(iOS)
        guard #available(iOS 16.2, *) else { return }
        guard let activity = Self._activity else { return }
        Self._activity = nil
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
        #endif
    }
}
