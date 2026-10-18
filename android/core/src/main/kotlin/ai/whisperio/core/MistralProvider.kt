package ai.whisperio.core

import okhttp3.OkHttpClient

/** Mistral Voxtral via the OpenAI-compatible endpoint (port of Engine/MistralProvider.swift). No prompt field. */
class MistralProvider(
    private val apiKey: String?,
    private val model: String,
    private val baseUrl: String = DEFAULT_BASE,
    private val client: OkHttpClient = HttpClients.secureClient,
) : TranscriptionProvider {
    override val id = ProviderId.MISTRAL
    override val isConfigured get() = !apiKey.isNullOrBlank()

    internal fun apiModel(): String = when (val m = model.trim()) {
        "", "voxtral-small" -> "voxtral-small-latest"
        "voxtral-mini" -> "voxtral-mini-latest"
        else -> m
    }

    override suspend fun transcribe(request: TranscriptionRequest): TranscriptionResult {
        val key = requireKey(id, apiKey)
        ProviderCatalog.info(id).maxUploadBytes?.let { checkUploadSize(request.audio, it) }
        val url = baseUrl.toHttpUrlStrict().child("audio/transcriptions")
        val m = apiModel()
        return TranscriptionResult(client.postOpenAiStyle(id, url, key, m, request, sendPrompt = false), id, m)
    }

    companion object {
        const val DEFAULT_BASE = "https://api.mistral.ai/v1"
    }
}
