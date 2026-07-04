#if os(macOS)
import SwiftUI
import AVFoundation
import WhisperioKit

// Tabbed macOS Settings window (760-wide, Rezme teal).
//
// This is the native cousin of the iOS `SettingsView`: the `SettGroup`/`SettRow` row grammar and
// the `keyField`/`plainField` inputs are ported here, but rebuilt UIKit-free — no `keyboardType`,
// no `textInputAutocapitalization`, no `presentationDetents`; the cloud-consent flow uses a plain
// `.sheet`, and BYO keys round-trip through the Keychain via `MacSettingsStore`.
//
// It binds to the SAME shared domain the iOS app writes: the `WhisperioSettings` blob under
// `UserDefaults["whisperio.settings.v1"]` plus the `Keychain` items for the OpenAI / ElevenLabs
// keys — so config set on the Mac and the phone stay in one place. The whole tree runs on the
// teal `WZTheme.rezme`, matching `ContentView`.

// MARK: - Settings store (mac)

// Persisted settings for the Mac, mirroring the iOS `SettingsStore` persistence contract exactly:
// the plaintext blob in UserDefaults never carries a secret (scrubbed on every write), while the
// OpenAI / ElevenLabs keys live in the Keychain and are hydrated back on load. Reusing the same
// UserDefaults key + Keychain items means the Mac and iOS app read/write one shared config.
@available(macOS 14, *)
@MainActor
final class MacSettingsStore: ObservableObject {
    @Published var settings: WhisperioSettings { didSet { save() } }

    private static let key = "whisperio.settings.v1"

    init() {
        var loaded = WhisperioSettings()
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let decoded = try? JSONDecoder().decode(WhisperioSettings.self, from: data) {
            loaded = decoded
        }
        // Secrets live in the Keychain, not the blob. Prefer the Keychain copy; fall back to any
        // legacy plaintext key still embedded in the blob so a stored key is never lost.
        let legacyOpenAI = loaded.openAIKey
        let legacyEleven = loaded.elevenLabsKey
        loaded.openAIKey = Keychain.get(.openAIKey) ?? legacyOpenAI
        loaded.elevenLabsKey = Keychain.get(.elevenLabsKey) ?? legacyEleven
        settings = loaded

        // Property observers don't fire in init — migrate + scrub explicitly if the persisted
        // blob still carried a plaintext secret.
        if !legacyOpenAI.isEmpty || !legacyEleven.isEmpty { save() }
    }

    private func save() {
        // Secrets go to the Keychain only; the UserDefaults blob is written with the key fields
        // blanked so no API secret ever lands in plaintext.
        Keychain.set(settings.openAIKey, for: .openAIKey)
        Keychain.set(settings.elevenLabsKey, for: .elevenLabsKey)
        var sanitized = settings
        sanitized.openAIKey = ""
        sanitized.elevenLabsKey = ""
        if let data = try? JSONEncoder().encode(sanitized) {
            UserDefaults.standard.set(data, forKey: Self.key)
        }
    }

    // The primary (tier-1) engine — the head of the chain.
    var primary: ProviderID { settings.providerChain.first ?? .onDevice }

    func bind(_ keyPath: WritableKeyPath<WhisperioSettings, String>) -> Binding<String> {
        Binding(get: { self.settings[keyPath: keyPath] },
                set: { self.settings[keyPath: keyPath] = $0 })
    }
    func bind(_ keyPath: WritableKeyPath<WhisperioSettings, Bool>) -> Binding<Bool> {
        Binding(get: { self.settings[keyPath: keyPath] },
                set: { self.settings[keyPath: keyPath] = $0 })
    }
}

// MARK: - Window

