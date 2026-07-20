import Testing
import Foundation
@testable import WhisperioKit

struct RewritePresetTests {
    // Every seed carries a stable id and a real (non-empty) prompt — these ids are persisted on
    // recordings (Recording.renderPresetID), so an empty or duplicated one would be a bug.
    @Test func seedsHaveStableIDsAndPrompts() {
        let ids = RewritePresetCatalog.seeds.map(\.id)
        #expect(Set(ids).count == ids.count)   // no duplicate ids
        for seed in RewritePresetCatalog.seeds {
            #expect(!seed.id.isEmpty)
            #expect(!seed.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            #expect(seed.isSeed)
        }
        // Exactly one meta preset (the template builder).
        #expect(RewritePresetCatalog.seeds.filter(\.isMeta).count == 1)
        #expect(RewritePresetCatalog.seeds.contains { $0.id == "template-builder" && $0.isMeta })
    }

    // Seeds match the design's REWRITE_PRESETS exactly: 6 presets, in this name/order
    // (mob-settings.jsx:9-16) — R8.
    @Test func seedsMatchDesignCatalog() {
        let names = RewritePresetCatalog.seeds.map(\.name)
        #expect(names == ["Clean up", "Bullet points", "Email reply", "Action items", "Summary", "Template Builder"])
        #expect(RewritePresetCatalog.seeds.count == 6)
    }

    // resolved() folds seeds + user presets into one display list.
    @Test func resolvedIncludesSeedsAndUserPresets() {
        let mine = RewritePreset(id: "mine", name: "Mine", prompt: "Do a thing.", icon: "spark")
        let state = RewritePresetState(userPresets: [mine])
        let out = RewritePresetCatalog.resolved(state)
        #expect(out.count == RewritePresetCatalog.seeds.count + 1)
        #expect(out.contains { $0.id == "clean-up" })
        #expect(out.contains { $0.id == "mine" })
        // User presets come after the seeds.
        #expect(out.last?.id == "mine")
    }

    // Deleting a seed tombstones it (gone from resolved), and restoreDefaults brings it back.
    @Test func deleteSeedTombstonesAndRestoreReadds() {
        var state = RewritePresetState()
        state = RewritePresetCatalog.afterDelete(id: "email", state)
        #expect(state.removedSeedIDs.contains("email"))
        #expect(!RewritePresetCatalog.resolved(state).contains { $0.id == "email" })

        state = RewritePresetCatalog.restoreDefaults(state)
        #expect(RewritePresetCatalog.resolved(state).contains { $0.id == "email" })
    }

    // Deleting a user preset removes only it; restore leaves the other user preset intact.
    @Test func deleteUserPresetRemovesItAndRestoreKeepsOthers() {
        let a = RewritePreset(id: "a", name: "A", prompt: "A prompt.", icon: "spark")
        let b = RewritePreset(id: "b", name: "B", prompt: "B prompt.", icon: "spark")
        var state = RewritePresetState(userPresets: [a, b])
        state = RewritePresetCatalog.afterDelete(id: "a", state)
        #expect(!RewritePresetCatalog.resolved(state).contains { $0.id == "a" })
        #expect(RewritePresetCatalog.resolved(state).contains { $0.id == "b" })

        // Restore only touches the seed layers — the surviving user preset stays.
        state = RewritePresetCatalog.restoreDefaults(state)
        #expect(state.userPresets.map(\.id) == ["b"])
    }

    // restoreDefaults must not duplicate seeds and must keep user presets.
    @Test func restoreDoesNotDuplicateSeedsAndKeepsUserPreset() {
        let mine = RewritePreset(id: "mine", name: "Mine", prompt: "Do a thing.", icon: "spark")
        var state = RewritePresetState(userPresets: [mine])
        state = RewritePresetCatalog.afterDelete(id: "summary", state)
        state = RewritePresetCatalog.restoreDefaults(state)

        let out = RewritePresetCatalog.resolved(state)
        let ids = out.map(\.id)
        #expect(Set(ids).count == ids.count)   // no dupes
        #expect(out.count == RewritePresetCatalog.seeds.count + 1)
        #expect(out.contains { $0.id == "mine" })
    }

    // Editing a seed stores an override that preserves the id and applies in resolved().
    @Test func editSeedCreatesOverridePreservingID() {
        var edited = RewritePresetCatalog.seeds.first { $0.id == "clean-up" }!
        edited.name = "Tidy up"
        edited.prompt = "New prompt."
        var state = RewritePresetState()
        state = RewritePresetCatalog.afterUpsert(edited, state)

        #expect(state.userPresets.isEmpty)             // not treated as a user preset
        #expect(state.seedOverrides["clean-up"] != nil)
        let resolved = RewritePresetCatalog.resolved(state).first { $0.id == "clean-up" }!
        #expect(resolved.name == "Tidy up")
        #expect(resolved.prompt == "New prompt.")
        #expect(resolved.id == "clean-up")             // id preserved
    }

    // Editing a tombstoned seed resurrects it (upsert clears the tombstone).
    @Test func upsertSeedResurrectsTombstone() {
        var state = RewritePresetState()
        state = RewritePresetCatalog.afterDelete(id: "action-items", state)
        var edited = RewritePresetCatalog.seeds.first { $0.id == "action-items" }!
        edited.name = "To-dos"
        state = RewritePresetCatalog.afterUpsert(edited, state)
        #expect(!state.removedSeedIDs.contains("action-items"))
        #expect(RewritePresetCatalog.resolved(state).contains { $0.id == "action-items" && $0.name == "To-dos" })
    }

    // The full persisted state round-trips through Codable.
    @Test func stateCodableRoundtrips() throws {
        let mine = RewritePreset(id: "mine", name: "Mine", prompt: "Do a thing.", icon: "spark")
        var state = RewritePresetState(userPresets: [mine])
        state = RewritePresetCatalog.afterDelete(id: "email", state)
        var edited = RewritePresetCatalog.seeds.first { $0.id == "clean-up" }!
        edited.prompt = "Edited."
        state = RewritePresetCatalog.afterUpsert(edited, state)

        let data = try JSONEncoder().encode(state)
        let decoded = try JSONDecoder().decode(RewritePresetState.self, from: data)
        #expect(decoded == state)
        #expect(decoded.removedSeedIDs.contains("email"))
        #expect(decoded.seedOverrides["clean-up"]?.prompt == "Edited.")
        #expect(decoded.userPresets.map(\.id) == ["mine"])
    }

    // A user preset persisted before `isMeta` existed still decodes (tolerant Codable).
    @Test func legacyPresetWithoutIsMetaDecodes() throws {
        let legacy = """
        { "id": "old", "name": "Old", "prompt": "p", "icon": "spark", "isSeed": false }
        """.data(using: .utf8)!
        let p = try JSONDecoder().decode(RewritePreset.self, from: legacy)
        #expect(p.isMeta == false)
        #expect(p.id == "old")
    }

    // promptBuilder trims both sides and guards an empty transcript with an empty user message.
    @Test func promptBuilderTrimsAndGuards() {
        let preset = RewritePreset(id: "x", name: "X", prompt: "  Rewrite it.  ", icon: "spark")
        let m = RewritePromptBuilder.messages(preset: preset, transcript: "\n  hello  \n")
        #expect(m.system == "Rewrite it.")
        #expect(m.user == "hello")

        let empty = RewritePromptBuilder.messages(preset: preset, transcript: "   \n\t ")
        #expect(empty.user.isEmpty)
        #expect(empty.system == "Rewrite it.")
    }
}
