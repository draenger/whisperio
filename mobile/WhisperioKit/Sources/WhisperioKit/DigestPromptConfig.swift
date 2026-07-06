import Foundation

// Digest prompt config — the runtime-editable text of the two categorization/journaling prompts.
// The instruction prose used to live as compile-time constants inside DigestPromptBuilder; it now
// lives here as a value type the app persists (see DigestPromptStore) so the user can tune the
// wording without a rebuild. Ships with a `.default` seed that reproduces the original prompts
// verbatim — so with no edits the built prompts are byte-for-byte what they always were.
//
// Only the *prose* is configurable; the structural scaffolding the builder assembles (the category
// list, the per-note lines, the "## <group>" headers) stays in code so the prompt can never lose the
// data the model needs. Two tokens are substituted at build time: `{date}` in the summary intro and
// `{locale}` in the summary instruction.
public struct DigestPromptConfig: Codable, Sendable, Equatable {
    /// Opening line of the classification prompt (before the category + note lists).
    public var classificationIntro: String
    /// Trailing instruction of the classification prompt (the "return a single JSON object…" ask).
    public var classificationInstruction: String
    /// Opening line of the summary prompt. `{date}` is replaced with the day (YYYY-MM-DD).
    public var summaryIntro: String
    /// Trailing instruction of the summary prompt. `{locale}` is replaced with the interface locale.
    public var summaryInstruction: String

    public init(
        classificationIntro: String = Defaults.classificationIntro,
        classificationInstruction: String = Defaults.classificationInstruction,
        summaryIntro: String = Defaults.summaryIntro,
        summaryInstruction: String = Defaults.summaryInstruction
    ) {
        self.classificationIntro = classificationIntro
        self.classificationInstruction = classificationInstruction
        self.summaryIntro = summaryIntro
        self.summaryInstruction = summaryInstruction
    }

    // Tolerant decoding — a legacy/partial blob (e.g. persisted before a field existed, or hand-edited
    // to drop one) falls back to that field's shipped default instead of throwing, so a stored config
    // is never lost and a missing field never yields an empty prompt.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        classificationIntro = try c.decodeIfPresent(String.self, forKey: .classificationIntro) ?? Defaults.classificationIntro
        classificationInstruction = try c.decodeIfPresent(String.self, forKey: .classificationInstruction) ?? Defaults.classificationInstruction
        summaryIntro = try c.decodeIfPresent(String.self, forKey: .summaryIntro) ?? Defaults.summaryIntro
        summaryInstruction = try c.decodeIfPresent(String.self, forKey: .summaryInstruction) ?? Defaults.summaryInstruction
    }

    /// The shipped defaults — reproduce the original hardcoded prompts verbatim.
    public static let `default` = DigestPromptConfig()

    /// The seed strings, kept separately so both the memberwise init's defaults and the tolerant
    /// decode fall back to the same source of truth.
    public enum Defaults {
        public static let classificationIntro =
            "You are classifying short voice-note transcripts into categories."
        public static let classificationInstruction =
            "Return only a single JSON object mapping each note id to exactly one category id, "
            + "e.g. {\"<noteId>\":\"<categoryId>\"}. Use \"uncategorized\" when no category fits. "
            + "Do not add commentary, keys, or notes that were not listed."
        public static let summaryIntro =
            "You are writing a concise daily digest of a person's voice notes for {date}."
        public static let summaryInstruction =
            "Write a short, well-structured summary of the day grouped by the sections above, "
            + "capturing key points and any action items. Do not invent details that are not in the notes. "
            + "Answer in the same language as the transcripts themselves — never translate them "
            + "(the interface locale is {locale} but the notes' language wins). Return only the summary."
    }
}
