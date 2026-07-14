import SwiftUI
import WhisperioKit

// Transcription engine management — was a frozen mock over WZSample.models (a fictitious
// on-device Whisper download flow with no backing logic). This screen now surfaces the
// same real engines SettingsView's "Transcription engine" picker (modelCategory) drives:
// Apple on-device, OpenAI, and ElevenLabs, backed by SettingsStore.settings.providerChain.
// "Use" actually switches the active engine (with the same cloud-consent gate); the active
// engine shows a checkmark. Port of Models() in wz-iphone.jsx, since corrected to match
// what Whisperio actually ships.
struct ModelsView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore
    var onBack: () -> Void

    @State private var consentProvider: ProviderID?   // non-nil → consent sheet is up

    private var engine: ProviderID { settings.settings.providerChain.first ?? .onDevice }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Manage models", onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 11) {
                        privacyBanner
                        engineCard(.onDevice, "Apple Speech", "Built-in · on-device", "cpu", tag: "Default")
                        engineCard(.openAI, "OpenAI", "Cloud · Whisper API", "globe")
                        engineCard(.elevenLabs, "ElevenLabs", "Cloud · Scribe", "globe")
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
                }
            }
        }
        .sheet(item: Binding(get: { consentProvider.map { ModelConsentTarget(id: $0) } },
                             set: { consentProvider = $0?.id })) { target in
            CloudConsentSheet(provider: target.id,
                              onAccept: { grantCloud(target.id) },
                              onCancel: { consentProvider = nil })
                .environment(\.wz, t)
                #if os(iOS)
                .presentationDetents([.medium, .large])
                #endif
        }
    }

    // Wrap a ProviderID so it can drive `.sheet(item:)` (own type — SettingsView's
    // ConsentTarget is private to that file).
    private struct ModelConsentTarget: Identifiable { let id: ProviderID }

    private var isCloudActive: Bool { settings.settings.isCloud(engine) }

    private var privacyBanner: some View {
        HStack(spacing: 9) {
            WIcon(isCloudActive ? "cloud" : "shield", size: 18).foregroundStyle(isCloudActive ? t.amber : t.green)
            Text(isCloudActive
                 ? "\(engineName(engine)) is active. Your audio is sent to its servers to be transcribed."
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

    private func engineName(_ id: ProviderID) -> String {
        switch id {
        case .onDevice: return "Apple"
        case .openAI: return "OpenAI"
        case .elevenLabs: return "ElevenLabs"
        }
    }

    private func engineCard(_ id: ProviderID, _ name: String, _ sub: String, _ icon: String, tag: String? = nil) -> some View {
        let on = engine == id
        return VStack(spacing: 0) {
            HStack(spacing: 12) {
                WIcon(icon, size: 18, weight: .regular).foregroundStyle(t.accentLite)
                    .frame(width: 38, height: 38)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(name).font(WZFont.display(15)).foregroundStyle(t.text)
                        if let tag {
                            Text(tag).font(WZFont.mono(10)).foregroundStyle(t.accentLite)
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(t.line, lineWidth: 1))
                        }
                    }
                    Text(sub).font(WZFont.ui(12.5)).foregroundStyle(t.muted)
                }
                Spacer(minLength: 0)
                trailing(id, on: on)
            }
            if on, id == .openAI {
                keyField("OpenAI API key", binding(\.openAIKey)).padding(.top, 13)
            }
            if on, id == .elevenLabs {
                keyField("ElevenLabs API key", binding(\.elevenLabsKey)).padding(.top, 13)
            }
        }
        .padding(15)
        .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(on ? t.hair : t.line, lineWidth: 1))
    }

    @ViewBuilder private func trailing(_ id: ProviderID, on: Bool) -> some View {
        if on {
            WIcon("check", size: 20).foregroundStyle(t.green)
        } else {
            Button { selectEngine(id) } label: {
                Text("Use")
                    .font(WZFont.ui(13, .semibold)).foregroundStyle(t.accentLite)
                    .padding(.horizontal, 13).padding(.vertical, 7)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(t.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    /// Cloud providers require explicit, persisted consent before they can be selected —
    /// same gate SettingsView.selectEngine uses.
    private func selectEngine(_ id: ProviderID) {
        if settings.settings.isCloud(id) && !settings.settings.cloudConsentGranted {
            consentProvider = id
        } else {
            applyEngine(id)
        }
    }

    private func applyEngine(_ id: ProviderID) {
        var s = settings.settings
        s.providerChain = [id]
        settings.settings = s
    }

    private func grantCloud(_ id: ProviderID) {
        var s = settings.settings
        s.cloudConsentGranted = true
        s.providerChain = [id]
        settings.settings = s
        consentProvider = nil
    }

    private func keyField(_ label: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(text: label).padding(.leading, 4)
            SecureField("paste key…", text: text)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()
                .font(WZFont.mono(13))
                .padding(.horizontal, 13).padding(.vertical, 12)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }

    private func binding(_ keyPath: WritableKeyPath<WhisperioSettings, String>) -> Binding<String> {
        Binding(get: { settings.settings[keyPath: keyPath] },
                set: { var s = settings.settings; s[keyPath: keyPath] = $0; settings.settings = s })
    }
}
