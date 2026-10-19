package ai.whisperio.core

import okhttp3.OkHttpClient

/**
 * Groq's OpenAI-compatible endpoint (port of Engine/GroqProvider.swift).
 * Deviation: iOS mapped "distil-whisper" to `distil-whisper-large-v3-en`; Groq retired it, so
 * both legacy ids fall back to the default turbo model.
 */
class GroqProvider(
    private val apiKey: String?,
    private val model: String,
    private val baseUrl: String = DEFAULT_BASE,
    private val client: OkHttpClient = HttpClients.secureClient,
) : TranscriptionProvider {
    override val id = ProviderId.GROQ
    override val isConfigured get() = !apiKey.isNullOrBlank()

    internal fun apiModel(): String = when (val m = model.trim()) {
        "", "distil-whisper", "distil-whisper-large-v3-en" -> DEFAULT_MODEL
        else -> m
    }

    override suspend fun transcribe(request: TranscriptionRequest): TranscriptionResult {
        val key = requireKey(id, apiKey)
        ProviderCatalog.info(id).maxUploadBytes?.let { checkUploadSize(request.audio, it) }
        val url = baseUrl.toHttpUrlStrict().child("audio/transcriptions")
        val m = apiModel()
        return TranscriptionResult(client.postOpenAiStyle(id, url, key, m, request, sendPrompt = true), id, m)
    }

    companion object {
        const val DEFAULT_BASE = "https://api.groq.com/openai/v1"
        const val DEFAULT_MODEL = "whisper-large-v3-turbo"
    }
}
