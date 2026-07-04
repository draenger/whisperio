import Foundation

// Digest prompts — the pure text builders for the two batched LLM calls the daily digest makes:
// one to classify a day's notes into categories, and one to summarize the grouped day. The kit
// stays networking-free (the app target runs these through a ChatLLM); here we only assemble the
// prompt string. Both builders make a single batched call so the digest costs one round-trip each.

public enum DigestPromptBuilder {
    /// Build the classification prompt: given the day's notes and the available categories, ask the
    /// model to return a single JSON object mapping each note id (string) to a category id. One
    /// batched call classifies every note at once. The model is told to use "uncategorized" when
    /// nothing fits and to return only the JSON object.
    public static func classificationPrompt(
        notes: [(id: UUID, text: String)],
        categories: [(id: String, label: String)]
    ) -> String {
        var lines: [String] = []
        lines.append("You are classifying short voice-note transcripts into categories.")
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
        lines.append("Return only a single JSON object mapping each note id to exactly one category id, "
            + "e.g. {\"<noteId>\":\"<categoryId>\"}. Use \"uncategorized\" when no category fits. "
            + "Do not add commentary, keys, or notes that were not listed.")
        return lines.joined(separator: "\n")
    }

    /// Build the daily-summary prompt: given the day and its category groups (label + the notes'
    /// text), ask the model for a concise digest of the day. One batched call summarizes everything.
    /// The model is told to answer in the same language as the transcripts (never translate).
    public static func summaryPrompt(
        day: Date,
        groups: [(label: String, notes: [String])],
        locale: String
    ) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        let dayString = formatter.string(from: day)

        var lines: [String] = []
        lines.append("You are writing a concise daily digest of a person's voice notes for \(dayString).")
        lines.append("")
        for group in groups {
            lines.append("## \(group.label)")
            for note in group.notes {
                let text = note.trimmingCharacters(in: .whitespacesAndNewlines)
                lines.append("- \(text)")
            }
            lines.append("")
        }
        lines.append("Write a short, well-structured summary of the day grouped by the sections above, "
            + "capturing key points and any action items. Do not invent details that are not in the notes. "
            + "Answer in the same language as the transcripts themselves — never translate them "
            + "(the interface locale is \(locale) but the notes' language wins). Return only the summary.")
        return lines.joined(separator: "\n")
    }
}
