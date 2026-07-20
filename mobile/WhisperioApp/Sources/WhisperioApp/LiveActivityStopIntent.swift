import AppIntents
import Foundation
import WhisperioKit
#if canImport(ActivityKit) && os(iOS)
import ActivityKit
#endif

// Real Dynamic Island / Lock Screen Live Activity for an in-progress dictation
// (mob-triggers.jsx:196-241 DynamicIslandScene). Lives in the App target (Sources/WhisperioApp)
// so the intent below truly runs in the app's process, but the widget extension's
// ActivityConfiguration also needs to see both types to compile its Button — this file is
// wired into BOTH targets' Sources build phases in project.pbxproj, mirroring the existing
// DictateIntent.swift cross-target pattern.
//
// Gated on ActivityKit's availability: this file is physically inside Sources/WhisperioApp,
// which the Mac target also compiles. ActivityKit is importable on macOS but its Live
// Activity APIs (ActivityAttributes, LiveActivityIntent, etc.) are unavailable there, so the
// gate is canImport(ActivityKit) && os(iOS) — everything below is a no-op on Mac rather than
// a build error.
#if canImport(ActivityKit) && os(iOS)

/// Static launch data for the dictation Live Activity. Deliberately minimal — `startedAt` is all
/// the widget needs to render a real elapsed timer via `Text(timerInterval:)`; there is no live
/// waveform/level field because ActivityKit has no cheap way to stream real per-frame audio
/// levels across the process boundary, and faking one would violate the no-mocked-data policy.
@available(iOS 16.2, *)
public struct WhisperioLiveActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Whether THIS session's primary engine is on-device — the same check RecordingView
        /// already makes (providerChain.first is .onDevice/.localWhisper). Never hardcoded to
        /// "on-device" regardless of the real engine, unlike the static design mock.
        public var isOnDevice: Bool
        public init(isOnDevice: Bool) { self.isOnDevice = isOnDevice }
    }
    public var startedAt: Date
    public init(startedAt: Date) { self.startedAt = startedAt }
}

/// The Live Activity's Stop button. Conforms to `LiveActivityIntent` so iOS runs `perform()` in
/// the app's own process without foregrounding it — the design's "tap Stop right there, no need
/// to return to the app" promise. It cannot reach into a specific `RecordingView` instance
/// directly (App Intents have no such handle), so it leaves a durable request in the shared App
/// Group store; `RecordingView` already ticks once a second while listening (for the auto-stop
/// timeout) and consumes the flag there, then stops exactly like the in-app Stop button.
@available(iOS 17.0, *)
public struct LiveActivityStopIntent: LiveActivityIntent {
    public static var title: LocalizedStringResource = "Stop Whisperio dictation"
    public static var description = IntentDescription("Stop the in-progress Whisperio dictation.")

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult {
        SharedStore.requestLiveActivityStop()
        return .result()
    }
}

#endif
