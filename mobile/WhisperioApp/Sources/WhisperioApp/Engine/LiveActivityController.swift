import Foundation
#if canImport(ActivityKit) && os(iOS)
import ActivityKit
#endif

// Starts/ends the real Dynamic Island + Lock Screen Live Activity for an in-progress dictation
// (mob-triggers.jsx:196-241). RecordingView calls start() the moment capture actually begins.
// R6: on a real SUCCESS (the note has actually persisted) the caller uses finishSaved() instead
// of end() — the Activity flips to the "Saved · tap to record" phase (mob-triggers.jsx:217-221)
// and lingers briefly before dismissing itself; every other exit path (cancel, error, mid-session
// failure) keeps calling end() immediately, matching the pre-existing "pill vanishes right away"
// behavior. iOS-only: on macOS (which also compiles Sources/WhisperioApp) every call below is a
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

    /// End whatever Live Activity is running, if any. Safe to call even when none was started.
    /// Cancel, error, and mid-session-failure exit paths call this unconditionally — the pill
    /// vanishes right away, with no "Saved" claim since nothing was actually saved.
    func end() {
        #if canImport(ActivityKit) && os(iOS)
        guard #available(iOS 16.2, *) else { return }
        guard let activity = Self._activity else { return }
        Self._activity = nil
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
        #endif
    }

    /// R6: the note has actually finished persisting (called from RecordingView's
    /// finalizeLive/transcribe success paths only, never speculatively) — flip the Activity to
    /// the "Saved · tap to record" phase for a short linger so the confirmation is actually seen,
    /// then end it. Never called on a failure/empty-transcript path; those call end() instead.
    func finishSaved(isOnDevice: Bool) {
        #if canImport(ActivityKit) && os(iOS)
        guard #available(iOS 16.2, *) else { return }
        guard let activity = Self._activity else { return }
        Self._activity = nil
        let saved = WhisperioLiveActivityAttributes.ContentState(isOnDevice: isOnDevice, phase: .saved)
        let lingerSeconds: TimeInterval = 6
        Task {
            await activity.update(.init(state: saved, staleDate: Date().addingTimeInterval(lingerSeconds)))
            try? await Task.sleep(nanoseconds: UInt64(lingerSeconds * 1_000_000_000))
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        #endif
    }
}
