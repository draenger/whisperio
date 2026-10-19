package ai.whisperio.core

/** Counts maximal runs of characters that are not [Char.isWhitespace]. */
fun wordCount(text: String?): Int {
    if (text == null) return 0
    var count = 0
    var inWord = false
    for (ch in text) {
        if (ch.isWhitespace()) {
            inWord = false
        } else if (!inWord) {
            count++
            inWord = true
        }
    }
    return count
}
