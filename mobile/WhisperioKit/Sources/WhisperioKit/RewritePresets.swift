import Foundation

// Rewrite presets — the catalog of AI "render" instructions the app applies to a transcript
// to produce a formatted output (clean-up, email, bullet summary…). Modeled on the app's
// WZCategories seed pattern, but lives in the kit so the catalog + edit algebra stay pure and
// unit-testable. UI (icons via WIcon, screens) lives in the app target; here `icon` is just a
// stable WIcon key string.
//
// Editing model: seeds ship read-only, but the user may delete, edit, or add presets. We never
// mutate the seed array — instead the persisted RewritePresetState layers user intent over the
// seeds: `removedSeedIDs` tombstones a deleted seed, `seedOverrides` carries an edited copy
// (same id), and `userPresets` holds brand-new ones. `resolved(_:)` folds all three back into
// the display list, and `restoreDefaults(_:)` drops the seed layers while keeping user presets.

/// One rewrite instruction. `isSeed` marks a built-in; `isMeta` marks the single
/// template-builder preset (it authors new templates rather than rewriting a transcript).
public struct RewritePreset: Identifiable, Codable, Sendable, Equatable {
    public let id: String
    public var name: String
    public var prompt: String
    public var icon: String   // WIcon key → SF Symbol (resolved in the app target)
    public let isSeed: Bool
    public var isMeta: Bool

    public init(id: String, name: String, prompt: String, icon: String, isSeed: Bool = false, isMeta: Bool = false) {
        self.id = id
        self.name = name
        self.prompt = prompt
        self.icon = icon
        self.isSeed = isSeed
        self.isMeta = isMeta
    }

    // Tolerant decoding — missing keys (older persisted presets, or future-added fields like
    // `isMeta`) fall back to defaults instead of throwing, so a stored user preset is never lost.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        prompt = try c.decodeIfPresent(String.self, forKey: .prompt) ?? ""
        icon = try c.decodeIfPresent(String.self, forKey: .icon) ?? "spark"
        isSeed = try c.decodeIfPresent(Bool.self, forKey: .isSeed) ?? false
        isMeta = try c.decodeIfPresent(Bool.self, forKey: .isMeta) ?? false
    }
}

/// The persisted layers of user intent over the read-only seeds (see RewritePresetCatalog).
public struct RewritePresetState: Codable, Sendable, Equatable {
    /// Brand-new presets the user authored.
    public var userPresets: [RewritePreset]
    /// Ids of seeds the user deleted (tombstones — hidden until restoreDefaults).
    public var removedSeedIDs: Set<String>
    /// Edited copies of seeds, keyed by (unchanged) seed id.
    public var seedOverrides: [String: RewritePreset]

    public init(
        userPresets: [RewritePreset] = [],
        removedSeedIDs: Set<String> = [],
        seedOverrides: [String: RewritePreset] = [:]
    ) {
        self.userPresets = userPresets
        self.removedSeedIDs = removedSeedIDs
        self.seedOverrides = seedOverrides
    }

    // Tolerant decoding — a legacy blob missing any layer decodes to its empty default.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userPresets = try c.decodeIfPresent([RewritePreset].self, forKey: .userPresets) ?? []
        removedSeedIDs = try c.decodeIfPresent(Set<String>.self, forKey: .removedSeedIDs) ?? []
        seedOverrides = try c.decodeIfPresent([String: RewritePreset].self, forKey: .seedOverrides) ?? [:]
    }
}

