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
        if let data = d.data(forKey: Self.key),
           let s = try? JSONDecoder().decode(WhisperioSettings.self, from: data) {
            settings = s
        } else {
            settings = WhisperioSettings()
        }
        didCompleteSetup = d.bool(forKey: Self.setupKey)
    }

    private func save() {
        if let data = try? JSONEncoder().encode(settings) {
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
