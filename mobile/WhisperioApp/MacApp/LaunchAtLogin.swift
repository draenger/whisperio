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

// The macOS Settings (⌘,) window — this native Mac target's only system-standard Preferences
// surface (the shared SettingsView is presented as an in-app sheet elsewhere in the split shell
// and already covers everything else; this pane stays intentionally minimal rather than
// duplicating that hub).
struct MacGeneralSettingsView: View {
    @AppStorage("wz.split.dark") private var splitDark = true
    // `@ObservedObject`, not `@StateObject` — `.shared` is an existing singleton this view
    // doesn't own the lifecycle of.
    @ObservedObject private var launch = LaunchAtLoginController.shared
    private var t: WZTheme { .of(splitDark) }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Launch at login")
                        .font(WZFont.ui(14, .medium)).foregroundStyle(t.text)
                    Text("Automatically start Whisperio when you log in")
                        .font(WZFont.ui(12)).foregroundStyle(t.muted)
                }
                Spacer(minLength: 20)
                WToggle(on: Binding(
                    get: { launch.isEnabled },
                    set: { launch.setEnabled($0) }
                ))
            }

            Divider().overlay(t.line)

            VStack(alignment: .leading, spacing: 12) {
                Text("Shortcuts")
                    .font(WZFont.ui(13, .semibold)).foregroundStyle(t.text)

                shortcutRow(title: "Dictate", subtitle: "Start/stop dictation anywhere", action: .dictation)
                shortcutRow(title: "Dictate & send", subtitle: "Dictate and submit immediately", action: .dictateAndSend)
                shortcutRow(title: "Command mode", subtitle: "Rewrite clipboard text", action: .command)
                shortcutRow(title: "Record system audio", subtitle: "Dictate from what's playing — meetings, videos", action: .outputRecording)
            }
        }
        .padding(20)
        .frame(width: 380)
        .background(t.bg)
        .environment(\.wz, t)
        .onAppear { launch.refresh() }
    }

    @ViewBuilder
    private func shortcutRow(title: String, subtitle: String, action: MacHotkeyAction) -> some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(WZFont.ui(13, .medium)).foregroundStyle(t.text)
                Text(subtitle)
                    .font(WZFont.ui(11)).foregroundStyle(t.muted)
            }
            Spacer(minLength: 20)
            KeyComboRecorderView(action: action)
        }
    }
}
#endif
