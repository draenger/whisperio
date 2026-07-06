import Foundation
import Combine
import WhisperioKit

// Persisted digest/categorization prompts — the runtime-editable wording of the classification and
// daily-summary prompts. Stored as JSON in UserDefaults, mirroring SettingsStore / PresetStore's
// discipline: tolerant decode on load (a missing field falls back to its shipped default), save on
// every mutation, one stable key. Ships seeded with DigestPromptConfig.default (the original prompts
// verbatim), so a fresh install and an untouched config produce exactly the prompts the app always
// sent — the externalization only adds the ability to tune them without a rebuild.
@MainActor
final class DigestPromptStore: ObservableObject {
    /// The live prompt config the digest engine reads. Every write re-saves.
    @Published var config: DigestPromptConfig { didSet { save() } }

    private static let key = "whisperio.digestPrompts.v1"

    init() {
        var loaded = DigestPromptConfig.default
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let c = try? JSONDecoder().decode(DigestPromptConfig.self, from: data) {
            loaded = c
        }
        config = loaded
    }

    /// Restore the shipped prompts, discarding the user's edits.
    func restoreDefaults() {
        config = .default
    }

    /// Whether the current config still matches the shipped defaults (drives the "restore" affordance).
    var isDefault: Bool { config == .default }

    private func save() {
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: Self.key)
        }
    }
}
