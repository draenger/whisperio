package ai.whisperio.android.settings

import ai.whisperio.android.ime.ImeCommitPolicy

/**
 * Per-app language (CONTRACT-1.1 F7): `packageName -> language code`, most recently used first, capped at [MAX_ENTRIES].
 * Pure and immutable so the LRU and the "should store?" rule are plain-JUnit testable. Package names never leave the
 * device: they are not logged, not in history and not exported.
 */
class AppLanguageMap private constructor(private val items: List<Pair<String, String>>) {

    val size: Int get() = items.size

    /** Packages, most recently used first. */
    val packages: List<String> get() = items.map { it.first }

    fun get(pkg: String): String? = items.firstOrNull { it.first == pkg }?.second

    /** Inserts or replaces [pkg] and moves it to the front; evicts the least recently used entry above the cap. */
    fun put(pkg: String, language: String): AppLanguageMap {
        if (!validPackage(pkg) || !validLanguage(language)) return this
        val next = listOf(pkg to language) + items.filterNot { it.first == pkg }
        return AppLanguageMap(next.take(MAX_ENTRIES))
    }

    /** Marks [pkg] as just used (moves it to the front). Unknown package: unchanged. */
    fun touch(pkg: String): AppLanguageMap {
        val hit = items.firstOrNull { it.first == pkg } ?: return this
        if (items.first() == hit) return this
        return AppLanguageMap(listOf(hit) + items.filterNot { it.first == pkg })
    }

    /** One `package<TAB>language` line per entry, most recent first. */
    fun encode(): String = items.joinToString("\n") { "${it.first}\t${it.second}" }

    override fun equals(other: Any?): Boolean = other is AppLanguageMap && other.items == items
    override fun hashCode(): Int = items.hashCode()

    // Deliberately no toString of the contents: package names must not end up in logs.
    override fun toString(): String = "AppLanguageMap(size=$size)"

    companion object {
        const val MAX_ENTRIES = 200
        val EMPTY = AppLanguageMap(emptyList())

        private fun validPackage(s: String) = s.isNotBlank() && s.none { it == '\t' || it == '\n' || it == '\r' }
        private fun validLanguage(s: String) = s.isNotBlank() && s.none { it == '\t' || it == '\n' || it == '\r' }

        /** Tolerant: malformed lines are skipped, duplicates keep the first (most recent), the cap is re-applied. */
        fun decode(raw: String?): AppLanguageMap {
            if (raw.isNullOrEmpty()) return EMPTY
            val seen = HashSet<String>()
            val items = raw.lineSequence().mapNotNull { line ->
                val pkg = line.substringBefore('\t', "")
                val lang = line.substringAfter('\t', "")
                if (!validPackage(pkg) || !validLanguage(lang) || !seen.add(pkg)) null else pkg to lang
            }.take(MAX_ENTRIES).toList()
            return AppLanguageMap(items)
        }
    }
}

/** The privacy rule for F7: when may an entry be stored? Same spirit as Gboard's personalised learning. */
object AppLanguagePolicy {
    fun shouldStore(inputType: Int, imeOptions: Int, packageName: String?): Boolean =
        !packageName.isNullOrBlank() &&
            !ImeCommitPolicy.isPasswordField(inputType) &&
            !ImeCommitPolicy.isNoPersonalizedLearning(imeOptions)
}
