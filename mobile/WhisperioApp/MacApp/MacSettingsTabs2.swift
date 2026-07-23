#if os(macOS)
import SwiftUI
import AppKit
import AVFoundation
import WhisperioKit

// Native port of wz-tabs.jsx's Providers/Audio/Recordings tab content — the three tabs
// MacSettingsShell (peer-owned) references. Wired to the SAME real SettingsStore fields the
// iOS SettingsView already uses (see SettingsView.swift's modelCategory/transcriptionCategory/
// contentCategory) — no new storage invented, just a Mac-styled presentation of it.

// MARK: - Providers tab (wz-tabs.jsx ProvidersTab)

struct MacProvidersTab: View {
    @AppStorage("wz.split.dark") private var splitDark = true
    @EnvironmentObject private var settings: SettingsStore
    @State private var expanded: ProviderID?

    private var t: WZTheme { .of(splitDark) }
    private var chain: [ProviderID] { settings.settings.providerChain }
    private var available: [ProviderID] { ProviderID.allCases.filter { !chain.contains($0) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            MacSettingsSection(
                title: "Provider Chain",
                hint: "First = primary. If it fails, the next one kicks in. Reorder with the arrows."
            ) {
                ForEach(Array(chain.enumerated()), id: \.element) { idx, id in
                    chainRow(id, idx)
                    if idx < chain.count - 1 || !available.isEmpty {
                        Divider().overlay(t.line)
                    }
                }
                if !available.isEmpty {
                    Menu {
                        ForEach(available, id: \.self) { id in
                            Button(id.displayName) { addToChain(id) }
                        }
                    } label: {
                        Label("Add provider", systemImage: "plus.circle")
                            .font(WZFont.ui(12.5, .medium))
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                }
            }

            if let open = expanded {
                MacSettingsSection(title: "\(open.displayName) configuration") {
                    providerConfig(open)
                }
            }

            MacSettingsSection(title: "Transcription Language") {
                HStack(alignment: .top, spacing: 14) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Language").font(WZFont.ui(14, .medium)).foregroundStyle(t.text)
                        Text("\"auto\" detects the spoken language; an ISO code (e.g. \"en\", \"pl\") pins it.")
                            .font(WZFont.ui(11.5)).foregroundStyle(t.muted)
                    }
                    Spacer(minLength: 20)
                    TextField("auto", text: languageBinding)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 120)
                }
            }

