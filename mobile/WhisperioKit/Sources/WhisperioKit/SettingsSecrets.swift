import Foundation

/// The secret fields of `WhisperioSettings` and the Keychain item each one is persisted under.
///
/// Single source of truth for the app's `SettingsStore`: load hydrates every field from the
/// Keychain, save writes every field to the Keychain and blanks it in the UserDefaults JSON.
/// `SettingsSecretsTests` checks by reflection that every `*Key` / `*Token` string property of
/// `WhisperioSettings` is listed here, so a new BYO secret cannot slip into plaintext storage
/// again (2026-10-16: `replicateKey` and `selfHostedKey` had, for months).
extension WhisperioSettings {
    /// `@unchecked`: a key path and an enum case are immutable values; Swift 6 only lacks the
    /// conditional `Sendable` conformance for `WritableKeyPath` here.
    public struct SecretField: @unchecked Sendable {
        public let label: String
        public let path: WritableKeyPath<WhisperioSettings, String>
        public let item: Keychain.Item
    }

    public static let secretFields: [SecretField] = [
        SecretField(label: "openAIKey", path: \.openAIKey, item: .openAIKey),
        SecretField(label: "elevenLabsKey", path: \.elevenLabsKey, item: .elevenLabsKey),
        SecretField(label: "groqKey", path: \.groqKey, item: .groqKey),
        SecretField(label: "deepgramKey", path: \.deepgramKey, item: .deepgramKey),
        SecretField(label: "assemblyAIKey", path: \.assemblyAIKey, item: .assemblyAIKey),
        SecretField(label: "mistralKey", path: \.mistralKey, item: .mistralKey),
        SecretField(label: "replicateKey", path: \.replicateKey, item: .replicateKey),
        SecretField(label: "selfHostedKey", path: \.selfHostedKey, item: .selfHostedKey),
        SecretField(label: "githubToken", path: \.githubToken, item: .githubToken),
    ]

    /// Copy with every secret blanked — the only shape that may be written to UserDefaults.
    public func scrubbedOfSecrets() -> WhisperioSettings {
        var copy = self
        for field in Self.secretFields { copy[keyPath: field.path] = "" }
        return copy
    }

    /// Copy with every secret blanked EXCEPT those in `keeping` (labels) — used when a Keychain
    /// write failed, so the only remaining copy of that secret is not discarded.
    public func scrubbedOfSecrets(keeping: Set<String>) -> WhisperioSettings {
        var copy = self
        for field in Self.secretFields where !keeping.contains(field.label) { copy[keyPath: field.path] = "" }
        return copy
    }

    /// Labels of the secrets that currently hold a value in this struct. On a freshly decoded
    /// UserDefaults blob a non-empty list means an older build persisted plaintext secrets and a
    /// migration (persist to Keychain + rewrite the blob scrubbed) is due.
    public var plaintextSecretLabels: [String] {
        Self.secretFields.filter { !self[keyPath: $0.path].isEmpty }.map(\.label)
    }

    /// Replace each secret with the Keychain copy when one exists; a secret the Keychain does not
    /// have keeps its current (legacy) value so nothing is lost across the migration.
    public mutating func hydrateSecrets(read: (Keychain.Item) -> String?) {
        for field in Self.secretFields {
            if let stored = read(field.item) { self[keyPath: field.path] = stored }
        }
    }

    /// Hand every secret to the Keychain writer (an empty value removes the item).
    public func persistSecrets(write: (String, Keychain.Item) -> Void) {
        for field in Self.secretFields { write(self[keyPath: field.path], field.item) }
    }

    /// Like `persistSecrets`, but the writer reports success and the labels of the secrets whose
    /// write FAILED are returned, so the caller can avoid scrubbing them from the fallback copy.
    public func persistSecretsReportingFailures(write: (String, Keychain.Item) -> Bool) -> Set<String> {
        var failed: Set<String> = []
        for field in Self.secretFields where !write(self[keyPath: field.path], field.item) {
            failed.insert(field.label)
        }
        return failed
    }
}
