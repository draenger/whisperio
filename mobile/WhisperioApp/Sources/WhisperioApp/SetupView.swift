import SwiftUI
import WhisperioKit

// First-run engine picker — mirrors the desktop provider choice:
// Apple on-device (free, private) · OpenAI (key) · ElevenLabs (key).
struct SetupView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore

    @State private var selected: ProviderID = .onDevice
    @State private var openAIKey = ""
    @State private var elevenKey = ""
    @State private var consentProvider: ProviderID?

    private var keyNeeded: Bool { selected == .openAI || selected == .elevenLabs }
    private var canContinue: Bool {
        switch selected {
        case .onDevice: return true
        case .openAI: return !openAIKey.trimmingCharacters(in: .whitespaces).isEmpty
        case .elevenLabs: return !elevenKey.trimmingCharacters(in: .whitespaces).isEmpty
        // Not offered by the first-run picker — configured later in Settings → Models.
        case .groq, .deepgram, .assemblyAI, .mistral: return false
        }
    }

    var body: some View {
        ScreenScaffold {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 8) {
                        WIcon("mic", size: 30).foregroundStyle(t.accent)
                        Text("Choose your engine")
                            .font(WZFont.display(28, .semibold)).foregroundStyle(t.text)
                        Text("How should Whisperio turn your voice into text? You can change this later in Settings.")
                            .font(WZFont.ui(14.5)).foregroundStyle(t.muted).lineSpacing(3)
                    }
                    .padding(.top, 12)

                    VStack(spacing: 11) {
                        engineCard(.onDevice, title: "Apple — on-device",
                                   sub: "Free · private · works offline (Apple Silicon)", icon: "cpu")
                        engineCard(.openAI, title: "OpenAI",
                                   sub: "Cloud · Whisper API · needs your API key", icon: "globe")
                        engineCard(.elevenLabs, title: "ElevenLabs",
                                   sub: "Cloud · Scribe · needs your API key", icon: "globe")
                    }

                    if keyNeeded {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(text: "\(selected == .openAI ? "OpenAI" : "ElevenLabs") API key")
                            SecureField("paste key…", text: selected == .openAI ? $openAIKey : $elevenKey)
                                #if os(iOS)
                                .textInputAutocapitalization(.never)
                                #endif
                                .autocorrectionDisabled()
                                .font(WZFont.mono(13))
                                .padding(.horizontal, 13).padding(.vertical, 12)
                                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
                            Text("Stored only on this device — never committed or shared.")
                                .font(WZFont.mono(11)).foregroundStyle(t.faint)
                        }
                        .transition(.opacity)
                    }

                    Button(action: complete) {
                        Text("Start dictating")
                            .font(WZFont.ui(16, .semibold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 15)
                            .background(canContinue ? AnyShapeStyle(t.gradient) : AnyShapeStyle(t.surfaceUp),
                                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain).disabled(!canContinue)
                    .padding(.top, 4)
                }
                .padding(.horizontal, 22).padding(.bottom, 30)
                .animation(.easeInOut(duration: 0.2), value: selected)
            }
        }
        .sheet(item: Binding(get: { consentProvider.map { ConsentTarget(id: $0) } },
                             set: { consentProvider = $0?.id })) { target in
            CloudConsentSheet(provider: target.id,
                              onAccept: { finish(consent: true) },
                              onCancel: { consentProvider = nil })
                .environment(\.wz, t)
                #if os(iOS)
                .presentationDetents([.medium, .large])
                #endif
        }
    }

    private struct ConsentTarget: Identifiable { let id: ProviderID }

    private func engineCard(_ id: ProviderID, title: String, sub: String, icon: String) -> some View {
        let on = selected == id
        return Button { selected = id } label: {
            HStack(spacing: 13) {
                WIcon(icon, size: 18).foregroundStyle(on ? t.accent : t.muted)
                    .frame(width: 40, height: 40)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(WZFont.ui(15, .semibold)).foregroundStyle(t.text)
                    Text(sub).font(WZFont.mono(11)).foregroundStyle(t.faint)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                WIcon(on ? "check" : "", size: 18).foregroundStyle(t.accent)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(on ? t.accent : t.line, lineWidth: on ? 2 : 1))
        }
        .buttonStyle(.plain)
    }

    private func complete() {
        // Cloud requires explicit consent first; on-device proceeds straight away.
        if settings.settings.isCloud(selected) && !settings.settings.cloudConsentGranted {
            consentProvider = selected
        } else {
            finish(consent: settings.settings.cloudConsentGranted)
        }
    }

    private func finish(consent: Bool) {
        var s = settings.settings
        s.providerChain = [selected]
        if consent { s.cloudConsentGranted = true }
        if selected == .openAI { s.openAIKey = openAIKey.trimmingCharacters(in: .whitespaces) }
        if selected == .elevenLabs { s.elevenLabsKey = elevenKey.trimmingCharacters(in: .whitespaces) }
        settings.settings = s
        consentProvider = nil
        settings.didCompleteSetup = true
    }
}