            MacSettingsSection(
                title: "Custom Vocabulary",
                hint: "Comma-separated terms — names, jargon, acronyms — passed to engines that support a vocabulary hint (also used as the OpenAI transcription prompt)."
            ) {
                TextEditor(text: vocabularyBinding)
                    .font(WZFont.mono(12.5))
                    .frame(minHeight: 70)
                    .padding(6)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(t.line, lineWidth: 1))
                MacToggleRow(
                    label: "AI cleanup",
                    description: "Tidy punctuation, casing & spacing after transcription",
                    checked: boolBinding(\.cleanupEnabled)
                )
                MacToggleRow(
                    label: "Fallback engines",
                    description: "If the primary engine fails, walk down the chain above",
                    checked: boolBinding(\.fallbackEnabled)
                )
            }
        }
        .environment(\.wz, t)
    }

    @ViewBuilder
    private func chainRow(_ id: ProviderID, _ idx: Int) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(id.displayName).font(WZFont.ui(14, idx == 0 ? .semibold : .medium))
                        .foregroundStyle(idx == 0 ? t.accentLite : t.text)
                    if idx == 0 {
                        Text("PRIMARY")
                            .font(WZFont.mono(9, .semibold)).tracking(0.8)
                            .foregroundStyle(t.accentLite)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(t.accent.opacity(0.15), in: Capsule())
                    }
                }
                Text(statusLine(id)).font(WZFont.mono(10.5)).foregroundStyle(t.faint)
            }
            Spacer(minLength: 8)
            Button { move(id, -1) } label: { Image(systemName: "chevron.up") }
                .buttonStyle(.borderless).disabled(idx == 0)
            Button { move(id, 1) } label: { Image(systemName: "chevron.down") }
                .buttonStyle(.borderless).disabled(idx == chain.count - 1)
            Button { toggleExpand(id) } label: {
                Image(systemName: expanded == id ? "chevron.up.circle" : "gearshape")
            }.buttonStyle(.borderless)
            if chain.count > 1 {
                Button { removeFromChain(id) } label: { Image(systemName: "minus.circle") }
                    .buttonStyle(.borderless).foregroundStyle(t.red)
            }
        }
        .padding(.vertical, 4)
    }

    private func statusLine(_ id: ProviderID) -> String {
        switch id {
        case .onDevice: return "Built-in · ready"
        case .localWhisper: return settings.isEngineReady(.localWhisper) ? "Downloaded" : "Not downloaded"
        case .selfHosted:
            let url = settings.settings.selfHostedURL.trimmingCharacters(in: .whitespaces)
            return url.isEmpty ? "Add your server URL" : "Connected · \(url)"
        default:
            let key = key(for: id)
            return key.trimmingCharacters(in: .whitespaces).isEmpty ? "Add API key to connect" : "Connected"
        }
    }

    private func key(for id: ProviderID) -> String {
        switch id {
        case .openAI: return settings.settings.openAIKey
        case .elevenLabs: return settings.settings.elevenLabsKey
        case .groq: return settings.settings.groqKey
        case .deepgram: return settings.settings.deepgramKey
        case .assemblyAI: return settings.settings.assemblyAIKey
        case .mistral: return settings.settings.mistralKey
        case .replicate: return settings.settings.replicateKey
        default: return ""
        }
    }

    @ViewBuilder
    private func providerConfig(_ id: ProviderID) -> some View {
        switch id {
        case .openAI:
            secureField("API Key", binding(\.openAIKey), placeholder: "sk-…")
            plainField("Base URL (optional)", binding(\.openAIBaseURL), placeholder: "https://api.openai.com/v1")
            plainField("Model (optional)", binding(\.whisperModel), placeholder: "whisper-1")
        case .elevenLabs:
            secureField("API Key", binding(\.elevenLabsKey), placeholder: "xi-…")
            plainField("Model (optional)", binding(\.elevenLabsModel), placeholder: "scribe_v2")
        case .groq:
            secureField("API Key", binding(\.groqKey), placeholder: "gsk_…")
            plainField("Model (optional)", binding(\.groqModel), placeholder: "whisper-large-v3-turbo")
        case .deepgram:
            secureField("API Key", binding(\.deepgramKey), placeholder: "dg_…")
            plainField("Model (optional)", binding(\.deepgramModel), placeholder: "nova-3")
        case .assemblyAI:
            secureField("API Key", binding(\.assemblyAIKey), placeholder: "aai_…")
            plainField("Model (optional)", binding(\.assemblyAIModel), placeholder: "universal-2")
        case .mistral:
            secureField("API Key", binding(\.mistralKey), placeholder: "api key…")
            plainField("Model (optional)", binding(\.mistralModel), placeholder: "voxtral-small")
        case .replicate:
            secureField("API Token", binding(\.replicateKey), placeholder: "r8_…")
            plainField("Model (optional)", binding(\.replicateModel), placeholder: "openai/whisper")
        case .selfHosted:
            plainField("Server URL", binding(\.selfHostedURL), placeholder: "http://localhost:8080/v1")
            secureField("Bearer token (optional)", binding(\.selfHostedKey), placeholder: "leave blank if none")
            plainField("Model", binding(\.selfHostedModel), placeholder: "whisper-large-v3")
        case .onDevice:
            Text("Apple's on-device Speech framework — no configuration, no key, audio never leaves this Mac.")
                .font(WZFont.ui(12.5)).foregroundStyle(t.muted)
        case .localWhisper:
            plainField("Model variant", binding(\.localWhisperModel), placeholder: "openai_whisper-base")
            Text("Manage downloads from the main window's Models screen.")
                .font(WZFont.ui(11.5)).foregroundStyle(t.faint)
        }
    }

    private func secureField(_ label: String, _ text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(WZFont.ui(12, .medium)).foregroundStyle(t.muted)
            SecureField(placeholder, text: text).textFieldStyle(.roundedBorder)
        }
    }
    private func plainField(_ label: String, _ text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(WZFont.ui(12, .medium)).foregroundStyle(t.muted)
            TextField(placeholder, text: text).textFieldStyle(.roundedBorder)
        }
    }

    // MARK: - Chain mutation (operates on the real modelOrder — providerChain's setter only
    // moves a primary, so reorder/add/remove go straight at the slot array).

    private func toggleExpand(_ id: ProviderID) { expanded = expanded == id ? nil : id }

    private func move(_ id: ProviderID, _ dir: Int) {
        var s = settings.settings
        guard let i = s.modelOrder.firstIndex(where: { $0.provider == id }) else { return }
        let j = i + dir
        guard j >= 0, j < s.modelOrder.count else { return }
        s.modelOrder.swapAt(i, j)
        settings.settings = s
    }

    private func addToChain(_ id: ProviderID) {
        var s = settings.settings
        s.modelOrder.append(ProviderSlot(provider: id))
        settings.settings = s
        expanded = id
    }

    private func removeFromChain(_ id: ProviderID) {
        var s = settings.settings
        guard s.modelOrder.count > 1 else { return }
        s.modelOrder.removeAll { $0.provider == id }
        settings.settings = s
        if expanded == id { expanded = nil }
    }

    private var languageBinding: Binding<String> {
        Binding(get: { settings.settings.language },
                set: { var s = settings.settings; s.language = $0; settings.settings = s })
    }
    private var vocabularyBinding: Binding<String> {
        Binding(get: { settings.settings.customVocabulary },
                set: { var s = settings.settings; s.customVocabulary = $0; settings.settings = s })
    }
    private func binding(_ keyPath: WritableKeyPath<WhisperioSettings, String>) -> Binding<String> {
        Binding(get: { settings.settings[keyPath: keyPath] },
                set: { var s = settings.settings; s[keyPath: keyPath] = $0; settings.settings = s })
    }
    private func boolBinding(_ keyPath: WritableKeyPath<WhisperioSettings, Bool>) -> Binding<Bool> {
        Binding(get: { settings.settings[keyPath: keyPath] },
                set: { var s = settings.settings; s[keyPath: keyPath] = $0; settings.settings = s })
    }
}

