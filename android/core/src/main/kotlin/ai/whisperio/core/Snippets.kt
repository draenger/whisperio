package ai.whisperio.core

import java.text.Normalizer
import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** A user snippet: saying [trigger] (and nothing else) inserts [replacement] instead. */
data class Snippet(val id: String, val trigger: String, val replacement: String)

/** Outcome of validating a snippet before it is saved. */
sealed interface SnippetCheck {
    data class Ok(val trigger: String, val replacement: String) : SnippetCheck
    data object BlankTrigger : SnippetCheck
    data object BlankReplacement : SnippetCheck
    data object TriggerTooLong : SnippetCheck
    data object ReplacementTooLong : SnippetCheck
    data object Duplicate : SnippetCheck
}

/**
 * Snippets (Wispr Flow parity): pure matching, validation and (de)serialisation; the app stores only [encode]'s string.
 *
 * Matching is exact and whole-phrase: the WHOLE final transcript must equal a trigger. Both sides are compared after
 * [normalize]: Unicode NFC, edge punctuation/symbols/whitespace stripped, inner whitespace runs collapsed, full-Unicode
 * lowercase with [Locale.ROOT] (no locale-specific rules, so it behaves the same for every dictation language).
 * Punctuation inside the phrase must match exactly ("e-mail" never matches "email").
 */
object Snippets {
    const val MAX_TRIGGER = 80
    const val MAX_REPLACEMENT = 2000

    private val innerSpace = Regex("\\s+")

    /** Comparison key for a trigger or a transcript; empty when nothing matchable is left. */
    fun normalize(raw: String): String {
        val nfc = Normalizer.normalize(raw, Normalizer.Form.NFC)
        var start = 0
        var end = nfc.length
        while (start < end && isEdgeJunk(nfc.codePointAt(start))) start += Character.charCount(nfc.codePointAt(start))
        while (end > start && isEdgeJunk(nfc.codePointBefore(end))) end -= Character.charCount(nfc.codePointBefore(end))
        return innerSpace.replace(nfc.substring(start, end), " ").lowercase(Locale.ROOT)
    }

    // Combining marks (e.g. Devanagari vowel signs) are part of the word: stripping them would make
    // different triggers such as 'का' and 'की' collide.
    private fun isEdgeJunk(cp: Int): Boolean {
        if (Character.isLetterOrDigit(cp)) return false
        return when (Character.getType(cp).toByte()) {
            Character.NON_SPACING_MARK, Character.COMBINING_SPACING_MARK, Character.ENCLOSING_MARK -> false
            else -> true
        }
    }

    /**
     * Returns the replacement of the first snippet whose trigger matches the whole [text], or [text] unchanged.
     * An empty list (the default) is a no-op.
     */
    fun apply(text: String, snippets: List<Snippet>): String {
        if (snippets.isEmpty()) return text
        val key = normalize(text)
        if (key.isEmpty()) return text
        return snippets.firstOrNull { s -> s.replacement.isNotBlank() && normalize(s.trigger).let { it.isNotEmpty() && it == key } }
            ?.replacement ?: text
    }

    /**
     * Validates a new or edited snippet against [others] (every stored snippet except the one being edited).
     * The trigger is trimmed; the replacement is kept verbatim except for surrounding blank lines/spaces.
     */
    fun check(trigger: String, replacement: String, others: Collection<Snippet>): SnippetCheck {
        val t = trigger.trim()
        val r = replacement.trim()
        if (normalize(t).isEmpty()) return SnippetCheck.BlankTrigger
        if (t.length > MAX_TRIGGER) return SnippetCheck.TriggerTooLong
        if (r.isEmpty()) return SnippetCheck.BlankReplacement
        if (r.length > MAX_REPLACEMENT) return SnippetCheck.ReplacementTooLong
        val key = normalize(t)
        if (others.any { normalize(it.trigger) == key }) return SnippetCheck.Duplicate
        return SnippetCheck.Ok(t, r)
    }

    fun add(list: List<Snippet>, snippet: Snippet): List<Snippet> = list + snippet

    /** Replaces the trigger/replacement of [id]; unknown ids leave the list unchanged. */
    fun update(list: List<Snippet>, id: String, trigger: String, replacement: String): List<Snippet> =
        list.map { if (it.id == id) it.copy(trigger = trigger, replacement = replacement) else it }

    fun remove(list: List<Snippet>, id: String): List<Snippet> = list.filterNot { it.id == id }

    fun encode(list: List<Snippet>): String = JsonArray(
        list.map {
            JsonObject(
                mapOf(
                    "id" to JsonPrimitive(it.id),
                    "trigger" to JsonPrimitive(it.trigger),
                    "replacement" to JsonPrimitive(it.replacement),
                ),
            )
        },
    ).toString()

    /** Tolerant: bad JSON gives an empty list; malformed, blank or duplicate-id entries are skipped. */
    fun decode(raw: String?): List<Snippet> {
        if (raw.isNullOrBlank()) return emptyList()
        val array = try {
            Json.parseToJsonElement(raw) as? JsonArray
        } catch (_: Exception) {
            null
        } ?: return emptyList()
        val seen = HashSet<String>()
        return array.mapNotNull { el ->
            try {
                val o = el.jsonObject
                val id = o["id"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                val trigger = o["trigger"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                val replacement = o["replacement"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                if (seen.add(id)) Snippet(id, trigger, replacement) else null
            } catch (_: Exception) {
                null
            }
        }
    }
}
