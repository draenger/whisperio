package ai.whisperio.core

import kotlin.coroutines.cancellation.CancellationException

/**
 * Ordered providers tried in sequence with fallback (port of WhisperioKit/ProviderChain.swift):
 * configured providers in priority order; none configured -> still try the first so the user
 * sees a real error; all fail -> [ProviderError.AllProvidersFailed] wrapping the first failure.
 */
class ProviderChain(
    val providers: List<TranscriptionProvider>,
    /** Called when one provider fails and the next is about to be tried (failed, next). */
    private val onFallback: ((ProviderId, ProviderId) -> Unit)? = null,
) {
    suspend fun transcribe(request: TranscriptionRequest): TranscriptionResult {
        var effective = providers.filter { it.isConfigured }
        if (effective.isEmpty()) {
            val first = providers.firstOrNull() ?: throw ProviderError.NotConfigured(null)
            effective = listOf(first)
        }
        var firstError: Throwable? = null
        effective.forEachIndexed { index, provider ->
            try {
                return provider.transcribe(request)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (firstError == null) firstError = e
                if (index < effective.size - 1) onFallback?.invoke(provider.id, effective[index + 1].id)
            }
        }
        throw ProviderError.AllProvidersFailed(firstError ?: IllegalStateException("Unknown error"))
    }
}

/**
 * Builds chains from settings and enforces the consent gate (iOS `SettingsStore.makeChain`,
 * SettingsStore.swift:95-121). iOS substitutes an on-device engine when everything was dropped;
 * Android has none, so [makeChain] throws [ProviderError.ConsentRequired] instead.
 */
class ChainFactory(
    private val settings: ChainSettings,
    private val providerFactory: (ProviderConfig) -> TranscriptionProvider = DefaultProviders::create,
) {
    /** @throws ProviderError.NotConfigured empty order; [ProviderError.ConsentRequired] all slots are cloud and consent is missing. */
    fun makeChain(onFallback: ((ProviderId, ProviderId) -> Unit)? = null): ProviderChain {
        var slots = settings.order
        if (slots.isEmpty()) throw ProviderError.NotConfigured(null)
        if (!settings.fallbackEnabled) slots = listOf(slots[0])
        if (!settings.cloudConsentGranted) {
            slots = slots.filterNot { it.id.isCloud }
            if (slots.isEmpty()) throw ProviderError.ConsentRequired()
        }
        return ProviderChain(slots.map(providerFactory), onFallback)
    }

    /** One-off chain for retranscribing with an explicit engine; same consent gate. */
    fun makeSingleChain(config: ProviderConfig): ProviderChain {
        if (config.id.isCloud && !settings.cloudConsentGranted) throw ProviderError.ConsentRequired()
        return ProviderChain(listOf(providerFactory(config)))
    }
}

/** Production [ProviderConfig] -> provider mapping with the right transport per provider. */
object DefaultProviders {
    fun create(config: ProviderConfig): TranscriptionProvider = when (config.id) {
        ProviderId.OPENAI -> {
            val custom = !config.baseUrl.isNullOrBlank()
            OpenAiProvider(
                config.apiKey, config.model, config.baseUrl,
                if (custom) HttpClients.localClient() else HttpClients.secureClient,
            )
        }
        ProviderId.GROQ -> GroqProvider(config.apiKey, config.model)
        ProviderId.MISTRAL -> MistralProvider(config.apiKey, config.model)
        ProviderId.ELEVENLABS -> ElevenLabsProvider(config.apiKey, config.model)
        ProviderId.DEEPGRAM -> DeepgramProvider(config.apiKey, config.model)
        ProviderId.ASSEMBLYAI -> AssemblyAiProvider(config.apiKey, config.model)
        ProviderId.SELFHOSTED -> SelfHostedProvider(config.baseUrl, config.apiKey, config.model)
    }
}
