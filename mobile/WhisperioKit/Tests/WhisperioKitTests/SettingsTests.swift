import Testing
import Foundation
@testable import WhisperioKit

@Suite struct SettingsTests {
    @Test func defaultsPutOnDeviceFirstAndNoSecrets() {
        let s = WhisperioSettings()
        #expect(s.providerChain == [.onDevice])
        #expect(s.openAIKey.isEmpty)
        #expect(s.elevenLabsKey.isEmpty)
    }

    @Test func codableRoundTrips() throws {
        let original = WhisperioSettings(
            providerChain: [.onDevice, .openAI],
            openAIKey: "x",
            language: "pl",
            customVocabulary: "git, TypeScript",
            cleanupEnabled: true
        )
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: data)
        #expect(decoded == original)
    }

    @Test func vocabularyTermsAreTrimmedAndCompacted() {
        let s = WhisperioSettings(customVocabulary: " git ,, TypeScript ,React,")
        #expect(s.vocabularyTerms == ["git", "TypeScript", "React"])
    }

    @Test func providerRawValuesMatchDesktopSettings() {
        // Cross-platform config parity with the desktop JSON.
        #expect(ProviderID.openAI.rawValue == "openai")
        #expect(ProviderID.elevenLabs.rawValue == "elevenlabs")
        #expect(ProviderID.onDevice.rawValue == "ondevice")
    }
}
