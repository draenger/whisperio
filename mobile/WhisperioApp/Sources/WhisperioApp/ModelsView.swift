import SwiftUI
import WhisperioKit
#if canImport(FoundationModels)
import FoundationModels
#endif

// Real "On-device models" screen (design's modelsList page, mob-settings.jsx:520 /
// M_MODELS in mob-core.jsx). This used to duplicate SettingsView's cloud-engine picker
// (OpenAI/ElevenLabs cards + consent sheet); that's gone — cloud engines are configured
// under Settings ▸ Remote connectors only. This screen is on-device engines exclusively:
// Apple Speech (always available), Apple Intelligence (cleanup & summaries, gated on real
// `SystemLanguageModel` availability via `AppleIntelligenceService`) and local Whisper
// (WhisperKit), backed by real download state/progress/on-disk sizes from
// `LocalWhisperModelManager` — no mocked percentages or hardcoded sizes once a model is on disk.
struct ModelsView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore
    @EnvironmentObject private var models: LocalWhisperModelManager
    var onBack: () -> Void

    @State private var pendingRemove: LocalWhisperModel?

    /// Design order (M_MODELS: whisper-s, whisper-b, whisper-t — "Higher accuracy" first,
    /// "Fastest" last), independent of `LocalWhisperModel`'s own `CaseIterable` declaration
    /// order.
    private static let variantOrder: [LocalWhisperModel] = [.small, .base, .tiny]

    private var engine: ProviderID { settings.settings.primaryProvider }
    private var isCloudActive: Bool { settings.settings.isCloud(engine) }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "On-device models", onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 16) {
                        privacyBanner
                        modelsGroup
                        appleEngineGroup
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
                }
            }
        }
        // Re-scan disk state on appear — a model downloaded in a prior session, or removed
        // via Files.app, must show correctly without relaunching (LocalWhisperModelManager's
        // own doc comment on refreshFromDisk()).
        .onAppear { models.refreshFromDisk() }
        .alert("Download failed",
               isPresented: Binding(get: { models.lastError != nil },
                                    set: { if !$0 { models.lastError = nil } })) {
            Button("OK", role: .cancel) { models.lastError = nil }
        } message: {
            Text(models.lastError ?? "")
        }
        .confirmationDialog("Remove this model? You’ll need to download it again to use it.",
                             isPresented: Binding(get: { pendingRemove != nil },
                                                  set: { if !$0 { pendingRemove = nil } }),
                             titleVisibility: .visible) {
            if let variant = pendingRemove {
                Button("Remove", role: .destructive) { removeModel(variant) }
            }
            Button("Cancel", role: .cancel) { pendingRemove = nil }
        }
    }

    private var privacyBanner: some View {
        HStack(spacing: 9) {
            WIcon(isCloudActive ? "cloud" : "shield", size: 18).foregroundStyle(isCloudActive ? t.amber : t.green)
            Text(isCloudActive
                 ? "\(engine.displayName) is active. Your audio is sent to its servers to be transcribed."
                 : "Models run entirely on your device. Audio never leaves your iPhone.")
                .font(WZFont.ui(13)).foregroundStyle(t.text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background((isCloudActive ? t.amber : t.green).opacity(t.dark ? 0.10 : 0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke((isCloudActive ? t.amber : t.green).opacity(t.dark ? 0.22 : 0.20), lineWidth: 1))
        .padding(.bottom, 5)
    }

    // MARK: - Models group (Apple Speech + Whisper variants)

    private var modelsGroup: some View {
        // R10: this group renders with no section label (design's modelsList page has none) —
        // SettGroup's title is optional now; omitting it entirely drops the synthetic "Models"
        // header this screen used to force.
        SettGroup {
            appleRow
            appleIntelligenceRow
            ForEach(Self.variantOrder, id: \.rawValue) { variant in
                whisperRow(variant, last: variant == Self.variantOrder.last)
            }
        }
    }

    private var appleRow: some View {
        let active = settings.settings.primaryProvider == .onDevice
        return SettRow(icon: "cpu", label: "Apple Speech", sub: "Built-in · on-device · System", last: false) {
            if active {
                // S8: the design's "active" state is always an unboxed dot+label indicator
                // (no pill/border/background) — matches the installed+active Whisper row below,
                // not a boxed "Default" capsule.
                HStack(spacing: 6) {
                    Circle().fill(t.green).frame(width: 7, height: 7)
                    Text("Active").font(WZFont.mono(11, .semibold)).foregroundStyle(t.green)
                }
            } else {
                Button { useApple() } label: { pill("Use") }.buttonStyle(.plain)
            }
        }
    }

    // MARK: - Apple Intelligence (R6)

    // Real availability, never a hardcoded state — backed by `AppleIntelligenceService`
    // (Engine/AppleIntelligenceService.swift), a thin passthrough over
    // `SystemLanguageModel.default.availability` gated to iOS/macOS 26+. On any OS/SDK where
    // FoundationModels isn't available this always reads as `.deviceNotEligible`, which is
    // honest (the capability genuinely isn't available there).
    private enum AppleIntelligenceRowState: Equatable {
        case active          // available + currently serving as the chat client
        case ready           // available, but OpenAI is configured and preferred
        case deviceNotEligible
        case notEnabled
        case preparing
    }

    private var appleIntelligenceState: AppleIntelligenceRowState {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) {
            switch AppleIntelligenceService.availability {
            case .available:
                // Mirrors makeChatClient()'s own gate (SettingsStore.swift): an explicit,
                // configured OpenAI key is explicit user intent and stays preferred.
                let openAIReady = settings.settings.cloudConsentGranted &&
                    !settings.settings.openAIKey.trimmingCharacters(in: .whitespaces).isEmpty
                return openAIReady ? .ready : .active
            case .unavailable(let reason):
                switch reason {
                case .deviceNotEligible: return .deviceNotEligible
                case .appleIntelligenceNotEnabled: return .notEnabled
                case .modelNotReady: return .preparing
                @unknown default: return .deviceNotEligible
                }
            @unknown default:
                return .deviceNotEligible
            }
        }
        #endif
        return .deviceNotEligible
    }

    private var appleIntelligenceRow: some View {
        let state = appleIntelligenceState
        let sub = state == .notEnabled
            ? "Turn on Apple Intelligence in Settings"
            : "Cleanup & summaries · on-device"
        return SettRow(icon: "cpu", label: "Apple Intelligence", sub: sub, last: false) {
            switch state {
            case .active:
                HStack(spacing: 6) {
                    Circle().fill(t.green).frame(width: 7, height: 7)
                    Text("Active").font(WZFont.mono(11, .semibold)).foregroundStyle(t.green)
                }
            case .ready:
                tagPill("Ready")
            case .deviceNotEligible:
                tagPill("A17+ / M-series")
            case .notEnabled:
                EmptyView()
            case .preparing:
                tagPill("Preparing…")
            }
        }
    }

    // Design's modelsList tag style (mob-settings.jsx:527): capsule, faint text, surfaceUp
    // background, hairline border.
    private func tagPill(_ text: String) -> some View {
        Text(text)
            .font(WZFont.mono(10)).foregroundStyle(t.faint)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(t.surfaceUp, in: Capsule())
            .overlay(Capsule().stroke(t.line, lineWidth: 1))
    }

    private func whisperRow(_ variant: LocalWhisperModel, last: Bool) -> some View {
        let state = models.state[variant] ?? .notStarted
        return SettRow(icon: "download", label: variant.displayName, sub: subLabel(variant, state), last: last) {
            trailing(variant, state)
        }
    }

    /// "<subtitle> · <size>" — the estimate before download, real on-disk size once installed
    /// (never the hardcoded estimate once the model is actually on disk), live percentage while
    /// downloading. Mirrors `${m.sub} · ${m.size}` in mob-settings.jsx, with the estimate marked
    /// "~" since it's a pre-download figure, not a measurement.
    private func subLabel(_ variant: LocalWhisperModel, _ state: LocalWhisperModelManager.DownloadState) -> String {
        switch state {
        case .notStarted, .failed:
            return "\(variant.subtitle) · ~\(byteString(variant.approximateDownloadSizeBytes))"
        case .downloading(let fraction):
            return "\(variant.subtitle) · \(Int((fraction * 100).rounded()))% downloaded"
        case .installed:
            let bytes = models.onDiskSizeBytes(variant) ?? variant.approximateDownloadSizeBytes
            return "\(variant.subtitle) · \(byteString(bytes))"
        }
    }

    private func byteString(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }

    @ViewBuilder private func trailing(_ variant: LocalWhisperModel, _ state: LocalWhisperModelManager.DownloadState) -> some View {
        switch state {
        case .notStarted:
            getButton(variant)
        case .downloading(let fraction):
            HStack(spacing: 8) {
                Text("\(Int((fraction * 100).rounded()))%")
                    .font(WZFont.mono(11)).foregroundStyle(t.accentLite)
                Button { models.cancel(variant) } label: {
                    WIcon("x", size: 11).foregroundStyle(t.muted)
                        .frame(width: 22, height: 22)
                        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).stroke(t.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        case .failed:
            getButton(variant, title: "Retry")
        case .installed:
            if isActive(variant) {
                HStack(spacing: 6) {
                    Circle().fill(t.green).frame(width: 7, height: 7)
                    Text("Active").font(WZFont.mono(11, .semibold)).foregroundStyle(t.green)
                }
            } else {
                HStack(spacing: 8) {
                    Button { useModel(variant) } label: { pill("Use") }.buttonStyle(.plain)
                    Button { pendingRemove = variant } label: {
                        WIcon("trash", size: 13).foregroundStyle(t.muted)
                            .frame(width: 26, height: 26)
                            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(t.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func getButton(_ variant: LocalWhisperModel, title: String = "Get") -> some View {
        Button { startDownload(variant) } label: {
            Text(title)
                .font(WZFont.ui(12, .semibold)).foregroundStyle(t.accentLite)
                .padding(.horizontal, 12).padding(.vertical, 5)
                .background(t.accent.opacity(0.14), in: Capsule())
                .overlay(Capsule().stroke(t.hair, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func pill(_ title: String) -> some View {
        Text(title)
            .font(WZFont.ui(13, .semibold)).foregroundStyle(t.accentLite)
            .padding(.horizontal, 13).padding(.vertical, 7)
            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(t.line, lineWidth: 1))
    }

    // Apple's own "use the network when the on-device model isn't available" behavior —
    // parented under Models here (design's modelsList page), not Transcription.
    private var appleEngineGroup: some View {
        SettGroup(title: "Apple engine") {
            SettRow(icon: "globe", label: "Apple online speech",
                    sub: "Use Apple’s servers when the on-device model isn’t available · audio leaves the device",
                    last: true) {
                WToggle(on: boolBinding(\.appleAllowOnline))
            }
        }
    }

    // MARK: - Actions

    /// Whether `variant` is the currently active engine+model — slot 0 is `.localWhisper`
    /// *and* resolves (pinned model, or the per-engine selected model for a modelless slot)
    /// to this exact variant.
    private func isActive(_ variant: LocalWhisperModel) -> Bool {
        guard let slot = settings.settings.modelOrder.first, slot.provider == .localWhisper else { return false }
        return settings.settings.resolvedModel(for: slot) == variant.rawValue
    }

    private func useApple() {
        var s = settings.settings
        s.setPrimaryProvider(.onDevice)
        settings.settings = s
    }

    /// Promote local Whisper to slot 0 and pin this exact variant. `setPrimaryProvider` alone
    /// would reuse whatever model a pre-existing `.localWhisper` slot had pinned — explicitly
    /// overwriting slot 0's model afterward guarantees the row just tapped is the one that
    /// actually becomes active, never a stale previously-used variant.
    private func useModel(_ variant: LocalWhisperModel) {
        var s = settings.settings
        s.localWhisperModel = variant.rawValue
        s.setPrimaryProvider(.localWhisper)
        if !s.modelOrder.isEmpty { s.modelOrder[0].model = variant.rawValue }
        settings.settings = s
    }

    private func startDownload(_ variant: LocalWhisperModel) {
        // `download(_:)` already records real failures onto `models.lastError` (bound to the
        // alert above) and rethrows — the catch here just needs to stop an unhandled-error
        // warning; there is nothing further to do with a failure this call site doesn't
        // already surface honestly.
        Task { try? await models.download(variant) }
    }

    private func removeModel(_ variant: LocalWhisperModel) {
        let wasActive = isActive(variant)
        do {
            try models.delete(variant)
        } catch {
            // delete(_:) doesn't set lastError itself (only download(_:) does) — surface a
            // real removal failure through the same alert rather than swallowing it.
            models.lastError = error.localizedDescription
        }
        pendingRemove = nil
        // A removed-but-still-primary model would leave the chain pointed at a variant that
        // no longer exists on disk. Fall back to Apple Speech honestly rather than silently
        // relying on fallback-chain behavior the user may not have enabled.
        if wasActive { useApple() }
    }

    private func boolBinding(_ keyPath: WritableKeyPath<WhisperioSettings, Bool>) -> Binding<Bool> {
        Binding(get: { settings.settings[keyPath: keyPath] },
                set: { var s = settings.settings; s[keyPath: keyPath] = $0; settings.settings = s })
    }
}
