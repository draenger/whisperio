#if os(macOS)
import SwiftUI
import SwiftData
import WhisperioKit

// Main window: the synced recording history in a Rezme-teal split view.
// History comes straight from WhisperioKit's `RecordingSyncStore` (the same SwiftData +
// CloudKit store the iOS app uses), so the Mac and iPhone share one journal. Engine config is
// read through the same `WhisperioSettings` + `Keychain` domain the phone drives.
//
// Design language is adapted from the iOS `iPadView` (icon-chip sidebar rows, accent selection,
// a de-slopped detail pane) but rebuilt on native SwiftUI + SF Symbols, since only MacApp/ and
// WhisperioKit are attached to this target. The whole tree runs on the teal `WZTheme.rezme`.
@available(macOS 14, *)
struct ContentView: View {
    @StateObject private var store: RecordingSyncStore
    @State private var config = MacConfig.load()
    @State private var selection: UUID?

    // The store is created once at app launch (MacAppModel) and injected here so the window's
    // history and the dictation controller share one instance — a saved dictation appears live.
    init(store: RecordingSyncStore) {
        _store = StateObject(wrappedValue: store)
    }

    var body: some View {
        NavigationSplitView {
            Sidebar(items: store.items, selection: $selection, config: config)
                .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 420)
        } detail: {
            DetailPane(recording: selectedRecording)
        }
        .environment(\.wz, .rezme)
        .preferredColorScheme(.dark)
        .tint(WZTheme.rezme.accent)
    }

    private var selectedRecording: Recording? {
        guard let id = selection else { return nil }
        return store.items.first { $0.id == id }
    }
}

// MARK: - Sidebar

@available(macOS 14, *)
private struct Sidebar: View {
    @Environment(\.wz) private var t
    let items: [Recording]
    @Binding var selection: UUID?
    let config: MacConfig

    var body: some View {
        VStack(spacing: 0) {
            brand
            EngineBar(config: config)
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
            Divider().overlay(t.lineSoft)

            if items.isEmpty {
                emptyHistory
            } else {
                ScrollView {
                    LazyVStack(spacing: 3) {
                        ForEach(items) { rec in
                            Button { selection = rec.id } label: {
                                SidebarRow(recording: rec, selected: selection == rec.id)
                            }
                            .buttonStyle(.plain)
                            .wzHover(lift: 0.03)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 10)
                }
            }
        }
        .background(t.bg2.ignoresSafeArea())
    }

    private var brand: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(t.gradient)
                .frame(width: 26, height: 26)
                .overlay(Image(systemName: "waveform").font(.system(size: 13, weight: .bold)).foregroundStyle(.white))
            Text("Whisperio")
                .font(.system(size: 18, weight: .semibold, design: .rounded))
                .foregroundStyle(t.text)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 12)
    }

    private var emptyHistory: some View {
        VStack(spacing: 10) {
            Image(systemName: "tray")
                .font(.system(size: 26, weight: .regular))
                .foregroundStyle(t.faint)
            Text("No recordings yet")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(t.muted)
            Text("Your dictation history will sync here.")
                .font(.system(size: 11))
                .foregroundStyle(t.faint)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }
}

