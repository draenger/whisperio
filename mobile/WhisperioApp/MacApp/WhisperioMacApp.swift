#if os(macOS)
import SwiftUI

// Native macOS entry point. This lives as source-only under MacApp/ and is NOT yet wired into
// an Xcode target — adding a "Whisperio (macOS)" app target that compiles these files (plus
// WhisperioKit and WhisperioMac.entitlements) is a manual step. Everything macOS-specific is
// guarded by `#if os(macOS)` so the folder can be dropped into a target without further edits.
@main
struct WhisperioMacApp: App {
    var body: some Scene {
        WindowGroup("Whisperio") {
            ContentView()
        }
        .defaultSize(width: 720, height: 520)

        // Standard macOS Settings window (⌘,) — the tabbed 760-wide teal panes.
        Settings {
            SettingsWindow()
        }
    }
}
#endif
