#if os(macOS)
import SwiftUI
import ServiceManagement

// Real macOS "Launch at login" control (F7/R8): backed by `SMAppService.mainApp`, the modern
// (macOS 13+) replacement for the deprecated SMLoginItemSetEnabled/LSSharedFileList APIs — this
// target's deployment floor is 14.0, so no availability gating is needed. Label follows
// wz-tabs.jsx:22's platform-conditional copy (`red ? 'Launch at login' : 'Launch at Windows
// startup'`); this native Mac app only ever runs on macOS, so it always uses the macOS wording.
@MainActor
final class LaunchAtLoginController: ObservableObject {
    static let shared = LaunchAtLoginController()

    @Published private(set) var isEnabled: Bool

    private init() {
        isEnabled = SMAppService.mainApp.status == .enabled
    }

    // Re-reads the real system status — SMAppService's status can change out from under the app
    // (System Settings ▸ General ▸ Login Items lets the user remove it directly), so the toggle
    // shouldn't just trust whatever it last set.
    func refresh() {
        isEnabled = SMAppService.mainApp.status == .enabled
    }

    func setEnabled(_ enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            // Honest failure: no fake toggle state — re-read whatever the system actually did
            // (registration can fail, e.g. if the login-item entry is disabled by MDM policy)
            // instead of assuming the call succeeded.
            NSLog("[Whisperio] SMAppService \(enabled ? "register" : "unregister") failed: \(error)")
        }
        refresh()
    }
}

// The full macOS Settings (⌘,) window is now MacSettingsShell.swift's wz-shell.jsx port —
// General/Startup content (Launch at login toggle) lives there as MacGeneralTab, and the
// per-action hotkey rows live in its MacHotkeysTab. This file keeps only the controller.
#endif
