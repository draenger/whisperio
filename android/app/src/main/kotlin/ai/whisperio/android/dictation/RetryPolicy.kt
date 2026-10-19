package ai.whisperio.android.dictation

import ai.whisperio.android.settings.isProviderConfigured
import ai.whisperio.core.ChainSettings
import ai.whisperio.core.ProviderConfig
import ai.whisperio.core.ProviderId

/**
 * CONTRACT-1.1 F5, pure parts. The providers offered by "Retry with...": the ones with a usable key (self-hosted: a
 * server URL), in the user's priority order. [chain] is the output of `SettingsSource.chain()`.
 */
fun retryChoices(chain: ChainSettings): List<ProviderConfig> =
    chain.order.filter { isProviderConfigured(it.id, it.apiKey, it.baseUrl) }

/**
 * The one-off chain for a chosen provider: exactly that provider, never a fallback. Null when it is not usable.
 * Consent is carried over, so the core gate (and the controller pre-check) behave as in a normal run.
 */
fun singleProviderChain(chain: ChainSettings, id: ProviderId): ChainSettings? =
    retryChoices(chain).firstOrNull { it.id == id }?.let { chain.copy(order = listOf(it), fallbackEnabled = false) }

/** Result of a "Retry with..." attempt; a failure leaves the stored row untouched. */
sealed interface RetryOutcome {
    val recordingId: String

    data class Success(override val recordingId: String) : RetryOutcome

    data class Failure(override val recordingId: String, val error: DictationError, val detail: String? = null) : RetryOutcome
}
