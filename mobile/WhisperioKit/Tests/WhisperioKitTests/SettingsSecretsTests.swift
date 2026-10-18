import Testing
import Foundation
@testable import WhisperioKit

/// Guards the "every BYO secret lives in the Keychain, never in the UserDefaults JSON" rule that
/// docs/privacy.html §3 promises. 2026-10-16: `replicateKey` and `selfHostedKey` were missing from
/// the hand-written Keychain list and were written to UserDefaults in plaintext.
@Suite struct SettingsSecretsTests {
    /// Every String stored property named like a secret must be routed through the Keychain.
    @Test func everySecretLookingFieldIsListed() {
        let listed = Set(WhisperioSettings.secretFields.map(\.label))
        let mirrored = Set(Mirror(reflecting: WhisperioSettings()).children.compactMap { child -> String? in
            guard let label = child.label, child.value is String else { return nil }
            return label.hasSuffix("Key") || label.hasSuffix("Token") || label.hasSuffix("Secret") || label.hasSuffix("Password") ? label : nil
        })
        #expect(mirrored == listed, "secret-looking fields not routed through the Keychain: \(mirrored.subtracting(listed)); listed but not stored: \(listed.subtracting(mirrored))")
        #expect(listed.contains("replicateKey") && listed.contains("selfHostedKey"))
        #expect(Set(WhisperioSettings.secretFields.map(\.item)).count == WhisperioSettings.secretFields.count)
    }

    /// A blob persisted by an older build carries plaintext secrets: they are detected, kept when
    /// the Keychain has nothing, overridden when it does, and the rewritten blob has none of them.
    @Test func legacyPlaintextSecretsMigrateToKeychainAndLeaveTheBlob() throws {
        var legacy = WhisperioSettings()
        legacy.replicateKey = "r8_legacy"
        legacy.selfHostedKey = "selfhosted-bearer"
        legacy.selfHostedURL = "http://192.168.1.10:8000/v1"
        legacy.openAIKey = "sk-legacy"
        #expect(Set(legacy.plaintextSecretLabels) == ["replicateKey", "selfHostedKey", "openAIKey"])

        // Keychain already holds a newer OpenAI key, nothing for the other two.
        legacy.hydrateSecrets { item in item == .openAIKey ? "sk-keychain" : nil }
        #expect(legacy.openAIKey == "sk-keychain")
        #expect(legacy.replicateKey == "r8_legacy")
        #expect(legacy.selfHostedKey == "selfhosted-bearer")

        var written: [Keychain.Item: String] = [:]
        legacy.persistSecrets { value, item in written[item] = value }
        #expect(written[.replicateKey] == "r8_legacy")
        #expect(written[.selfHostedKey] == "selfhosted-bearer")
        #expect(written.count == WhisperioSettings.secretFields.count)

        let scrubbed = legacy.scrubbedOfSecrets()
        #expect(scrubbed.plaintextSecretLabels.isEmpty)
        #expect(scrubbed.selfHostedURL == legacy.selfHostedURL, "non-secret settings survive scrubbing")
        let json = String(decoding: try JSONEncoder().encode(scrubbed), as: UTF8.self)
        for secret in ["r8_legacy", "selfhosted-bearer", "sk-keychain", "sk-legacy"] { #expect(!json.contains(secret)) }
    }

    @Test func freshSettingsHaveNoPlaintextSecrets() {
        #expect(WhisperioSettings().plaintextSecretLabels.isEmpty)
    }

    @Test func failedKeychainWriteKeepsThatSecretInFallbackCopy() throws {
        var s = WhisperioSettings()
        s.openAIKey = "sk-fail"
        s.groqKey = "gsk-ok"
        let failed = s.persistSecretsReportingFailures { _, item in item != .openAIKey }
        #expect(failed == ["openAIKey"])
        let kept = s.scrubbedOfSecrets(keeping: failed)
        #expect(kept.openAIKey == "sk-fail", "a secret the Keychain refused must not be dropped")
        #expect(kept.groqKey.isEmpty, "secrets that did persist are still scrubbed")
        #expect(s.scrubbedOfSecrets(keeping: []).plaintextSecretLabels.isEmpty)
    }
}
