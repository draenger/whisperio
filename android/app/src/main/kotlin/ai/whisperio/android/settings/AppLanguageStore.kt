package ai.whisperio.android.settings

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Private DataStore holding the per-app language map (CONTRACT-1.1 F7). A separate file from settings so it is easy to
 * wipe on its own; excluded from backup and device transfer like every other file.
 */
class AppLanguageStore(private val store: DataStore<Preferences>) {

    private val key = stringPreferencesKey("app_languages")

    /** Serialises writes with [clear] so a pick racing the switch-off cannot store an entry after the wipe. */
    private val writeLock = Mutex()

    private fun Preferences.decoded() = AppLanguageMap.decode(this[key])

    /** Number of apps with a saved language (shown in Settings). */
    val count: Flow<Int> = store.data.map { it.decoded().size }

    /** The saved language for [pkg], or null. A hit counts as a use (LRU touch). */
    suspend fun languageFor(pkg: String): String? {
        val hit = store.data.first().decoded().get(pkg) ?: return null
        store.edit { p -> p[key] = p.decoded().touch(pkg).encode() }
        return hit
    }

    /** Saves [language] for [pkg]; the caller must have checked [AppLanguagePolicy.shouldStore]. */
    suspend fun remember(pkg: String, language: String) {
        writeLock.withLock { store.edit { p -> p[key] = p.decoded().put(pkg, language).encode() } }
    }

    /**
     * Like [remember], but re-checks [enabled] (the per-app switch) under the same lock that [clear] takes. The switch
     * is written before the wipe, so either this sees it off and stores nothing, or the wipe runs after the write.
     */
    suspend fun rememberIfEnabled(pkg: String, language: String, enabled: suspend () -> Boolean): Boolean =
        writeLock.withLock {
            if (!enabled()) return@withLock false
            store.edit { p -> p[key] = p.decoded().put(pkg, language).encode() }
            true
        }

    suspend fun snapshot(): AppLanguageMap = store.data.first().decoded()

    /** Switch-off, "Clear" and "Erase all data". */
    suspend fun clear() {
        writeLock.withLock { store.edit { it.remove(key) } }
    }
}
