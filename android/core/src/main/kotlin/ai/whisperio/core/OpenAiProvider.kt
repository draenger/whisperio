package ai.whisperio.core

import okhttp3.OkHttpClient

/**
 * OpenAI `/audio/transcriptions` (port of Engine/OpenAIProvider.swift, non-diarized path).
 *
 * [baseUrl] null/blank = official API. A custom base must pass [BaseUrlPolicy]; the caller should
 * then supply [HttpClients.localClient] (the default client is TLS-only). Tests pass a
 * MockWebServer URL with a local client.
 */
class OpenAiProvider(
    private val apiKey: String?,
    private val model: String,
    baseUrl: String? = null,
    private val client: OkHttpClient = HttpClients.secureClient,
) : TranscriptionProvider {
    override val id = ProviderId.OPENAI
    private val base = baseUrl?.trim().takeUnless { it.isNullOrEmpty() } ?: DEFAULT_BASE
    override val isConfigured get() = !apiKey.isNullOrBlank()

    override suspend fun transcribe(request: TranscriptionRequest): TranscriptionResult {
        val key = requireKey(id, apiKey)
        val url = baseUrlOrThrow(id, base).child("audio/transcriptions")
        ProviderCatalog.info(id).maxUploadBytes?.let { checkUploadSize(request.audio, it) }
        val apiModel = model.trim().ifEmpty { "whisper-1" }
        val text = client.postOpenAiStyle(id, url, key, apiModel, request, sendPrompt = true)
        return TranscriptionResult(text, id, apiModel)
    }

    companion object {
        const val DEFAULT_BASE = "https://api.openai.com/v1"
    }
}
