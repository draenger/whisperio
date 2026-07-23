#if os(macOS)
import SwiftUI
import WhisperioKit

// Native port of the design's wz-shell.jsx settings window (wz-shell-SPEC.md) + the
// General/Hotkeys/Updates tab content of wz-tabs.jsx (Providers/Audio/Recordings live in
// MacApp/MacSettingsTabs2.swift, built by a peer agent against `MacProvidersTab` /
// `MacAudioTab` / `MacRecordingsTab`). Replaces the old minimal `MacGeneralSettingsView`
// (LaunchAtLogin.swift) as the app's Settings (⌘,) scene content.

enum MacSettingsTab: String, CaseIterable, Identifiable {
    case general, providers, audio, hotkeys, updates, recordings
    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: return "General"
        case .providers: return "Providers"
        case .audio: return "Audio"
        case .hotkeys: return "Hotkeys"
        case .updates: return "Updates"
        case .recordings: return "Recordings"
        }
    }

    // SF Symbol nearest each wz-data IC.* glyph (general/providers/audio/hotkeys/updates/recordings).
    var systemImage: String {
        switch self {
        case .general: return "slider.horizontal.3"
        case .providers: return "cpu"
        case .audio: return "waveform"
        case .hotkeys: return "keyboard"
        case .updates: return "arrow.triangle.2.circlepath"
        case .recordings: return "folder"
        }
    }
}

// ~760×780 (wz-shell-SPEC.md "Window"), sidebar 198, StatusHeader strip, autosave footnote —
// SPEC's Electron chrome (traffic lights / titlebar) is skipped since AppKit's native Settings
// window already draws its own title bar; everything from the StatusHeader down is 1:1.
struct MacSettingsShell: View {
    @Environment(\.wz) private var envTheme
    @AppStorage("wz.split.dark") private var splitDark = true
    @EnvironmentObject private var settings: SettingsStore
    @State private var tab: MacSettingsTab = .general
    @State private var savedPulse = false

