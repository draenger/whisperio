#if os(macOS)
import SwiftUI
import SwiftData
import WhisperioKit

// Main window: lists the synced recording history and surfaces the configured engine order.
// History comes straight from WhisperioKit's `RecordingSyncStore` (the same SwiftData +
// CloudKit store the iOS app uses), so the Mac and iPhone share one journal. Engine config is
// read through the same `WhisperioSettings` + `Keychain` domain the phone drives.
@available(macOS 14, *)
struct ContentView: View {
    @StateObject private var store: RecordingSyncStore
    @State private var config = MacConfig.load()
    @State private var selection: UUID?

    init() {
        _store = StateObject(wrappedValue: ContentView.makeStore())
    }

    var body: some View {
        NavigationSplitView {
            List(store.items, selection: $selection) { recording in
                RecordingRow(recording: recording).tag(recording.id)
            }
            .navigationTitle("History")
            .frame(minWidth: 260)
        } detail: {
            if let id = selection, let recording = store.items.first(where: { $0.id == id }) {
                RecordingDetail(recording: recording)
            } else {
                ContentUnavailableView("No recording selected",
                                       systemImage: "waveform",
                                       description: Text("Pick a recording to read its transcript."))
            }
        }
        .safeAreaInset(edge: .top) { EngineBar(config: config) }
    }

    // Prefer the shared CloudKit-backed store; fall back to an in-memory store so the window
    // still renders on an unsigned dev build with no iCloud container available.
    @MainActor
    private static func makeStore() -> RecordingSyncStore {
        if let cloud = try? RecordingSyncStore() { return cloud }
        let memory = ModelConfiguration(isStoredInMemoryOnly: true)
        // An in-memory container has no external failure mode, so this can't realistically throw.
        return (try? RecordingSyncStore(configuration: memory))
            ?? { fatalError("Failed to build in-memory RecordingSyncStore") }()
    }
}

// MARK: - Rows

@available(macOS 14, *)
private struct RecordingRow: View {
    let recording: Recording

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).lineLimit(1).font(.body)
            Text(recording.timestamp, format: .dateTime.month().day().hour().minute())
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    private var title: String {
        switch recording.status {
        case .completed: return recording.transcription ?? "(empty)"
        case .failed:    return recording.error.map { "Failed: \($0)" } ?? "Transcription failed"
        case .pending:   return "Transcribing…"
        }
    }
}

@available(macOS 14, *)
private struct RecordingDetail: View {
    let recording: Recording

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(recording.timestamp, format: .dateTime.weekday().month().day().hour().minute())
                    .font(.headline)
                if let render = recording.render, !render.isEmpty {
                    section("Rewrite", render)
                }
                section("Transcript", recording.transcription ?? "(no transcript)")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
    }

    private func section(_ label: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.caption).foregroundStyle(.secondary)
            Text(body).textSelection(.enabled)
        }
    }
}

// MARK: - Engine bar

@available(macOS 14, *)
private struct EngineBar: View {
    let config: MacConfig

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "gearshape")
            Text("Engines: \(config.engineOrder)")
            Spacer()
            if !config.cloudKeyPresent {
                Label("No cloud key", systemImage: "key.slash").foregroundStyle(.secondary)
            }
        }
        .font(.callout)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

// MARK: - Config

// Read-only projection of the shared settings for the Mac window. Mirrors the iOS SettingsStore
// house style: decode the persisted `WhisperioSettings` blob from UserDefaults, then hydrate the
// BYO secrets from the Keychain (they're never persisted in the plaintext blob).
private struct MacConfig {
    let engineOrder: String
    let cloudKeyPresent: Bool

    static func load() -> MacConfig {
        var settings = WhisperioSettings()
        if let data = UserDefaults.standard.data(forKey: "whisperio.settings.v1"),
           let decoded = try? JSONDecoder().decode(WhisperioSettings.self, from: data) {
            settings = decoded
        }
        let openAI = Keychain.get(.openAIKey) ?? settings.openAIKey
        let eleven = Keychain.get(.elevenLabsKey) ?? settings.elevenLabsKey

        // The chain drives transcription order (see WhisperioKit.ProviderChain); here we only
        // display the configured priority.
        let order = settings.providerChain.map(label(for:)).joined(separator: " → ")
        return MacConfig(engineOrder: order.isEmpty ? "—" : order,
                         cloudKeyPresent: !openAI.isEmpty || !eleven.isEmpty)
    }

    private static func label(for id: ProviderID) -> String {
        switch id {
        case .onDevice:   return "On-device"
        case .openAI:     return "OpenAI"
        case .elevenLabs: return "ElevenLabs"
        }
    }
}
#endif
