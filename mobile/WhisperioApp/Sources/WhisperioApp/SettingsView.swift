import SwiftUI
import AppIntents
import WhisperioKit

// Settings — real, backed by SettingsStore: pick the transcription engine, enter
// cloud keys, toggle AI cleanup. Appearance + models below.
struct SettingsView: View {
    @Environment(\.wz) private var t
    @EnvironmentObject private var settings: SettingsStore
    var onBack: () -> Void
    @Binding var dark: Bool
    var openModels: () -> Void
    var openKeyboardSetup: () -> Void = {}

    @State private var consentProvider: ProviderID?   // non-nil → consent sheet is up

    private var engine: ProviderID { settings.settings.providerChain.first ?? .onDevice }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
    }

    private let languages: [(name: String, code: String)] = [
        ("Auto-detect", "auto"), ("English", "en"), ("Polski", "pl"), ("Deutsch", "de"),
        ("Español", "es"), ("Français", "fr"), ("Italiano", "it"), ("Português", "pt"),
        ("Nederlands", "nl"), ("Русский", "ru"), ("Українська", "uk")
    ]

    private var currentLanguageName: String {
        languages.first { $0.code == settings.settings.language }?.name ?? settings.settings.language
    }

    private func setLanguage(_ code: String) {
        var s = settings.settings
        s.language = code
        settings.settings = s
    }

    var body: some View {
        ScreenScaffold {
            VStack(spacing: 0) {
                WHeader(title: "Settings", onBack: onBack)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        VStack(alignment: .leading, spacing: 9) {
                            HStack {
                                SectionLabel(text: "Transcription engine")
                                Spacer()
                                PrivacyBadge(mode: settings.settings.isCloud(engine) ? .cloud : .device, small: true)
                            }
                            .padding(.leading, 4)
                            VStack(spacing: 10) {
                                engineRow(.onDevice, "Apple — on-device", "Free · private · offline", "cpu")
                                engineRow(.openAI, "OpenAI", "Cloud · Whisper API", "globe")
                                engineRow(.elevenLabs, "ElevenLabs", "Cloud · Scribe", "globe")
                            }
                            if engine == .openAI {
                                keyField("OpenAI API key", binding(\.openAIKey))
                                plainField("Base URL (optional, self-hosted)", "https://api.openai.com/v1", binding(\.openAIBaseURL))
                                plainField("Model (optional)", "whisper-1", binding(\.whisperModel))
                            }
                            if engine == .elevenLabs { keyField("ElevenLabs API key", binding(\.elevenLabsKey)) }
                        }

                        VStack(alignment: .leading, spacing: 11) {
                            SectionLabel(text: "Quick dictation").padding(.leading, 4)
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Say “Dictate with Whisperio” to Siri — or add the shortcut, then assign it to Back Tap (Settings → Accessibility → Touch → Back Tap → Run Shortcut).")
                                    .font(WZFont.ui(13)).foregroundStyle(t.muted).lineSpacing(3)
                                SiriTipView(intent: DictateIntent()).tint(t.accent)
                                ShortcutsLink().tint(t.accent)
                            }
                            .padding(16)
                            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                        }

                        SettGroup(title: "Keyboard") {
                            SettRow(icon: "keyboard", label: "Whisperio keyboard",
                                    sub: "Dictate from any app — install & setup", last: true,
                                    onTap: openKeyboardSetup)
                        }

                        SettGroup(title: "Transcription") {
                            SettRow(icon: "spark", label: "Cleanup",
                                    sub: "Tidy punctuation, casing & spacing") {
                                WToggle(on: boolBinding(\.cleanupEnabled))
                            }
                            SettRow(icon: "cloud", label: "Fallback engines",
                                    sub: "If the chosen engine fails, try the others", last: true) {
                                WToggle(on: boolBinding(\.fallbackEnabled))
                            }
                        }

                        VStack(alignment: .leading, spacing: 9) {
                            SectionLabel(text: "Language & vocabulary").padding(.leading, 4)
                            VStack(spacing: 0) {
                                Menu {
                                    ForEach(languages, id: \.code) { lang in
                                        Button(lang.name) { setLanguage(lang.code) }
                                    }
                                } label: {
                                    HStack(spacing: 13) {
                                        WIcon("globe", size: 17, weight: .regular).foregroundStyle(t.accentLite)
                                            .frame(width: 34, height: 34)
                                            .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text("Language").font(WZFont.ui(14.5, .medium)).foregroundStyle(t.text)
                                            Text("Spoken language for transcription").font(WZFont.ui(12)).foregroundStyle(t.muted)
                                        }
                                        Spacer(minLength: 0)
                                        Text(currentLanguageName).font(WZFont.ui(13)).foregroundStyle(t.accentLite)
                                        WIcon("chevR", size: 16, weight: .regular).foregroundStyle(t.faint)
                                    }
                                    .padding(.vertical, 13)
                                }
                                .overlay(alignment: .bottom) { Rectangle().fill(t.lineSoft).frame(height: 1) }

                                VStack(alignment: .leading, spacing: 7) {
                                    Text("Custom words").font(WZFont.ui(13, .semibold)).foregroundStyle(t.muted)
                                    TextField("git, GitHub, Next.js, kubectl…",
                                              text: binding(\.customVocabulary), axis: .vertical)
                                        .lineLimit(2...4)
                                        .font(WZFont.ui(13.5))
                                        .textInputAutocapitalization(.never)
                                        .padding(.horizontal, 11).padding(.vertical, 9)
                                        .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(t.line, lineWidth: 1))
                                    Text("Comma-separated — helps spell names, brands & jargon.")
                                        .font(WZFont.mono(11)).foregroundStyle(t.faint)
                                }
                                .padding(.vertical, 13)
                            }
                            .padding(.horizontal, 16)
                            .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
                        }

                        SettGroup(title: "On-device models") {
                            SettRow(icon: "download", label: "Manage models",
                                    sub: "Apple Speech + Whisper", last: true, onTap: openModels)
                        }

                        SettGroup(title: "Appearance") {
                            SettRow(icon: dark ? "moon" : "sun", label: "Dark mode",
                                    sub: "Match Whisperio’s look", last: true) {
                                WToggle(on: $dark)
                            }
                        }

                        Text("Whisperio \(appVersion) · on-device")
                            .font(WZFont.mono(11)).foregroundStyle(t.faint)
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 28)
                    .animation(.easeInOut(duration: 0.2), value: engine)
                }
            }
        }
        .sheet(item: Binding(get: { consentProvider.map { ConsentTarget(id: $0) } },
                             set: { consentProvider = $0?.id })) { target in
            CloudConsentSheet(provider: target.id,
                              onAccept: { grantCloud(target.id) },
                              onCancel: { consentProvider = nil })
                .environment(\.wz, t)
                .presentationDetents([.medium, .large])
        }
    }

    // Wrap a ProviderID so it can drive `.sheet(item:)`.
    private struct ConsentTarget: Identifiable { let id: ProviderID }

    /// Cloud providers require explicit, persisted consent before they can be selected.
    private func selectEngine(_ id: ProviderID) {
        if settings.settings.isCloud(id) && !settings.settings.cloudConsentGranted {
            consentProvider = id   // ask first; only switch on accept
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

    private func engineRow(_ id: ProviderID, _ title: String, _ sub: String, _ icon: String) -> some View {
        let on = engine == id
        let cloud = settings.settings.isCloud(id)
        let needsConsent = cloud && !settings.settings.cloudConsentGranted
        return Button {
            selectEngine(id)
        } label: {
            HStack(spacing: 13) {
                WIcon(icon, size: 17).foregroundStyle(on ? t.accent : t.muted)
                    .frame(width: 38, height: 38)
                    .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(WZFont.ui(14.5, .semibold)).foregroundStyle(t.text)
                    Text(sub).font(WZFont.mono(11)).foregroundStyle(t.faint)
                }
                Spacer(minLength: 0)
                if needsConsent {
                    WIcon("lock", size: 13).foregroundStyle(t.amber)
                }
                WIcon(on ? "check" : "", size: 18).foregroundStyle(t.accent)
            }
            .padding(13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(t.surface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous)
                .stroke(on ? t.accent : t.line, lineWidth: on ? 2 : 1))
        }
        .buttonStyle(.plain)
    }

    private func keyField(_ label: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(text: label).padding(.leading, 4)
            SecureField("paste key…", text: text)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .font(WZFont.mono(13))
                .padding(.horizontal, 13).padding(.vertical, 12)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
        }
        .padding(.top, 2)
    }

    private func plainField(_ label: String, _ placeholder: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(text: label).padding(.leading, 4)
            TextField(placeholder, text: text)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .keyboardType(.URL)
                .font(WZFont.mono(13))
                .padding(.horizontal, 13).padding(.vertical, 12)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(t.line, lineWidth: 1))
        }
        .padding(.top, 2)
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

