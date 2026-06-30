import Foundation
import Combine
import WhisperioKit

// Persisted user settings (provider chain + keys), mirroring the desktop settings.
// Stored in UserDefaults as JSON so it survives relaunches.
@MainActor
final class SettingsStore: ObservableObject {
    @Published var settings: WhisperioSettings { didSet { save() } }
    @Published var didCompleteSetup: Bool {
        didSet { UserDefaults.standard.set(didCompleteSetup, forKey: Self.setupKey) }
    }

    private static let key = "whisperio.settings.v1"
    private static let setupKey = "whisperio.setupDone.v1"

    init() {
        let d = UserDefaults.standard
        var loaded = WhisperioSettings()
        if let data = d.data(forKey: Self.key),
           let s = try? JSONDecoder().decode(WhisperioSettings.self, from: data) {
            loaded = s
        }
        didCompleteSetup = d.bool(forKey: Self.setupKey)

        // API secrets live in the Keychain, not in the UserDefaults blob. Prefer the Keychain
        // copy; fall back to any legacy plaintext key still embedded in the blob (pre-Keychain
        // installs) so a stored key is never lost across the upgrade.
        let legacyOpenAI = loaded.openAIKey
        let legacyEleven = loaded.elevenLabsKey
        loaded.openAIKey = Keychain.get(.openAIKey) ?? legacyOpenAI
        loaded.elevenLabsKey = Keychain.get(.elevenLabsKey) ?? legacyEleven
        settings = loaded

        // Migrate + scrub: if the persisted blob carried a plaintext secret, move it into the
        // Keychain and rewrite the blob without it. (Property observers don't fire in init,
        // so call save() explicitly.)
        if !legacyOpenAI.isEmpty || !legacyEleven.isEmpty {
            save()
        }
    }

    private func save() {
        // Secrets go to the Keychain only; everything else is persisted to UserDefaults with
        // the key fields blanked so no API secret is ever written in plaintext.
        Keychain.set(settings.openAIKey, for: .openAIKey)
        Keychain.set(settings.elevenLabsKey, for: .elevenLabsKey)
        var sanitized = settings
        sanitized.openAIKey = ""
        sanitized.elevenLabsKey = ""
        if let data = try? JSONEncoder().encode(sanitized) {
            UserDefaults.standard.set(data, forKey: Self.key)
        }
    }

    // Build the live provider chain. The primary engine first; if fallback is on,
    // the other engines follow (unconfigured ones are skipped by ProviderChain).
    func makeChain() -> ProviderChain {
        let s = settings
        let primary = s.providerChain.first ?? .onDevice
        var order: [ProviderID] = [primary]
        if s.fallbackEnabled {
            for id in [ProviderID.onDevice, .openAI, .elevenLabs] where id != primary {
                order.append(id)
            }
        }
        // Cloud engines stay disabled until the user has granted explicit consent — even
        // as a fallback. On-device (Apple Speech) never needs consent.
        if !s.cloudConsentGranted {
            order.removeAll { s.isCloud($0) }
            if order.isEmpty { order = [.onDevice] }
        }
        return ProviderChain(providers: order.map { provider(for: $0, s) })
    }

    private func provider(for id: ProviderID, _ s: WhisperioSettings) -> any TranscriptionProvider {
        switch id {
        case .onDevice:
            return AppleSpeechProvider(language: s.language, vocabulary: s.vocabularyTerms,
                                       requireOnDevice: !s.appleAllowOnline)
        case .openAI:
            return OpenAIProvider(apiKey: s.openAIKey, baseURL: s.openAIBaseURL,
                                  model: s.whisperModel, language: s.language,
                                  prompt: s.customVocabulary)
        case .elevenLabs:
            return ElevenLabsProvider(apiKey: s.elevenLabsKey,
                                      languageCode: s.language, keyterms: s.vocabularyTerms)
        }
    }

    // Tidy a transcript when cleanup is enabled (deterministic, works on every device).
    func cleanup(_ text: String) -> String {
        settings.cleanupEnabled ? TextCleaner.tidy(text) : text
    }
}
