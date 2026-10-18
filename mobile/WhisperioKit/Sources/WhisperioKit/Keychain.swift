import Foundation
import Security

/// Minimal Keychain wrapper for BYO API secrets that must never sit in `UserDefaults`
/// (which is unencrypted and included in plaintext device backups).
///
/// Items are `kSecClassGenericPassword`, accessibility
/// `WhenUnlockedThisDeviceOnly` — hardware-encrypted, not synced to iCloud, and excluded
/// from unencrypted iTunes/Finder backups. Used for every BYO secret in `WhisperioSettings`
/// (see `WhisperioSettings.secretFields` — the single list SettingsStore persists through).
public enum Keychain {
    public enum Item: String, Sendable {
        case openAIKey = "whisperio.key.openai"
        case elevenLabsKey = "whisperio.key.elevenlabs"
        case groqKey = "whisperio.key.groq"
        case deepgramKey = "whisperio.key.deepgram"
        case assemblyAIKey = "whisperio.key.assemblyai"
        case mistralKey = "whisperio.key.mistral"
        case githubToken = "whisperio.key.github"
        case replicateKey = "whisperio.key.replicate"
        case selfHostedKey = "whisperio.key.selfhosted"
    }

    private static let service = "ai.whisperio.mobile.secrets"

    private static func base(_ item: Item, dataProtection: Bool = true) -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: item.rawValue,
        ]
        #if os(macOS)
        // On macOS the accessibility class is only honored by the data-protection keychain; the
        // legacy login keychain silently ignores it. Used for add/query/delete alike so items
        // are found where they were written. `dataProtection: false` addresses the legacy login
        // keychain, where items written by earlier builds still live (migrated on first read).
        if dataProtection { q[kSecUseDataProtectionKeychain as String] = true }
        #endif
        return q
    }

    /// Store (or replace) a secret. Passing an empty string removes the item — an empty key
    /// means "no secret", so there's nothing to protect.
    @discardableResult
    public static func set(_ value: String, for item: Item) -> Bool {
        SecItemDelete(base(item) as CFDictionary)   // simplest upsert: delete then add
        #if os(macOS)
        SecItemDelete(base(item, dataProtection: false) as CFDictionary)   // never leave a stale legacy copy
        #endif
        guard !value.isEmpty, let data = value.data(using: .utf8) else { return true }
        var add = base(item)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    /// Read a secret. Returns nil when no item is stored.
    public static func get(_ item: Item) -> String? {
        if let s = read(base(item)) { return s }
        #if os(macOS)
        // Miss in the data-protection keychain: earlier builds wrote to the legacy login
        // keychain. Migrate: copy into the data-protection keychain, and only after that add
        // succeeded remove the legacy copy. If the add fails, still return the legacy value.
        let legacy = base(item, dataProtection: false)
        guard let s = read(legacy), let data = s.data(using: .utf8) else { return nil }
        var add = base(item)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        if SecItemAdd(add as CFDictionary, nil) == errSecSuccess {
            SecItemDelete(legacy as CFDictionary)
        }
        return s
        #else
        return nil
        #endif
    }

    private static func read(_ query: [String: Any]) -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data,
              let s = String(data: data, encoding: .utf8) else { return nil }
        return s
    }

    @discardableResult
    public static func remove(_ item: Item) -> Bool {
        let st = SecItemDelete(base(item) as CFDictionary)
        var ok = st == errSecSuccess || st == errSecItemNotFound
        #if os(macOS)
        // Also drop any not-yet-migrated copy in the legacy login keychain.
        let legacy = SecItemDelete(base(item, dataProtection: false) as CFDictionary)
        ok = ok && (legacy == errSecSuccess || legacy == errSecItemNotFound)
        #endif
        return ok
    }
}
