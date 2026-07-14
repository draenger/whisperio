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

    // MARK: - SyncMode

    @Test func syncModeDefaultsToAutomaticWithFifteenMinuteInterval() {
        let s = WhisperioSettings()
        #expect(s.syncMode == .automatic)
        #expect(s.syncIntervalMinutes == 15)
    }

    @Test func syncModeCodableRoundTrips() throws {
        for mode in SyncMode.allCases {
            let original = WhisperioSettings(syncMode: mode, syncIntervalMinutes: 30)
            let data = try JSONEncoder().encode(original)
            let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: data)
            #expect(decoded.syncMode == mode)
            #expect(decoded.syncIntervalMinutes == 30)
        }
    }

    // A blob persisted before syncMode/syncIntervalMinutes existed (missing keys entirely) still
    // decodes, falling back to the defaults — same tolerant-decode contract as every other field.
    @Test func syncModeMissingKeysFallBackToDefaults() throws {
        let legacy = try JSONEncoder().encode(["providerChain": ["ondevice"]])
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: legacy)
        #expect(decoded.syncMode == .automatic)
        #expect(decoded.syncIntervalMinutes == 15)
    }

    // An unrecognized raw string (e.g. a future build's mode) must not throw the whole settings
    // blob out — it falls back to .automatic, same as a missing key.
    @Test func syncModeUnknownRawValueFallsBackToAutomatic() throws {
        let json = """
        {"providerChain": ["ondevice"], "syncMode": "some-future-mode"}
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: json)
        #expect(decoded.syncMode == .automatic)
    }

    // A non-positive syncIntervalMinutes (corrupt persisted state, or a future build that allowed
    // 0) falls back to the default rather than producing a runaway sub-minute timer downstream.
    @Test func syncIntervalMinutesNonPositiveFallsBackToDefault() throws {
        let json = """
        {"providerChain": ["ondevice"], "syncIntervalMinutes": 0}
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(WhisperioSettings.self, from: json)
        #expect(decoded.syncIntervalMinutes == 15)
    }
}
