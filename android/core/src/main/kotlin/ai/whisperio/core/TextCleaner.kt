package ai.whisperio.core

/**
 * Deterministic transcript tidy-up: spacing, punctuation gaps, sentence casing.
 * Verbatim port of `mobile/WhisperioApp/Sources/WhisperioApp/Engine/TextCleaner.swift`
 * (including its quirks, e.g. "3.14" becomes "3. 14").
 */
object TextCleaner {
    private val spaceRuns = Regex("[ \\t]+")
    private val spaceBeforePunct = Regex("(?U)\\s+([,.;:!?])")
    private val missingSpaceAfter = Regex("(?U)([,.;:!?])(\\S)")
    private val trailingSpaces = Regex(" +\\n")

    fun tidy(raw: String): String {
        var t = raw.trim()
        if (t.isEmpty()) return t

        t = spaceRuns.replace(t, " ")
        t = spaceBeforePunct.replace(t, "\$1")
        t = missingSpaceAfter.replace(t, "\$1 \$2")
        t = trailingSpaces.replace(t, "\n")

        t = capitalizeSentences(t)
        if (t.first().isLetter()) t = t.first().uppercase() + t.drop(1)
        if (t.last() !in ".!?") t += "."
        return t
    }

    private fun capitalizeSentences(s: String): String {
        val result = StringBuilder(s.length)
        var capitalizeNext = false
        for (ch in s) {
            if (capitalizeNext && ch.isLetter()) {
                result.append(ch.uppercase())
                capitalizeNext = false
            } else {
                result.append(ch)
            }
            if (ch in ".!?") capitalizeNext = true
        }
        return result.toString()
    }
}