    private var t: WZTheme { .of(splitDark) }

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Divider().overlay(t.line)
            VStack(spacing: 0) {
                statusHeader
                Divider().overlay(t.line)
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        content
                    }
                    .padding(24)
                }
                Divider().overlay(t.line)
                autosaveFooter
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(minWidth: 760, minHeight: 780)
        .background(t.bg)
        .environment(\.wz, t)
        .preferredColorScheme(splitDark ? .dark : .light)
        .onChange(of: settings.settings) { _, _ in pulseSaved() }
    }

    private func pulseSaved() {
        withAnimation(.easeOut(duration: 0.15)) { savedPulse = true }
        Task {
            try? await Task.sleep(nanoseconds: 1_400_000_000)
            withAnimation(.easeOut(duration: 0.3)) { savedPulse = false }
        }
    }

    // MARK: - Sidebar

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("SETTINGS")
                .font(WZFont.mono(10.5, .semibold))
                .foregroundStyle(t.faint)
                .tracking(1.4)
                .padding(.horizontal, 16)
                .padding(.top, 18)
                .padding(.bottom, 10)

            VStack(spacing: 2) {
                ForEach(MacSettingsTab.allCases) { item in
                    tabRow(item)
                }
            }
            .padding(.horizontal, 10)

            Spacer()

            HStack(spacing: 6) {
                Circle().fill(t.green).frame(width: 6, height: 6)
                Text("v\(appVersion) (\(appBuild))")
                    .font(WZFont.mono(10.5))
                    .foregroundStyle(t.muted)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .frame(width: 198)
        .background(t.bg2)
    }

    private func tabRow(_ item: MacSettingsTab) -> some View {
        let active = tab == item
        return Button {
            tab = item
        } label: {
            HStack(spacing: 9) {
                Rectangle()
                    .fill(active ? t.accent : .clear)
                    .frame(width: 3)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
                    .padding(.vertical, 7)
                Image(systemName: item.systemImage)
                    .font(.system(size: 13, weight: .medium))
                    .frame(width: 16)
                Text(item.title)
                    .font(WZFont.ui(13.5, .semibold))
                Spacer(minLength: 0)
            }
            .foregroundStyle(active ? t.accentLite : t.muted)
            .padding(.vertical, 9)
            .padding(.horizontal, 8)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(active ? t.accent.opacity(t.dark ? 0.13 : 0.10) : .clear)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - StatusHeader

    private var statusHeader: some View {
        HStack(spacing: 0) {
            statusItem(label: "STATUS") {
                HStack(spacing: 6) {
                    Circle().fill(t.green).frame(width: 7, height: 7)
                        .shadow(color: t.green.opacity(0.6), radius: 3)
                    Text("Ready").font(WZFont.ui(13, .semibold)).foregroundStyle(t.text)
                }
            }
            divider
            statusItem(label: "DICTATE") { keycaps(dictationDisplay) }
            divider
            statusItem(label: "ENGINE CHAIN") {
                engineChainLabel
            }
            Spacer(minLength: 12)
            if settings.settings.cleanupEnabled {
                HStack(spacing: 6) {
                    Image(systemName: "bolt.fill").font(.system(size: 13)).foregroundStyle(t.accentLite)
                    Text("AI cleanup").font(WZFont.ui(11.5)).foregroundStyle(t.muted)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 11)
        .background(t.bg2)
    }

    private var divider: some View {
        Rectangle().fill(t.line).frame(width: 1, height: 26).padding(.horizontal, 16)
    }

    private func statusItem<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(WZFont.mono(9.5, .semibold))
                .tracking(1.2)
                .foregroundStyle(t.faint)
            content()
        }
    }

    private var dictationDisplay: String {
        HotkeyCenter.shared.combo(for: .dictation)?.display ?? "Not set"
    }

    private func keycaps(_ combo: String) -> some View {
        HStack(spacing: 3) {
            ForEach(splitKeycaps(combo), id: \.self) { part in
                Text(part)
                    .font(WZFont.mono(11, .semibold))
                    .foregroundStyle(t.text)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(t.elevated, in: RoundedRectangle(cornerRadius: 4))
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(t.line, lineWidth: 1))
            }
        }
    }

    // Splits a display string like "⌃⇧Space" (symbol-glyph modifiers, no separators) or
    // "Ctrl+Shift+Space" (plus-joined) into individual keycap chips.
    private func splitKeycaps(_ combo: String) -> [String] {
        if combo.contains("+") {
            return combo.split(separator: "+").map(String.init)
        }
        let symbolMods: Set<Character> = ["⌃", "⌥", "⇧", "⌘"]
        var parts: [String] = []
        var rest = Substring(combo)
        while let first = rest.first, symbolMods.contains(first) {
            parts.append(String(first))
            rest.removeFirst()
        }
        if !rest.isEmpty { parts.append(String(rest)) }
        return parts.isEmpty ? [combo] : parts
    }

    private var engineChainLabel: some View {
        let chain = settings.settings.providerChain
        return HStack(spacing: 4) {
            ForEach(Array(chain.enumerated()), id: \.offset) { idx, provider in
                Text(provider.displayName)
                    .font(WZFont.ui(13, idx == 0 ? .semibold : .regular))
                    .foregroundStyle(idx == 0 ? t.accentLite : t.muted)
                if idx < chain.count - 1 {
                    Text("→").font(WZFont.ui(13)).foregroundStyle(t.faint)
                }
            }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch tab {
        case .general: MacGeneralTab()
        case .providers: MacProvidersTab()
        case .audio: MacAudioTab()
        case .hotkeys: MacHotkeysTab()
        case .updates: MacUpdatesTab()
        case .recordings: MacRecordingsTab()
        }
    }

    // MARK: - Autosave footer

    private var autosaveFooter: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(savedPulse ? t.green : t.accentLite)
            Text(savedPulse ? "Saved" : "Changes save automatically")
                .font(WZFont.ui(12.5))
                .foregroundStyle(savedPulse ? t.green : t.muted)
            Spacer()
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .background(t.bg2)
    }

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }
    private var appBuild: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
    }
}

// MARK: - Section (shared card chrome across tabs — port of wz-tabs.jsx's <Section>)

struct MacSettingsSection<Content: View>: View {
    @Environment(\.wz) private var t
    let title: String
    var hint: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(WZFont.ui(13, .semibold))
                .foregroundStyle(t.text)
            VStack(alignment: .leading, spacing: 10) {
                content
            }
            .padding(14)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(t.line, lineWidth: 1))
            if let hint {
                Text(hint)
                    .font(WZFont.ui(11.5))
                    .foregroundStyle(t.muted)
            }
        }
    }
}