struct SettGroup<Content: View>: View {
    @Environment(\.wz) private var t
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: title).padding(.leading, 4)
            VStack(spacing: 0) { content }
                .padding(.horizontal, 16)
                .background(t.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(t.line, lineWidth: 1))
        }
    }
}

struct SettRow<Right: View>: View {
    @Environment(\.wz) private var t
    let icon: String
    let label: String
    var sub: String? = nil
    var last = false
    var onTap: (() -> Void)? = nil
    @ViewBuilder var right: Right

    var body: some View {
        let row = HStack(spacing: 13) {
            WIcon(icon, size: 17, weight: .regular).foregroundStyle(t.accentLite)
                .frame(width: 34, height: 34)
                .background(t.surfaceUp, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(WZFont.ui(14.5, .medium)).foregroundStyle(t.text)
                if let sub { Text(sub).font(WZFont.ui(12)).foregroundStyle(t.muted) }
            }
            Spacer(minLength: 0)
            right
            if onTap != nil, Right.self == EmptyView.self {
                WIcon("chevR", size: 17, weight: .regular).foregroundStyle(t.faint)
            }
        }
        .padding(.vertical, 13)
        .overlay(alignment: .bottom) {
            if !last { Rectangle().fill(t.lineSoft).frame(height: 1) }
        }

        if let onTap {
            Button(action: onTap) { row }.buttonStyle(.plain)
        } else {
            row
        }
    }
}

