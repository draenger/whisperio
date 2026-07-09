import Foundation
import Security

/// Minimal Keychain wrapper for BYO API secrets that must never sit in `UserDefaults`
/// (which is unencrypted and included in plaintext device backups).
///
/// Items are `kSecClassGenericPassword`, accessibility
/// `WhenUnlockedThisDeviceOnly` — hardware-encrypted, not synced to iCloud, and excluded
/// from unencrypted iTunes/Finder backups. Used for the OpenAI / ElevenLabs keys.
public enum Keychain {
    public enum Item: String {
        case openAIKey = "whisperio.key.openai"
        case elevenLabsKey = "whisperio.key.elevenlabs"
        case githubToken = "whisperio.key.github"
    }

    private static let service = "ai.whisperio.mobile.secrets"

    private static func base(_ item: Item) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: item.rawValue,
        ]
    }

    /// Store (or replace) a secret. Passing an empty string removes the item — an empty key
    /// means "no secret", so there's nothing to protect.
    @discardableResult
    public static func set(_ value: String, for item: Item) -> Bool {
        SecItemDelete(base(item) as CFDictionary)   // simplest upsert: delete then add
        guard !value.isEmpty, let data = value.data(using: .utf8) else { return true }
        var add = base(item)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    /// Read a secret. Returns nil when no item is stored.
    public static func get(_ item: Item) -> String? {
        var q = base(item)
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
        return st == errSecSuccess || st == errSecItemNotFound
    }
}