struct MacToggleRow: View {
    @Environment(\.wz) private var t
    let label: String
    let description: String
    @Binding var checked: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(WZFont.ui(14, .medium)).foregroundStyle(t.text)
                Text(description).font(WZFont.ui(12.5)).foregroundStyle(t.muted)
            }
            Spacer(minLength: 20)
            WToggle(on: $checked)
        }
    }
}

// MARK: - General tab (wz-tabs.jsx GeneralTab — Startup + Appearance sections)

struct MacGeneralTab: View {
    @Environment(\.wz) private var envTheme
    @AppStorage("wz.split.dark") private var splitDark = true
    @ObservedObject private var launch = LaunchAtLoginController.shared
    private var t: WZTheme { .of(splitDark) }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            MacSettingsSection(title: "Startup") {
                MacToggleRow(
                    label: "Launch at login",
                    description: "Automatically start Whisperio when you log in",
                    checked: Binding(get: { launch.isEnabled }, set: { launch.setEnabled($0) })
                )
            }

            MacSettingsSection(title: "Appearance") {
                MacToggleRow(
                    label: "Dark theme",
                    description: splitDark ? "Currently using dark theme" : "Currently using light theme",
                    checked: $splitDark
                )
            }
        }
        .environment(\.wz, t)
        .onAppear { launch.refresh() }
    }
}

// MARK: - Hotkeys tab (wz-tabs.jsx HotkeysTab — "Keyboard Shortcuts" card, keycap chips +
// Record/Clear via the existing KeyComboRecorderView, which already has this visual language).

struct MacHotkeysTab: View {
    @Environment(\.wz) private var t

    var body: some View {
        MacSettingsSection(title: "Keyboard Shortcuts") {
            hotkeyRow(title: "Dictation Hotkey", subtitle: "Start/stop dictation anywhere", action: .dictation, first: true)
            Divider().overlay(t.line)
            hotkeyRow(title: "Dictate & Send Hotkey", subtitle: "Dictate and submit immediately", action: .dictateAndSend, first: false)
            Divider().overlay(t.line)
            hotkeyRow(title: "Command Mode Hotkey", subtitle: "Rewrite clipboard text", action: .command, first: false)
            Divider().overlay(t.line)
            hotkeyRow(title: "Output Recording Hotkey", subtitle: "Dictate from what's playing — meetings, videos", action: .outputRecording, first: false)

            Text("Click Record to capture a hotkey. Press and release keys to set. Esc cancels.")
                .font(WZFont.ui(11.5))
                .foregroundStyle(t.muted)
                .padding(.top, 4)
        }
    }

    @ViewBuilder
    private func hotkeyRow(title: String, subtitle: String, action: MacHotkeyAction, first: Bool) -> some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(WZFont.ui(14, .medium)).foregroundStyle(t.text)
                Text(subtitle).font(WZFont.ui(11.5)).foregroundStyle(t.muted)
            }
            Spacer(minLength: 20)
            KeyComboRecorderView(action: action)
        }
        .padding(.top, first ? 0 : 2)
    }
}

// MARK: - Updates tab (wz-tabs.jsx UpdatesTab — native app ships via TestFlight, no Sparkle)

struct MacUpdatesTab: View {
    @Environment(\.wz) private var t

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }
    private var appBuild: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            MacSettingsSection(title: "Software Updates") {
                HStack(alignment: .top, spacing: 12) {
                    Circle().fill(t.green).frame(width: 10, height: 10)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("You're up to date")
                            .font(WZFont.ui(14, .semibold)).foregroundStyle(t.text)
                        Text("Whisperio updates are delivered through TestFlight.")
                            .font(WZFont.ui(12.5)).foregroundStyle(t.muted)
                    }
                    Spacer()
                }
                Divider().overlay(t.line).padding(.vertical, 2)
                HStack {
                    Text("Installed version").font(WZFont.ui(12.5)).foregroundStyle(t.muted)
                    Spacer()
                    Text("v\(appVersion) (\(appBuild))").font(WZFont.ui(12.5, .medium)).foregroundStyle(t.text)
                }
            }

            MacSettingsSection(title: "How updates work") {
                Text("Whisperio is distributed through TestFlight. Open the TestFlight app to check for and install new builds — the app itself doesn't check for or download updates.")
                    .font(WZFont.ui(11.5))
                    .foregroundStyle(t.muted)
            }
        }
    }
}
#endif
