package ai.whisperio.android.settings

import ai.whisperio.android.di.ModelCatalog
import ai.whisperio.android.security.SecretStore
import ai.whisperio.core.ChainSettings
import ai.whisperio.core.ProviderId
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/** Read side used by the dictation pipeline; lets tests inject fixed settings. */
interface SettingsSource {
    suspend fun current(): AppSettings
    suspend fun chain(): ChainSettings
}

class SettingsRepository(
    private val store: DataStore<Preferences>,
    private val secrets: SecretStore,
    private val catalog: ModelCatalog,
) : SettingsSource {

    private object K {
        val order = stringPreferencesKey("provider_order") // "openai:whisper-1,groq:whisper-large-v3-turbo"
        val fallback = booleanPreferencesKey("fallback_enabled")
        val consent = booleanPreferencesKey("cloud_consent_granted")
        val language = stringPreferencesKey("language")
        val vocabulary = stringPreferencesKey("vocabulary")
        val cleanup = booleanPreferencesKey("cleanup_enabled")
        val autoStop = intPreferencesKey("auto_stop_seconds")
        val keepAudio = booleanPreferencesKey("keep_audio")
        val autoDeleteDays = intPreferencesKey("auto_delete_days") // absent = never
        val sensitive = booleanPreferencesKey("transcripts_sensitive")
        val onboarding = booleanPreferencesKey("onboarding_done")
        val perAppLanguage = booleanPreferencesKey("per_app_language")
        fun baseUrl(id: ProviderId) = stringPreferencesKey("base_url_${id.wire}")
    }

    val flow: Flow<AppSettings> = store.data.map { decode(it) }

    override suspend fun current(): AppSettings = flow.first()

    override suspend fun chain(): ChainSettings {
        val settings = current()
        val keys = ProviderId.entries.associateWith { secrets.get(it) }
        return settings.toChainSettings(keys)
    }

    fun defaultOrder(): List<ProviderSlot> =
        ProviderId.entries.map { ProviderSlot(it, catalog.defaultModel(it)) }

    private fun decode(p: Preferences): AppSettings {
        val saved = p[K.order].orEmpty().split(',').mapNotNull { token ->
            val id = ProviderId.fromWire(token.substringBefore(':').trim()) ?: return@mapNotNull null
            val model = token.substringAfter(':', "").trim().ifEmpty { catalog.defaultModel(id) }
            ProviderSlot(id, model)
        }.distinctBy { it.id }
        // Providers missing from the saved order (added in a later version) are appended with their default model.
        val order = saved + defaultOrder().filter { d -> saved.none { it.id == d.id } }
        return AppSettings(
            order = order,
            baseUrls = ProviderId.entries.mapNotNull { id -> p[K.baseUrl(id)]?.takeIf { it.isNotBlank() }?.let { id to it } }.toMap(),
            fallbackEnabled = p[K.fallback] ?: false,
            cloudConsentGranted = p[K.consent] ?: false,
            language = p[K.language] ?: AppSettings.LANGUAGE_AUTO,
            vocabulary = p[K.vocabulary] ?: "",
            cleanupEnabled = p[K.cleanup] ?: false,
            autoStopSeconds = (p[K.autoStop] ?: 0).coerceIn(AppSettings.AUTO_STOP_RANGE),
            keepAudio = p[K.keepAudio] ?: true,
            autoDeleteDays = p[K.autoDeleteDays],
            transcriptsSensitive = p[K.sensitive] ?: false,
            onboardingDone = p[K.onboarding] ?: false,
            perAppLanguage = p[K.perAppLanguage] ?: false,
        )
    }

    suspend fun setOrder(order: List<ProviderSlot>) = store.edit {
        it[K.order] = order.joinToString(",") { s -> "${s.id.wire}:${s.model}" }
    }

    suspend fun setModel(id: ProviderId, model: String) {
        val cur = current().order
        setOrder(cur.map { if (it.id == id) it.copy(model = model) else it })
    }

    suspend fun move(id: ProviderId, delta: Int) {
        val list = current().order.toMutableList()
        val from = list.indexOfFirst { it.id == id }
        val to = (from + delta).coerceIn(0, list.lastIndex)
        if (from < 0 || from == to) return
        list.add(to, list.removeAt(from))
        setOrder(list)
    }

    suspend fun setBaseUrl(id: ProviderId, url: String?) = store.edit {
        if (url.isNullOrBlank()) it.remove(K.baseUrl(id)) else it[K.baseUrl(id)] = url.trim()
    }

    suspend fun setFallback(v: Boolean) = store.edit { it[K.fallback] = v }
    suspend fun setConsent(v: Boolean) = store.edit { it[K.consent] = v }
    suspend fun setLanguage(v: String) = store.edit { it[K.language] = v }
    suspend fun setVocabulary(v: String) = store.edit { it[K.vocabulary] = v }
    suspend fun setCleanup(v: Boolean) = store.edit { it[K.cleanup] = v }
    suspend fun setAutoStop(seconds: Int) = store.edit { it[K.autoStop] = seconds.coerceIn(AppSettings.AUTO_STOP_RANGE) }
    suspend fun setKeepAudio(v: Boolean) = store.edit { it[K.keepAudio] = v }
    suspend fun setAutoDeleteDays(days: Int?) = store.edit { if (days == null) it.remove(K.autoDeleteDays) else it[K.autoDeleteDays] = days }
    suspend fun setSensitive(v: Boolean) = store.edit { it[K.sensitive] = v }
    suspend fun setOnboardingDone(v: Boolean) = store.edit { it[K.onboarding] = v }
    suspend fun setPerAppLanguage(v: Boolean) = store.edit { it[K.perAppLanguage] = v }

    /** Part of "Erase all data": resets every setting to its default. */
    suspend fun clear() {
        store.edit { it.clear() }
    }
}