@available(macOS 14, *)
private struct SidebarRow: View {
    @Environment(\.wz) private var t
    let recording: Recording
    let selected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            iconChip
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(t.text)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(meta)
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(t.faint)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(11)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(selected ? t.accent.opacity(0.14) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(selected ? t.hair : .clear, lineWidth: 1)
        )
        .contentShape(Rectangle())
    }

    private var iconChip: some View {
        Image(systemName: symbol)
            .font(.system(size: 14, weight: .regular))
            .foregroundStyle(recording.status == .failed ? t.red : t.accentLite)
            .frame(width: 32, height: 32)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous).fill(t.surfaceUp)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(t.line, lineWidth: 1)
            )
    }

    private var symbol: String {
        switch recording.status {
        case .pending: return "hourglass"
        case .failed:  return "exclamationmark.triangle"
        case .completed:
            switch recording.provider {
            case .onDevice:   return "cpu"
            case .openAI:     return "sparkles"
            case .elevenLabs: return "waveform.circle"
            case .none:       return "mic.fill"
            }
        }
    }

    private var title: String {
        switch recording.status {
        case .completed: return firstNonEmpty(recording.render, recording.transcription) ?? "(empty)"
        case .failed:    return recording.error.map { "Failed: \($0)" } ?? "Transcription failed"
        case .pending:   return "Transcribing…"
        }
    }

    private var meta: String {
        var parts: [String] = [ProviderLabel.short(recording.provider)]
        parts.append(recording.timestamp.formatted(.dateTime.month().day().hour().minute()))
        if recording.duration > 0 { parts.append(durationText(recording.duration)) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Detail pane

@available(macOS 14, *)
private struct DetailPane: View {
    @Environment(\.wz) private var t
    let recording: Recording?

    var body: some View {
        ZStack {
            t.bg.ignoresSafeArea()
            if let recording {
                content(recording)
            } else {
                empty
            }
        }
    }

    private var empty: some View {
        VStack(spacing: 14) {
            Image(systemName: "waveform")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(t.accent.opacity(0.85))
            Text("No recording selected")
                .font(.system(size: 17, weight: .semibold, design: .rounded))
                .foregroundStyle(t.text)
            Text("Pick a recording to read its transcript.")
                .font(.system(size: 13))
                .foregroundStyle(t.muted)
        }
    }

    private func content(_ r: Recording) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header(r)
                if let render = firstNonEmpty(r.render), r.status == .completed {
                    card(icon: "sparkles", label: "REWRITE", accent: true, body: render)
                }
                card(icon: "text.alignleft",
                     label: "TRANSCRIPT",
                     accent: false,
                     body: firstNonEmpty(r.transcription) ?? "(no transcript)")
                if r.status == .failed, let err = r.error {
                    failureCard(err)
                }
            }
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 40)
            .padding(.vertical, 32)
        }
    }

    private func header(_ r: Recording) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                SourceBadge(provider: r.provider, status: r.status)
                Text(r.timestamp.formatted(.dateTime.weekday().month().day().hour().minute()))
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(t.faint)
                if r.duration > 0 {
                    Text(durationText(r.duration))
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(t.faint)
                }
                Spacer()
            }
            Text(headerTitle(r))
                .font(.system(size: 26, weight: .semibold, design: .rounded))
                .foregroundStyle(t.text)
                .lineSpacing(6)
                .textSelection(.enabled)
        }
    }

    private func headerTitle(_ r: Recording) -> String {
        switch r.status {
        case .completed: return firstNonEmpty(r.render, r.transcription) ?? "Recording"
        case .failed:    return "Transcription failed"
        case .pending:   return "Transcribing…"
        }
    }

    private func card(icon: String, label: String, accent: Bool, body: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 7) {
                Image(systemName: icon).font(.system(size: 12, weight: .semibold))
                Text(label).font(.system(size: 11, weight: .semibold, design: .monospaced)).tracking(1.1)
            }
            .foregroundStyle(accent ? t.accentLite : t.muted)
            Text(body)
                .font(.system(size: 15))
                .foregroundStyle(t.text)
                .lineSpacing(5)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous).fill(t.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(accent ? t.hair : t.line, lineWidth: 1)
        )
    }

    private func failureCard(_ err: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(t.red)
            Text(err)
                .font(.system(size: 13))
                .foregroundStyle(t.muted)
                .textSelection(.enabled)
            Spacer()
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous).fill(t.red.opacity(0.10))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(t.red.opacity(0.35), lineWidth: 1)
        )
    }
}

@available(macOS 14, *)
private struct SourceBadge: View {
    @Environment(\.wz) private var t
    let provider: ProviderID?
    let status: Recording.Status

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 11, weight: .semibold))
            Text(ProviderLabel.short(provider).uppercased())
                .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                .tracking(0.8)
        }
        .foregroundStyle(status == .failed ? t.red : t.accent)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(
            Capsule().fill((status == .failed ? t.red : t.accent).opacity(0.12))
        )
        .overlay(
            Capsule().stroke((status == .failed ? t.red : t.accent).opacity(0.3), lineWidth: 1)
        )
    }

    private var icon: String {
        switch provider {
        case .onDevice:   return "cpu"
        case .openAI:     return "sparkles"
        case .elevenLabs: return "waveform.circle"
        case .none:       return "mic.fill"
        }
    }
}

// MARK: - Engine bar (status header)

@available(macOS 14, *)
private struct EngineBar: View {
    @Environment(\.wz) private var t
    let config: MacConfig

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(t.accentLite)
            VStack(alignment: .leading, spacing: 2) {
                Text("ENGINES")
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .tracking(1.0)
                    .foregroundStyle(t.faint)
                Text(config.engineOrder)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(t.text)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Image(systemName: config.cloudKeyPresent ? "key.fill" : "key.slash")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(config.cloudKeyPresent ? t.accent : t.faint)
                .help(config.cloudKeyPresent ? "Cloud key configured" : "No cloud key")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous).fill(t.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1)
        )
    }
}

// MARK: - Helpers

private func firstNonEmpty(_ candidates: String?...) -> String? {
    for c in candidates {
        if let c, !c.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return c }
    }
    return nil
}

private func durationText(_ seconds: TimeInterval) -> String {
    let total = Int(seconds.rounded())
    let m = total / 60, s = total % 60
    return String(format: "%d:%02d", m, s)
}

private enum ProviderLabel {
    static func short(_ id: ProviderID?) -> String {
        switch id {
        case .onDevice:   return "On-device"
        case .openAI:     return "OpenAI"
        case .elevenLabs: return "ElevenLabs"
        case .none:       return "Whisperio"
        }
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
        let order = settings.providerChain.map { ProviderLabel.short($0) }.joined(separator: " → ")
        return MacConfig(engineOrder: order.isEmpty ? "—" : order,
                         cloudKeyPresent: !openAI.isEmpty || !eleven.isEmpty)
    }
}
#endif