// MARK: - Audio tab (wz-tabs.jsx Audio — input device + save-recordings)

private struct MacInputDevice: Identifiable, Hashable {
    let id: String   // uniqueID, "" = System Default
    let name: String
}

struct MacAudioTab: View {
    @AppStorage("wz.split.dark") private var splitDark = true
    @AppStorage("wz.mac.inputDevice") private var savedDeviceID = ""
    @EnvironmentObject private var settings: SettingsStore
    @State private var devices: [MacInputDevice] = [MacInputDevice(id: "", name: "System Default")]

    private var t: WZTheme { .of(splitDark) }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            MacSettingsSection(
                title: "Input Device",
                hint: "Applies the next time dictation starts. If Live Dictation hasn't picked up a device change yet, the label here still reflects your saved choice."
            ) {
                Picker("Microphone", selection: $savedDeviceID) {
                    ForEach(devices) { d in
                        Text(d.name).tag(d.id)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
            }

            MacSettingsSection(title: "Recording History") {
                MacToggleRow(
                    label: "Save recordings",
                    description: "Keep a local history of past dictations",
                    checked: boolBinding(\.saveRecordings)
                )
            }
        }
        .environment(\.wz, t)
        .onAppear(perform: refreshDevices)
    }

    private func refreshDevices() {
        let found = AVCaptureDevice.devices(for: .audio)
            .map { MacInputDevice(id: $0.uniqueID, name: $0.localizedName) }
        devices = [MacInputDevice(id: "", name: "System Default")] + found
        // A previously-saved device that vanished (unplugged) still shows via its saved id
        // until reselected — avoid silently snapping back to System Default.
        if !devices.contains(where: { $0.id == savedDeviceID }) && !savedDeviceID.isEmpty {
            devices.append(MacInputDevice(id: savedDeviceID, name: "\(savedDeviceID) (disconnected)"))
        }
    }

    private func boolBinding(_ keyPath: WritableKeyPath<WhisperioSettings, Bool>) -> Binding<Bool> {
        Binding(get: { settings.settings[keyPath: keyPath] },
                set: { var s = settings.settings; s[keyPath: keyPath] = $0; settings.settings = s })
    }
}

// MARK: - Recordings tab (wz-tabs.jsx Recordings — storage summary + reveal-in-Finder)

struct MacRecordingsTab: View {
    @AppStorage("wz.split.dark") private var splitDark = true
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var recordings: RecordingsStore
    @State private var totalBytes: Int64 = 0

    private var t: WZTheme { .of(splitDark) }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            MacSettingsSection(title: "Storage") {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(recordings.items.count) recording\(recordings.items.count == 1 ? "" : "s")")
                            .font(WZFont.ui(14, .semibold)).foregroundStyle(t.text)
                        Text(Self.format(totalBytes) + " of audio on this Mac")
                            .font(WZFont.ui(12))
                            .foregroundStyle(t.muted)
                    }
                    Spacer()
                    Button {
                        NSWorkspace.shared.open(AudioStore.folder)
                    } label: {
                        Label("Reveal in Finder", systemImage: "folder")
                    }
                }
            }

            MacSettingsSection(title: "History") {
                MacToggleRow(
                    label: "Save recordings",
                    description: "Keep a local history of past dictations",
                    checked: boolBinding(\.saveRecordings)
                )
            }
        }
        .environment(\.wz, t)
        .onAppear(perform: measure)
    }

    private func measure() {
        totalBytes = AudioStore.allFiles().reduce(0) {
            $0 + Int64((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
    }

    private static func format(_ bytes: Int64) -> String {
        guard bytes > 0 else { return "0 MB" }
        let mb = Double(bytes) / 1_048_576
        if mb < 0.1 { return String(format: "%.0f KB", max(1, Double(bytes) / 1024)) }
        if mb < 1000 { return String(format: mb < 10 ? "%.1f MB" : "%.0f MB", mb) }
        return String(format: "%.1f GB", mb / 1024)
    }

    private func boolBinding(_ keyPath: WritableKeyPath<WhisperioSettings, Bool>) -> Binding<Bool> {
        Binding(get: { settings.settings[keyPath: keyPath] },
                set: { var s = settings.settings; s[keyPath: keyPath] = $0; settings.settings = s })
    }
}
#endif
