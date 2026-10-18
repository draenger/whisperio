package ai.whisperio.android.settings

import ai.whisperio.core.ChainSettings
import ai.whisperio.core.ProviderConfig
import ai.whisperio.core.ProviderId

/** One position in the provider order with its chosen model (iOS `modelOrder`). */
data class ProviderSlot(val id: ProviderId, val model: String)

/** All persisted, non-secret settings (CONTRACT 7.4). Keys live in the SecretStore. */
data class AppSettings(
    val order: List<ProviderSlot>,
    /** Only OPENAI (custom host) and SELFHOSTED use a base URL. */
    val baseUrls: Map<ProviderId, String> = emptyMap(),
    val fallbackEnabled: Boolean = false,
    val cloudConsentGranted: Boolean = false,
    val language: String = LANGUAGE_AUTO,
    val vocabulary: String = "",
    val cleanupEnabled: Boolean = false,
    /** 0 = off, 0..120 in 5 s steps. */
    val autoStopSeconds: Int = 0,
    val keepAudio: Boolean = true,
    /** null = never; otherwise 1, 7 or 30. */
    val autoDeleteDays: Int? = null,
    val transcriptsSensitive: Boolean = false,
    val onboardingDone: Boolean = false,
) {
    companion object {
        const val LANGUAGE_AUTO = "auto"
        val AUTO_STOP_RANGE = 0..120
        val AUTO_DELETE_CHOICES: List<Int?> = listOf(null, 1, 7, 30)
    }
}

/** Whether a provider slot can be used as-is: a key, or (self-hosted) at least a URL. */
fun isProviderConfigured(id: ProviderId, key: String?, baseUrl: String?): Boolean =
    if (id == ProviderId.SELFHOSTED) !baseUrl.isNullOrBlank() else !key.isNullOrBlank()

/**
 * Maps the app settings plus the stored keys onto the :core chain input. Slots without usable credentials are
 * dropped so core only sees configured providers; if none is configured the first slot is passed through so
 * the user gets a real provider error instead of silence (CONTRACT 4.2).
 */
fun AppSettings.toChainSettings(keys: Map<ProviderId, String?>): ChainSettings {
    val all = order.map { slot ->
        val url = baseUrls[slot.id]?.takeIf { it.isNotBlank() && (slot.id == ProviderId.OPENAI || slot.id == ProviderId.SELFHOSTED) }
        ProviderConfig(id = slot.id, model = slot.model, apiKey = keys[slot.id]?.takeIf { it.isNotBlank() }, baseUrl = url)
    }
    val configured = all.filter { isProviderConfigured(it.id, it.apiKey, it.baseUrl) }
    return ChainSettings(
        order = configured.ifEmpty { all.take(1) },
        fallbackEnabled = fallbackEnabled,
        cloudConsentGranted = cloudConsentGranted,
    )
}
