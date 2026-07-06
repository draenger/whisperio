import Foundation

// Digest prompts — the pure text builders for the two batched LLM calls the daily digest makes:
// one to classify a day's notes into categories, and one to summarize the grouped day. The kit
// stays networking-free (the app target runs these through a ChatLLM); here we only assemble the
// prompt string. Both builders make a single batched call so the digest costs one round-trip each.
//
// The instruction *prose* is no longer hardcoded here: it comes from a DigestPromptConfig (defaulting
// to `.default`, which reproduces the original wording verbatim) so the app can persist a user-edited
// copy. This file still owns the structural scaffolding (category list, per-note lines, group
// headers) so an edited config can never strip the data the model needs.

public enum DigestPromptBuilder {
    /// Build the classification prompt: given the day's notes and the available categories, ask the
    /// model to return a single JSON object mapping each note id (string) to a category id. One
    /// batched call classifies every note at once. The intro + trailing instruction come from
    /// `config` (default: the shipped prompt); the category/note scaffolding is assembled here.
    public static func classificationPrompt(
        notes: [(id: UUID, text: String)],
        categories: [(id: String, label: String)],
        config: DigestPromptConfig = .default
    ) -> String {
        var lines: [String] = []
        lines.append(config.classificationIntro)
        lines.append("")
        lines.append("Categories (id — label):")
        for cat in categories {
            lines.append("- \(cat.id) — \(cat.label)")
        }
        lines.append("- uncategorized — none of the above")
        lines.append("")
        lines.append("Notes (id: text):")
        for note in notes {
            let text = note.text.trimmingCharacters(in: .whitespacesAndNewlines)
            lines.append("- \(note.id.uuidString): \(text)")
        }
        lines.append("")
        lines.append(config.classificationInstruction)
        return lines.joined(separator: "\n")
    }

    /// Build the daily-summary prompt: given the day and its category groups (label + the notes'
    /// text), ask the model for a concise digest of the day. One batched call summarizes everything.
    /// The intro + trailing instruction come from `config` (default: the shipped prompt); `{date}`
    /// and `{locale}` tokens in those are substituted here.
    public static func summaryPrompt(
        day: Date,
        groups: [(label: String, notes: [String])],
        locale: String,
        config: DigestPromptConfig = .default
    ) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        let dayString = formatter.string(from: day)

        var lines: [String] = []
        lines.append(config.summaryIntro.replacingOccurrences(of: "{date}", with: dayString))
        lines.append("")
        for group in groups {
            lines.append("## \(group.label)")
            for note in group.notes {
                let text = note.trimmingCharacters(in: .whitespacesAndNewlines)
                lines.append("- \(text)")
            }
            lines.append("")
        }
        lines.append(config.summaryInstruction.replacingOccurrences(of: "{locale}", with: locale))
        return lines.joined(separator: "\n")
    }
}