@available(macOS 14, *)
struct SettingsWindow: View {
    @StateObject private var store = MacSettingsStore()
    @State private var tab: SettingsTab = .general
    @State private var consentProvider: ProviderID?   // non-nil → consent sheet is up

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Divider().overlay(WZTheme.rezme.lineSoft)
            content
        }
        .frame(width: 760, height: 640)
        .environment(\.wz, .rezme)
        .preferredColorScheme(.dark)
        .tint(WZTheme.rezme.accent)
        .sheet(item: Binding(get: { consentProvider.map { ConsentTarget(id: $0) } },
                             set: { consentProvider = $0?.id })) { target in
            MacCloudConsentSheet(provider: target.id,
                                 onAccept: { grantCloud(target.id) },
                                 onCancel: { consentProvider = nil })
                .environment(\.wz, .rezme)
                .frame(width: 460, height: 420)
        }
    }

    private struct ConsentTarget: Identifiable { let id: ProviderID }

    // MARK: Sidebar (tab rail)

    private var sidebar: some View {
        let t = WZTheme.rezme
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 9) {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(t.gradient)
                    .frame(width: 22, height: 22)
                    .overlay(Image(systemName: "slider.horizontal.3")
                        .font(.system(size: 11, weight: .bold)).foregroundStyle(.white))
                Text("Settings")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(t.text)
            }
            .padding(.horizontal, 14)
            .padding(.top, 16)
            .padding(.bottom, 10)

            ForEach(SettingsTab.allCases) { item in
                tabButton(item)
            }
            Spacer()
        }
        .frame(width: 196)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(t.bg2.ignoresSafeArea())
    }

    private func tabButton(_ item: SettingsTab) -> some View {
        let t = WZTheme.rezme
        let on = tab == item
        return Button { tab = item } label: {
            HStack(spacing: 11) {
                Image(systemName: item.icon)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(on ? t.accent : t.muted)
                    .frame(width: 20)
                Text(item.title)
                    .font(.system(size: 13, weight: on ? .semibold : .medium))
                    .foregroundStyle(on ? t.text : t.muted)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(on ? t.accent.opacity(0.14) : .clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(on ? t.hair : .clear, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 10)
    }

    // MARK: Content

    private var content: some View {
        let t = WZTheme.rezme
        return ScrollView(showsIndicators: true) {
            VStack(alignment: .leading, spacing: 20) {
                switch tab {
                case .general:   GeneralPane(store: store)
                case .providers: ProvidersPane(store: store, requestConsent: { consentProvider = $0 })
                case .audio:     AudioPane(store: store)
                case .hotkeys:   HotkeysPane()
                case .updates:   UpdatesPane()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 28)
            .padding(.vertical, 26)
            .animation(.easeInOut(duration: 0.18), value: store.primary)
        }
        .background(t.bg.ignoresSafeArea())
    }

    private func grantCloud(_ id: ProviderID) {
        var s = store.settings
        s.cloudConsentGranted = true
        s.providerChain = [id]
        store.settings = s
        consentProvider = nil
    }
}

// MARK: - Tabs

@available(macOS 14, *)
enum SettingsTab: String, CaseIterable, Identifiable {
    case general, providers, audio, hotkeys, updates
    var id: String { rawValue }
    var title: String {
        switch self {
        case .general:   return "General"
        case .providers: return "Providers"
        case .audio:     return "Audio"
        case .hotkeys:   return "Hotkeys"
        case .updates:   return "Updates"
        }
    }
    var icon: String {
        switch self {
        case .general:   return "gearshape"
        case .providers: return "cpu"
        case .audio:     return "mic"
        case .hotkeys:   return "keyboard"
        case .updates:   return "arrow.triangle.2.circlepath"
        }
    }
}

// MARK: - General pane

@available(macOS 14, *)
private struct GeneralPane: View {
    @ObservedObject var store: MacSettingsStore
    @Environment(\.wz) private var t

    private let languages: [(name: String, code: String)] = [
        ("Auto-detect", "auto"), ("English", "en"), ("Polski", "pl"), ("Deutsch", "de"),
        ("Español", "es"), ("Français", "fr"), ("Italiano", "it"), ("Português", "pt"),
        ("Nederlands", "nl"), ("Русский", "ru"), ("Українська", "uk")
    ]

    private var currentLanguageName: String {
        languages.first { $0.code == store.settings.language }?.name ?? store.settings.language
    }

    var body: some View {
        paneTitle("General", "Transcription behavior and language.")

        SettGroup(title: "Language & vocabulary") {
            SettRow(icon: "globe", label: "Language", sub: "Spoken language for transcription") {
                Menu {
                    ForEach(languages, id: \.code) { lang in
                        Button(lang.name) {
                            var s = store.settings; s.language = lang.code; store.settings = s
                        }
                    }
                } label: {
                    HStack(spacing: 5) {
                        Text(currentLanguageName).font(.system(size: 12.5)).foregroundStyle(t.accentLite)
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(t.faint)
                    }
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
            }
            SettRow(icon: "text.word.spacing", label: "Custom words",
                    sub: "Comma-separated — helps spell names, brands & jargon", last: true) {
                EmptyView()
            }
        }
        vocabField

        SettGroup(title: "Transcription") {
            toggleRow("waveform", "Live transcription",
                      "See text as you speak · on-device, free", store.bind(\.liveTranscriptionEnabled))
            toggleRow("network", "Apple online speech",
                      "Use Apple's servers when on-device isn't available · audio leaves the device",
                      store.bind(\.appleAllowOnline))
            toggleRow("sparkles", "Cleanup",
                      "Tidy punctuation, casing & spacing", store.bind(\.cleanupEnabled))
            toggleRow("cloud", "Fallback engines",
                      "If the chosen engine fails, try the others", store.bind(\.fallbackEnabled), last: true)
        }

        Text("Whisperio \(appVersion) · macOS")
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(t.faint)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 4)
    }

    private var vocabField: some View {
        VStack(alignment: .leading, spacing: 7) {
            TextField("git, GitHub, Next.js, kubectl…", text: store.bind(\.customVocabulary), axis: .vertical)
                .lineLimit(2...4)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .font(.system(size: 13))
                .foregroundStyle(t.text)
                .padding(.horizontal, 11).padding(.vertical, 9)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }
}

// MARK: - Providers pane

@available(macOS 14, *)
private struct ProvidersPane: View {
    @ObservedObject var store: MacSettingsStore
    var requestConsent: (ProviderID) -> Void
    @Environment(\.wz) private var t

    private var engine: ProviderID { store.primary }

    var body: some View {
        paneTitle("Providers", "Choose the transcription engine chain and add your keys.")

        VStack(alignment: .leading, spacing: 9) {
            sectionLabel("Provider chain")
            Text(chainText)
                .font(.system(size: 11.5, design: .monospaced))
                .foregroundStyle(t.faint)
                .padding(.leading, 2)
            VStack(spacing: 10) {
                engineRow(.onDevice, "Apple — on-device", "Free · private · offline", "cpu")
                engineRow(.openAI, "OpenAI", "Cloud · Whisper API", "sparkles")
                engineRow(.elevenLabs, "ElevenLabs", "Cloud · Scribe", "waveform.circle")
            }
        }

        if engine == .openAI {
            keyField("OpenAI API key", store.bind(\.openAIKey))
            plainField("Base URL (optional, self-hosted)", "https://api.openai.com/v1", store.bind(\.openAIBaseURL))
            plainField("Model (optional)", "whisper-1", store.bind(\.whisperModel))
        }
        if engine == .elevenLabs {
            keyField("ElevenLabs API key", store.bind(\.elevenLabsKey))
        }

        SettGroup(title: "Text model (rewrite & journaling)") {
            SettRow(icon: "text.badge.star", label: "Chat model",
                    sub: "OpenAI chat model for rewrite presets & daily summaries", last: true) {
                EmptyView()
            }
        }
        plainField("Chat model", "gpt-4o-mini", store.bind(\.chatModel))
    }

    private var chainText: String {
        let primary = engine
        var order: [ProviderID] = [primary]
        if store.settings.fallbackEnabled {
            for id in [ProviderID.onDevice, .openAI, .elevenLabs] where id != primary { order.append(id) }
        }
        if !store.settings.cloudConsentGranted { order.removeAll { store.settings.isCloud($0) } }
        if order.isEmpty { order = [.onDevice] }
        return order.map { ProviderName.short($0) }.joined(separator: "  →  ")
    }

    private func engineRow(_ id: ProviderID, _ title: String, _ sub: String, _ icon: String) -> some View {
        let on = engine == id
        let cloud = store.settings.isCloud(id)
        let needsConsent = cloud && !store.settings.cloudConsentGranted
        return Button {
            if needsConsent { requestConsent(id) }
            else { var s = store.settings; s.providerChain = [id]; store.settings = s }
        } label: {
            HStack(spacing: 13) {
                Image(systemName: icon).font(.system(size: 15))
                    .foregroundStyle(on ? t.accent : t.muted)
                    .frame(width: 38, height: 38)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(t.text)
                    Text(sub).font(.system(size: 11, design: .monospaced)).foregroundStyle(t.faint)
                }
                Spacer(minLength: 0)
                if needsConsent {
                    Image(systemName: "lock.fill").font(.system(size: 12)).foregroundStyle(t.amber)
                }
                if on { Image(systemName: "checkmark").font(.system(size: 14, weight: .bold)).foregroundStyle(t.accent) }
            }
            .padding(13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous)
                .stroke(on ? t.accent : t.line, lineWidth: on ? 2 : 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func keyField(_ label: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            sectionLabel(label)
            SecureField("paste key…", text: text)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(t.text)
                .padding(.horizontal, 13).padding(.vertical, 12)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }

    private func plainField(_ label: String, _ placeholder: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            sectionLabel(label)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(t.text)
                .padding(.horizontal, 13).padding(.vertical, 12)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }
}

// MARK: - Audio pane

@available(macOS 14, *)
private struct AudioPane: View {
    @ObservedObject var store: MacSettingsStore
    @Environment(\.wz) private var t
    @AppStorage("whisperio.mac.inputDevice") private var inputDeviceID = ""
    @State private var devices: [AVCaptureDevice] = []

    private var selectedName: String {
        if inputDeviceID.isEmpty { return "System default" }
        return devices.first { $0.uniqueID == inputDeviceID }?.localizedName ?? "System default"
    }

    var body: some View {
        paneTitle("Audio", "Microphone input and recording storage.")

        SettGroup(title: "Input") {
            SettRow(icon: "mic", label: "Input device",
                    sub: "Microphone used for dictation", last: true) {
                Menu {
                    Button("System default") { inputDeviceID = "" }
                    if !devices.isEmpty { Divider() }
                    ForEach(devices, id: \.uniqueID) { dev in
                        Button(dev.localizedName) { inputDeviceID = dev.uniqueID }
                    }
                } label: {
                    HStack(spacing: 5) {
                        Text(selectedName).font(.system(size: 12.5)).foregroundStyle(t.accentLite).lineLimit(1)
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(t.faint)
                    }
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
            }
        }

        SettGroup(title: "Recordings") {
            toggleRow("waveform.badge.plus", "Save recordings",
                      "Keep the audio clip alongside each transcript", store.bind(\.saveRecordings), last: true)
        }

        Text("Microphone access is requested the first time you dictate.")
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(t.faint)
            .onAppear(perform: loadDevices)
    }

    private func loadDevices() {
        let types: [AVCaptureDevice.DeviceType] = [.microphone, .external]
        devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: types, mediaType: .audio, position: .unspecified
        ).devices
    }
}

// MARK: - Hotkeys pane (display only for now)

@available(macOS 14, *)
private struct HotkeysPane: View {
    @Environment(\.wz) private var t

    private let rows: [(icon: String, label: String, sub: String, keys: String)] = [
        ("mic.fill", "Toggle dictation", "Start / stop recording from anywhere", "⌃ ⇧ Space"),
        ("xmark.circle", "Cancel dictation", "Discard the in-progress recording", "esc"),
        ("sparkles", "Rewrite last", "Re-run the active preset on the last transcript", "⌃ ⇧ R"),
    ]

    var body: some View {
        paneTitle("Hotkeys", "Global shortcuts that trigger dictation from any app.")

        SettGroup(title: "Global shortcuts") {
            ForEach(Array(rows.enumerated()), id: \.offset) { idx, r in
                SettRow(icon: r.icon, label: r.label, sub: r.sub, last: idx == rows.count - 1) {
                    keyCap(r.keys)
                }
            }
        }

        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "info.circle").font(.system(size: 12)).foregroundStyle(t.accentLite).padding(.top, 1)
            Text("Rebinding lands with the global-hotkey engine. These defaults are shown for reference.")
                .font(.system(size: 12)).foregroundStyle(t.muted).lineSpacing(3)
            Spacer()
        }
        .padding(14)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    private func keyCap(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold, design: .monospaced))
            .foregroundStyle(t.accentLite)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).stroke(t.hair, lineWidth: 1))
    }
}

// MARK: - Updates pane

@available(macOS 14, *)
private struct UpdatesPane: View {
    @Environment(\.wz) private var t
    @AppStorage("whisperio.mac.autoUpdate") private var autoUpdate = true
    @State private var status = ""

    var body: some View {
        paneTitle("Updates", "Keep Whisperio current.")

        SettGroup(title: "Software updates") {
            SettRow(icon: "app.badge", label: "Current version",
                    sub: "The build you're running now") {
                Text("\(appVersion) (\(buildVersion))")
                    .font(.system(size: 12.5, design: .monospaced)).foregroundStyle(t.accentLite)
            }
            HStack(spacing: 13) {
                Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 16))
                    .foregroundStyle(t.accentLite).frame(width: 34, height: 34)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text("Automatically check for updates").font(.system(size: 14, weight: .medium)).foregroundStyle(t.text)
                    Text("Check for new versions in the background").font(.system(size: 12)).foregroundStyle(t.muted)
                }
                Spacer(minLength: 0)
                Toggle("", isOn: $autoUpdate).labelsHidden().toggleStyle(.switch).tint(t.accent)
            }
            .padding(.vertical, 13)
        }

        HStack(spacing: 12) {
            Button {
                status = "You're up to date."
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: "arrow.down.circle").font(.system(size: 13, weight: .semibold))
                    Text("Check for updates").font(.system(size: 13, weight: .semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(t.gradient, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            }
            .buttonStyle(.plain)
            if !status.isEmpty {
                Text(status).font(.system(size: 12)).foregroundStyle(t.muted)
            }
            Spacer()
        }

        Text("Automatic updating (Sparkle) is wired once the app ships outside the App Store.")
            .font(.system(size: 11, design: .monospaced)).foregroundStyle(t.faint)
    }
}

