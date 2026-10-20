package ai.whisperio.android.settings

import ai.whisperio.core.Categories
import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** A user-made category (CONTRACT-1.2 F3). [hueIndex] is stored so colours never drift when another one is deleted. */
data class CustomCategory(val id: String, val name: String, val hueIndex: Int)

/** Outcome of validating a new custom name (CONTRACT-1.2 D6). */
sealed interface CategoryNameCheck {
    data class Ok(val name: String) : CategoryNameCheck
    data object Blank : CategoryNameCheck
    data object TooLong : CategoryNameCheck
    data object Duplicate : CategoryNameCheck
}

/** Pure add / delete / validate / (de)serialise logic for the custom list; the DataStore only stores [encode]'s string. */
object CustomCategories {
    const val MAX_NAME = 24

    /** All seed labels from values/strings.xml and values-pl/strings.xml, regardless of the current locale. */
    val SEED_LABELS = listOf(
        "Work", "Personal", "Ideas", "Messages", "Code", "To-do",
        "Praca", "Prywatne", "Pomysły", "Wiadomości", "Kod", "Do zrobienia",
    )

    /**
     * D6: trimmed, 1-[MAX_NAME] chars, and not equal (case-insensitive, full Unicode lowercase) to any of [SEED_LABELS]
     * (both languages) or [takenLabels] (including every existing custom name).
     */
    fun check(raw: String, takenLabels: Collection<String>): CategoryNameCheck {
        val name = raw.trim()
        if (name.isEmpty()) return CategoryNameCheck.Blank
        if (name.length > MAX_NAME) return CategoryNameCheck.TooLong
        val folded = name.lowercase(Locale.ROOT)
        if ((SEED_LABELS + takenLabels).any { it.trim().lowercase(Locale.ROOT) == folded }) return CategoryNameCheck.Duplicate
        return CategoryNameCheck.Ok(name)
    }

    /** Next colour slot in creation order: one past the highest stored slot, so deleting never shifts the others. */
    fun nextHue(list: List<CustomCategory>): Int = (list.maxOfOrNull { it.hueIndex } ?: -1) + 1

    /** Appends a category named [name] (already validated) with id [id]. */
    fun add(list: List<CustomCategory>, name: String, id: String): List<CustomCategory> =
        list + CustomCategory(id, name, nextHue(list))

    fun remove(list: List<CustomCategory>, id: String): List<CustomCategory> = list.filterNot { it.id == id }

    fun encode(list: List<CustomCategory>): String = JsonArray(
        list.map {
            JsonObject(
                mapOf("id" to JsonPrimitive(it.id), "name" to JsonPrimitive(it.name), "hue" to JsonPrimitive(it.hueIndex)),
            )
        },
    ).toString()

    /** Tolerant: bad JSON gives an empty list; malformed or duplicate entries are skipped. */
    fun decode(raw: String?): List<CustomCategory> {
        if (raw.isNullOrBlank()) return emptyList()
        val parsed: JsonArray? = try {
            Json.parseToJsonElement(raw) as? JsonArray
        } catch (_: Exception) {
            null
        }
        val array = parsed ?: return emptyList()
        val seen = HashSet<String>()
        return array.mapNotNull { el ->
            try {
                val o = el.jsonObject
                val id = o["id"]?.jsonPrimitive?.contentOrNull?.takeIf { it.startsWith(Categories.CUSTOM_PREFIX) } ?: return@mapNotNull null
                val name = o["name"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                val hue = o["hue"]?.jsonPrimitive?.intOrNull ?: 0
                if (seen.add(id)) CustomCategory(id, name, hue.coerceAtLeast(0)) else null
            } catch (_: Exception) {
                null
            }
        }
    }
}