extension SettRow where Right == EmptyView {
    init(icon: String, label: String, sub: String? = nil, last: Bool = false, onTap: (() -> Void)? = nil) {
        self.init(icon: icon, label: label, sub: sub, last: last, onTap: onTap) { EmptyView() }
    }
}

// MARK: - Cloud consent sheet
// Plain-words, explicit opt-in before any audio leaves the device. Accepting persists
// `cloudConsentGranted`; on-device (Apple Speech) never reaches this.
struct CloudConsentSheet: View {
    @Environment(\.wz) private var t
    let provider: ProviderID
    var onAccept: () -> Void
    var onCancel: () -> Void

    private var name: String { provider == .openAI ? "OpenAI" : "ElevenLabs" }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                PrivacyBadge(mode: .cloud)
                Spacer()
                Button(action: onCancel) {
                    WIcon("x", size: 16).foregroundStyle(t.muted)
                        .frame(width: 34, height: 34)
                        .background(t.surfaceUp, in: Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(.bottom, 18)

            WIcon("cloud", size: 26).foregroundStyle(.white)
                .frame(width: 56, height: 56)
                .background(t.amber.opacity(0.9), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.bottom, 16)

            Text("Turn on cloud transcription?")
                .font(WZFont.display(21)).foregroundStyle(t.text).padding(.bottom, 10)

            Text("To use \(name), your audio will leave this device and be sent to \(name)’s servers to be transcribed. That’s the only way a cloud engine can work.")
                .font(WZFont.ui(14.5)).foregroundStyle(t.muted).lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true).padding(.bottom, 16)

            VStack(alignment: .leading, spacing: 11) {
                bullet("lock", "Prefer privacy? Apple’s on-device engine is free, works in airplane mode, and never uploads anything.")
                bullet("shield", "You can switch back to on-device any time. Your saved transcripts stay on this device.")
            }
            .padding(.bottom, 22)

            GradButton(title: "I understand — enable \(name)", icon: "cloud", action: onAccept)
                .padding(.bottom, 10)
            GhostButton(title: "Keep audio on-device", action: onCancel)

            Spacer(minLength: 0)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(t.bg.ignoresSafeArea())
    }

    private func bullet(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            WIcon(icon, size: 15, weight: .regular).foregroundStyle(t.accentLite).padding(.top, 1)
            Text(text).font(WZFont.ui(13)).foregroundStyle(t.muted).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