// MARK: - Cloud consent sheet (mac)

@available(macOS 14, *)
private struct MacCloudConsentSheet: View {
    @Environment(\.wz) private var t
    let provider: ProviderID
    var onAccept: () -> Void
    var onCancel: () -> Void

    private var name: String { provider == .openAI ? "OpenAI" : "ElevenLabs" }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Label("CLOUD", systemImage: "cloud")
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(t.amber)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Capsule().fill(t.amber.opacity(0.14)))
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(t.muted).frame(width: 28, height: 28)
                        .background(t.surfaceUp, in: Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(.bottom, 16)

            Image(systemName: "cloud.fill").font(.system(size: 22)).foregroundStyle(.white)
                .frame(width: 50, height: 50)
                .background(t.amber.opacity(0.9), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.bottom, 14)

            Text("Turn on cloud transcription?")
                .font(.system(size: 19, weight: .semibold, design: .rounded))
                .foregroundStyle(t.text).padding(.bottom, 9)

            Text("To use \(name), your audio will leave this Mac and be sent to \(name)'s servers to be transcribed. That's the only way a cloud engine can work.")
                .font(.system(size: 13.5)).foregroundStyle(t.muted).lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true).padding(.bottom, 18)

            bullet("lock", "Prefer privacy? Apple's on-device engine is free, works offline, and never uploads anything.")
            bullet("shield", "You can switch back to on-device any time. Your saved transcripts stay on this Mac.")

            Spacer(minLength: 18)

            Button(action: onAccept) {
                HStack(spacing: 7) {
                    Image(systemName: "cloud").font(.system(size: 13, weight: .semibold))
                    Text("I understand — enable \(name)").font(.system(size: 13.5, weight: .semibold))
                }
                .foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 12)
                .background(t.gradient, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(.bottom, 8)

            Button(action: onCancel) {
                Text("Keep audio on-device").font(.system(size: 13, weight: .medium))
                    .foregroundStyle(t.muted).frame(maxWidth: .infinity).padding(.vertical, 11)
                    .background(t.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
        .padding(22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(t.bg.ignoresSafeArea())
    }

    private func bullet(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).font(.system(size: 13)).foregroundStyle(t.accentLite).padding(.top, 1)
            Text(text).font(.system(size: 12.5)).foregroundStyle(t.muted).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.bottom, 9)
    }
}

