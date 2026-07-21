import ActivityKit
import WidgetKit
import SwiftUI
import AppIntents

// Real Dynamic Island + Lock Screen Live Activity for an in-progress dictation, styled per
// mob-triggers.jsx:196-241 DynamicIslandScene (black pill, ghost-gradient mic glyph, "Recording"
// + engine tag, timer, red Stop circle). `WhisperioLiveActivityAttributes` and
// `LiveActivityStopIntent` live in Sources/WhisperioApp/LiveActivityStopIntent.swift (the App
// target, so the Stop intent truly runs in-process) and are cross-wired into this target's
// Sources build phase in project.pbxproj — same technique already used for DictateIntent.swift.
//
// The bar pattern below is FIXED decoration, not a live waveform — ActivityKit has no cheap way
// to stream real per-frame audio levels into a Live Activity, and faking motion would violate the
// no-mocked-data policy. The timer is real: `Text(timerInterval:)` computes live elapsed time
// straight from `attributes.startedAt`, no periodic Activity update needed to keep it ticking.

private let wzAccent = Color(red: 28 / 255, green: 200 / 255, blue: 180 / 255)
private let wzAccentLite = Color(red: 108 / 255, green: 226 / 255, blue: 209 / 255)
private let wzRed = Color(red: 255 / 255, green: 69 / 255, blue: 58 / 255)
private let wzGreen = Color(red: 34 / 255, green: 197 / 255, blue: 94 / 255)   // Theme.swift dark .green

// R6: tapping the "Saved · tap to record" pill reuses Whisperio's existing dictate deep link
// (AppShell.swift's `handle(_:)` — whisperio://dictate, the same route the keyboard's bounce-to-
// app flow uses) rather than inventing a new URL scheme. `return=keyboard` is specific to that
// keyboard flow so it's omitted here; a bare `dictate` host just opens straight into recording.
private let wzDictateURL = URL(string: "whisperio://dictate")

/// Static decorative bars — never claims to be a live level meter.
private struct StaticBars: View {
    var color: Color
    private let heights: [CGFloat] = [6, 12, 8, 16, 10, 14, 7, 11, 9, 13]
    var body: some View {
        HStack(spacing: 3) {
            ForEach(Array(heights.enumerated()), id: \.offset) { _, h in
                Capsule().fill(color).frame(width: 2.5, height: h)
            }
        }
    }
}

private func engineTag(_ isOnDevice: Bool) -> String { isOnDevice ? "on-device" : "cloud" }

@available(iOS 16.2, *)
private struct MicBadge: View {
    var body: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [wzAccent, wzAccentLite], startPoint: .topLeading, endPoint: .bottomTrailing))
            Image(systemName: "mic.fill").font(.system(size: 15, weight: .semibold)).foregroundStyle(.black)
        }
        .frame(width: 34, height: 34)
    }
}

// iOS 17 is when LiveActivityIntent (and therefore an interactive Stop button) is available;
// on iOS 16.2–16.x the Activity still renders (timer + engine tag), just without an in-Island
// Stop control — an honest capability gap rather than a fake button that does nothing.

/// R6: green check + "Saved · tap to record" (mob-triggers.jsx:217-221) — rendered only once the
/// note has actually persisted (LiveActivityController.finishSaved, called from RecordingView's
/// real success paths). Tapping deep-links straight into a fresh dictation via `wzDictateURL`.
private struct SavedCheckBadge: View {
    var body: some View {
        ZStack {
            Circle().fill(wzGreen)
            Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(.black)
        }
        .frame(width: 26, height: 26)
    }
}

@available(iOS 16.2, *)
private struct LockScreenLiveActivityView: View {
    let context: ActivityViewContext<WhisperioLiveActivityAttributes>

    var body: some View {
        switch context.state.phase {
        case .recording:
            HStack(spacing: 14) {
                MicBadge()
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 7) {
                        Circle().fill(wzRed).frame(width: 7, height: 7)
                        Text("Recording").font(.system(size: 13.5, weight: .semibold)).foregroundStyle(.white)
                        Text(engineTag(context.state.isOnDevice)).font(.system(size: 11, design: .monospaced)).foregroundStyle(.white.opacity(0.6))
                    }
                    StaticBars(color: wzAccentLite)
                }
                Spacer(minLength: 0)
                Text(timerInterval: context.attributes.startedAt...Date.distantFuture, countsDown: false)
                    .font(.system(size: 14, design: .monospaced)).foregroundStyle(.white).monospacedDigit()
                if #available(iOS 17.0, *) {
                    Button(intent: LiveActivityStopIntent()) {
                        ZStack {
                            Circle().fill(wzRed)
                            Image(systemName: "stop.fill").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                        }
                        .frame(width: 34, height: 34)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(14)
            .activityBackgroundTint(Color.black)
            .activitySystemActionForegroundColor(.white)
        case .saved:
            HStack(spacing: 10) {
                SavedCheckBadge()
                Text("Saved · tap to record")
                    .font(.system(size: 13.5, weight: .semibold)).foregroundStyle(.white)
                Spacer(minLength: 0)
            }
            .padding(14)
            .activityBackgroundTint(Color.black)
            .activitySystemActionForegroundColor(.white)
            .widgetURL(wzDictateURL)
        }
    }
}

@available(iOS 16.2, *)
struct WhisperioLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WhisperioLiveActivityAttributes.self) { context in
            LockScreenLiveActivityView(context: context)
        } dynamicIsland: { context in
            let saved = context.state.phase == .saved
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    if saved { SavedCheckBadge() } else { MicBadge() }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if !saved {
                        Text(timerInterval: context.attributes.startedAt...Date.distantFuture, countsDown: false)
                            .font(.system(size: 14, design: .monospaced)).foregroundStyle(.white).monospacedDigit()
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    if saved {
                        // R6: saved phase (mob-triggers.jsx:217-221) — no engine tag/waveform,
                        // just the honest confirmation.
                        Text("Saved · tap to record")
                            .font(.system(size: 13.5, weight: .semibold)).foregroundStyle(.white)
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 7) {
                                Circle().fill(wzRed).frame(width: 7, height: 7)
                                Text("Recording").font(.system(size: 13.5, weight: .semibold)).foregroundStyle(.white)
                                Text(engineTag(context.state.isOnDevice)).font(.system(size: 11, design: .monospaced)).foregroundStyle(.white.opacity(0.6))
                            }
                            StaticBars(color: wzAccentLite)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    // Saved phase has nothing left to stop — the Activity is already lingering
                    // toward self-dismissal (LiveActivityController.finishSaved), so no button.
                    if !saved {
                        if #available(iOS 17.0, *) {
                            Button(intent: LiveActivityStopIntent()) {
                                HStack(spacing: 8) {
                                    Image(systemName: "stop.fill")
                                    Text("Stop")
                                }
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(wzRed, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            } compactLeading: {
                if saved {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(wzGreen)
                } else {
                    Image(systemName: "mic.fill").foregroundStyle(wzAccentLite)
                }
            } compactTrailing: {
                if saved {
                    Text("Saved").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                } else {
                    Text(timerInterval: context.attributes.startedAt...Date.distantFuture, countsDown: false)
                        .font(.system(size: 13, design: .monospaced)).monospacedDigit().foregroundStyle(.white)
                }
            } minimal: {
                if saved {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(wzGreen)
                } else {
                    Image(systemName: "mic.fill").foregroundStyle(wzAccentLite)
                }
            }
            .widgetURL(saved ? wzDictateURL : nil)
            .keylineTint(saved ? wzGreen : wzAccent)
        }
    }
}
