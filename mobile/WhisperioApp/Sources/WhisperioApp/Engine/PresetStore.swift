import Foundation
import Combine
import WhisperioKit

// Persisted rewrite presets — the user's layered edits over the built-in seed catalog (see
// RewritePresetCatalog). Stored as JSON in UserDefaults, mirroring SettingsStore's discipline:
// tolerant decode on load, save on every mutation, one stable key.
@MainActor
final class PresetStore: ObservableObject {
    /// The resolved display list (surviving seeds with any edits applied, then the user's own
    /// presets), rebuilt on every state change so views bind straight to it.
    @Published private(set) var presets: [RewritePreset] = []

    /// The persisted layers of user intent; every write re-saves and re-resolves.
    private var state: RewritePresetState {
        didSet { save(); presets = RewritePresetCatalog.resolved(state) }
    }

    private static let key = "whisperio.presets.v1"

    init() {
        var loaded = RewritePresetState()
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let s = try? JSONDecoder().decode(RewritePresetState.self, from: data) {
            loaded = s
        }
        // Property observers don't fire in init, so seed the published list explicitly.
        state = loaded
        presets = RewritePresetCatalog.resolved(loaded)
    }

    /// Insert or update a preset — editing a seed stores an override (same id), a user preset is
    /// replaced in place or appended when new.
    func upsert(_ preset: RewritePreset) {
        state = RewritePresetCatalog.afterUpsert(preset, state)
    }

    /// Delete a preset — a seed is tombstoned (hidden until restoreDefaults), a user preset removed.
    func delete(id: String) {
        state = RewritePresetCatalog.afterDelete(id: id, state)
    }

    /// Restore the built-in seeds to factory state (un-delete + drop edits) while keeping the
    /// user's own presets.
    func restoreDefaults() {
        state = RewritePresetCatalog.restoreDefaults(state)
    }

    private func save() {
        if let data = try? JSONEncoder().encode(state) {
            UserDefaults.standard.set(data, forKey: Self.key)
        }
    }
}