// MARK: - Reusable row grammar (mac port of SettGroup / SettRow)

@available(macOS 14, *)
private struct SettGroup<Content: View>: View {
    @Environment(\.wz) private var t
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel(title)
            VStack(spacing: 0) { content }
                .padding(.horizontal, 16)
                .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }
}

@available(macOS 14, *)
private struct SettRow<Right: View>: View {
    @Environment(\.wz) private var t
    let icon: String
    let label: String
    var sub: String? = nil
    var last = false
    @ViewBuilder var right: Right

    var body: some View {
        HStack(spacing: 13) {
            Image(systemName: icon).font(.system(size: 15, weight: .regular)).foregroundStyle(t.accentLite)
                .frame(width: 32, height: 32)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.system(size: 14, weight: .medium)).foregroundStyle(t.text)
                if let sub {
                    Text(sub).font(.system(size: 12)).foregroundStyle(t.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            right
        }
        .padding(.vertical, 13)
        .overlay(alignment: .bottom) {
            if !last { Rectangle().fill(t.lineSoft).frame(height: 1) }
        }
    }
}

@available(macOS 14, *)
private func toggleRow(_ icon: String, _ label: String, _ sub: String,
                       _ on: Binding<Bool>, last: Bool = false) -> some View {
    SettRow(icon: icon, label: label, sub: sub, last: last) {
        Toggle("", isOn: on).labelsHidden().toggleStyle(.switch).tint(WZTheme.rezme.accent)
    }
}

// MARK: - Small shared bits

@available(macOS 14, *)
private func sectionLabel(_ text: String) -> some View {
    Text(text.uppercased())
        .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
        .tracking(1.0)
        .foregroundStyle(WZTheme.rezme.muted)
        .padding(.leading, 2)
}

@available(macOS 14, *)
@ViewBuilder
private func paneTitle(_ title: String, _ subtitle: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(title)
            .font(.system(size: 22, weight: .semibold, design: .rounded))
            .foregroundStyle(WZTheme.rezme.text)
        Text(subtitle)
            .font(.system(size: 13))
            .foregroundStyle(WZTheme.rezme.muted)
    }
    .padding(.bottom, 2)
}

private enum ProviderName {
    static func short(_ id: ProviderID) -> String {
        switch id {
        case .onDevice:   return "On-device"
        case .openAI:     return "OpenAI"
        case .elevenLabs: return "ElevenLabs"
        }
    }
}

private var appVersion: String {
    Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
}
private var buildVersion: String {
    Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
}
#endif
