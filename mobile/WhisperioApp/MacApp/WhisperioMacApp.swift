#if os(macOS)
import SwiftUI

// Native macOS entry point. This lives as source-only under MacApp/ and is NOT yet wired into
// an Xcode target — adding a "Whisperio (macOS)" app target that compiles these files (plus
// WhisperioKit and WhisperioMac.entitlements) is a manual step. Everything macOS-specific is
// guarded by `#if os(macOS)` so the folder can be dropped into a target without further edits.
@main
struct WhisperioMacApp: App {
    var body: some Scene {
        WindowGroup("Whisperio", id: WhisperioWindow.main.rawValue) {
            ContentView()
        }
        .defaultSize(width: 720, height: 520)

        // Standard macOS Settings window (⌘,) — the tabbed 760-wide teal panes.
        Settings {
            SettingsWindow()
        }

        // Always-available menu-bar tray (macOS 13+). Mirrors the Electron desktop's tray
        // (desktop/src/main/tray.ts): quick dictation, open Settings / Recordings, quit. The
        // Whisperio waveform glyph is rendered as a template image so it adapts to the light /
        // dark menu bar; the accent tint carries the teal identity where the system permits.
        MenuBarExtra {
            MenuBarContent()
        } label: {
            Label("Whisperio", systemImage: "waveform")
        }
        .menuBarExtraStyle(.menu)
    }
}

// MARK: - Window identifiers

// Stable ids so the tray can raise / open the main recordings window via `openWindow(id:)`.
enum WhisperioWindow: String {
    case main
}

// MARK: - Tray menu

// The native tray menu. `.menu` style renders true AppKit menu items (system-drawn chrome, so
// the rows themselves can't be recolored) — the teal identity rides on the `.tint` accent and
// the templated waveform label. Dictation isn't wired yet (Phase 1), so "Dictate" broadcasts a
// notification the future hotkey / overlay controller (§4) will observe; everything else opens a
// real window.
@available(macOS 14, *)
private struct MenuBarContent: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button("Dictate") {
            // Stub: no capture engine yet. Bring the app forward and post the toggle so the
            // Phase-1 dictation controller (HotkeyManager / overlay pill) can pick it up.
            NSApp.activate(ignoringOtherApps: true)
            NotificationCenter.default.post(name: .wzDictateToggle, object: nil)
        }
        .keyboardShortcut(.space, modifiers: [.control, .shift])

        // macOS 14's SettingsLink opens the standard Settings scene from inside a menu.
        SettingsLink {
            Text("Settings…")
        }
        .keyboardShortcut(",", modifiers: .command)

        Button("Recordings") {
            NSApp.activate(ignoringOtherApps: true)
            openWindow(id: WhisperioWindow.main.rawValue)
        }

        Divider()

        Button("Quit Whisperio") {
            NSApplication.shared.terminate(nil)
        }
        .keyboardShortcut("q", modifiers: .command)
    }
}

extension Notification.Name {
    /// Posted by the tray "Dictate" item until the real capture engine lands (Phase 1, §4).
    static let wzDictateToggle = Notification.Name("ai.whisperio.mac.dictate.toggle")
}
#endif