/// The built-in rewrite presets + the pure edit algebra over RewritePresetState.
public enum RewritePresetCatalog {
    /// The seed catalog, in display order. Prompts are authored verbatim; ids are stable keys —
    /// this list mirrors the design's `REWRITE_PRESETS` (mob-settings.jsx:9-16) exactly: 6
    /// presets, same names/icons/order. "Bullet summary"→"Bullet points" and "Email"→"Email
    /// reply" keep their old ids (`bullets`/`email`) so existing recordings' `renderPresetID`
    /// still resolves; "Action items"/"Summary" are new. "Message in English"/"Slack message"/
    /// "Tweet" are intentionally dropped — the design doesn't ship them and Template Builder
    /// lets a user recreate any of them in seconds.
    public static let seeds: [RewritePreset] = [
        RewritePreset(
            id: "clean-up",
            name: "Clean up",
            prompt: "You are a transcript editor. Rewrite the text below so it reads cleanly: fix punctuation, capitalization, and obvious speech-to-text errors, remove filler words (um, uh, you know, like), and merge false starts. Do not change the meaning, add information, or summarize. Keep the original language. Return only the cleaned text.",
            icon: "spark",
            isSeed: true
        ),
        RewritePreset(
            id: "bullets",
            name: "Bullet points",
            prompt: "Summarize the following into 3-6 concise bullet points capturing the key points and any action items. Start each bullet with '- '. Do not add information that isn't in the text. Keep the original language. Return only the bullet list.",
            icon: "list",
            isSeed: true
        ),
        RewritePreset(
            id: "email",
            name: "Email reply",
            prompt: "Turn the following spoken notes into a clear, polite email. Infer a suitable subject line and put it on the first line prefixed with 'Subject: '. Use a natural greeting and sign-off, group the content into short paragraphs, and keep every fact from the notes without inventing details. Match the language of the notes. Return only the email.",
            icon: "message",
            isSeed: true
        ),
        RewritePreset(
            id: "action-items",
            name: "Action items",
            prompt: "Extract every actionable task from the following spoken notes into a short checklist. Start each line with '- ' followed by a clear, concrete task, naming who does it if the notes say so. Skip anything that isn't an action — no commentary, context, or summary. If the notes contain no clear action items, return a single line saying so, in the notes' own language. Do not invent tasks that aren't implied by the text. Keep the original language. Return only the checklist.",
            icon: "check",
            isSeed: true
        ),
        RewritePreset(
            id: "summary",
            name: "Summary",
            prompt: "Summarize the following spoken notes into a short, well-structured paragraph of 3-5 sentences capturing the key points a listener would need to know. Do not add information that isn't in the notes, and do not format it as a list, email, or checklist. Keep the original language. Return only the summary.",
            icon: "book",
            isSeed: true
        ),
        RewritePreset(
            id: "template-builder",
            name: "Template Builder",
            prompt: "You help the user author a new Whisperio rewrite template. The user's message describes, in plain words, a format they want their voice notes turned into. Produce a single reusable instruction prompt (a 'template') that Whisperio can later apply to any transcript to produce that format. The template you write must: address the model directly, tell it to return only the rewritten text, tell it to preserve the input's language unless the format requires a specific language, and tell it not to invent facts. Output only the template prompt text, with no preamble, quotes, or commentary.",
            icon: "zap",
            isSeed: true,
            isMeta: true
        ),
    ]

    /// A seed looked up by id (nil for user presets).
    private static let seedsByID: [String: RewritePreset] =
        Dictionary(uniqueKeysWithValues: seeds.map { ($0.id, $0) })

    /// The presets to show, in order: surviving seeds (with any edits applied) then user presets.
    public static func resolved(_ state: RewritePresetState) -> [RewritePreset] {
        var out: [RewritePreset] = []
        for seed in seeds where !state.removedSeedIDs.contains(seed.id) {
            out.append(state.seedOverrides[seed.id] ?? seed)
        }
        out.append(contentsOf: state.userPresets)
        return out
    }

    /// Delete a preset: a seed is tombstoned (and any edit dropped); a user preset is removed.
    public static func afterDelete(id: String, _ state: RewritePresetState) -> RewritePresetState {
        var s = state
        if seedsByID[id] != nil {
            s.removedSeedIDs.insert(id)
            s.seedOverrides[id] = nil
        } else {
            s.userPresets.removeAll { $0.id == id }
        }
        return s
    }

    /// Insert or update a preset: editing a seed stores an override (same id, resurrecting it if
    /// tombstoned); a user preset is replaced in place, or appended when it's new.
    public static func afterUpsert(_ preset: RewritePreset, _ state: RewritePresetState) -> RewritePresetState {
        var s = state
        if seedsByID[preset.id] != nil {
            s.seedOverrides[preset.id] = preset
            s.removedSeedIDs.remove(preset.id)
        } else if let idx = s.userPresets.firstIndex(where: { $0.id == preset.id }) {
            s.userPresets[idx] = preset
        } else {
            s.userPresets.append(preset)
        }
        return s
    }

    /// Restore the seeds to factory state (un-delete + drop edits) while keeping user presets.
    public static func restoreDefaults(_ state: RewritePresetState) -> RewritePresetState {
        var s = state
        s.removedSeedIDs = []
        s.seedOverrides = [:]
        return s
    }
}

/// Builds the (system, user) message pair a ChatLLM applies to run a rewrite preset.
public enum RewritePromptBuilder {
    /// The preset's prompt becomes the system message; the transcript the user message. Both are
    /// trimmed; an empty/whitespace-only transcript yields an empty user message so callers can
    /// guard (there's nothing to rewrite).
    public static func messages(preset: RewritePreset, transcript: String) -> (system: String, user: String) {
        let system = preset.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let user = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        return (system: system, user: user)
    }
}
