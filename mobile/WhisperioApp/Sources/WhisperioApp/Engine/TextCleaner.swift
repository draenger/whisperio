import Foundation

// Deterministic transcript tidy-up — fixes spacing, punctuation gaps and sentence
// casing. Works offline on any device (no model / Apple Intelligence required).
enum TextCleaner {
    static func tidy(_ raw: String) -> String {
        var t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return t }

        func sub(_ pattern: String, _ replacement: String) {
            t = t.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
        }

        sub("[ \\t]+", " ")                       // collapse runs of spaces/tabs
        sub("\\s+([,.;:!?])", "$1")               // no space before punctuation
        sub("([,.;:!?])(\\S)", "$1 $2")           // ensure a space after punctuation
        sub(" +\\n", "\n")                         // trim trailing spaces on lines

        t = capitalizeSentences(t)
        if let first = t.first, first.isLetter {
            t = first.uppercased() + t.dropFirst()
        }
        if let last = t.last, !".!?".contains(last) { t += "." }
        return t
    }

    private static func capitalizeSentences(_ s: String) -> String {
        var result = ""
        var capitalizeNext = false
        for ch in s {
            if capitalizeNext, ch.isLetter {
                result += ch.uppercased()
                capitalizeNext = false
            } else {
                result.append(ch)
            }
            if ".!?".contains(ch) { capitalizeNext = true }
        }
        return result
    }
}
