package ai.whisperio.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody

/** Deepgram pre-recorded `/listen` (port of Engine/DeepgramProvider.swift): raw body, `Token` auth, options in the query. */
class DeepgramProvider(
    private val apiKey: String?,
    private val model: String,
    private val baseUrl: String = DEFAULT_BASE,
    private val client: OkHttpClient = HttpClients.secureClient,
) : TranscriptionProvider {
    override val id = ProviderId.DEEPGRAM
    override val isConfigured get() = !apiKey.isNullOrBlank()

    internal fun apiModel(): String = when (val m = model.trim()) {
        "" -> "nova-3"
        "whisper-cloud" -> "whisper-large"
        else -> m
    }

    override suspend fun transcribe(request: TranscriptionRequest): TranscriptionResult {
        val key = requireKey(id, apiKey)
        ProviderCatalog.info(id).maxUploadBytes?.let { checkUploadSize(request.audio, it) }
        val m = apiModel()
        val url = baseUrl.toHttpUrlStrict().child("listen").newBuilder()
            .addQueryParameter("model", m)
            .addQueryParameter("smart_format", "true")
            .apply { if (!isAutoLanguage(request.language)) addQueryParameter("language", request.language.trim()) }
            .build()
        val http = Request.Builder().url(url)
            .header("Authorization", "Token $key")
            .post(request.audio.asRequestBody(OCTET_STREAM)).build()
        val obj = parseObject(id, client.executeText(id, http))
        val channel = ((obj["results"] as? JsonObject)?.get("channels") as? JsonArray)?.firstOrNull() as? JsonObject
        val alt = (channel?.get("alternatives") as? JsonArray)?.firstOrNull() as? JsonObject
        val transcript = alt?.string("transcript")
            ?: throw ProviderError.Failed(id, "Deepgram returned no transcript.")
        return TranscriptionResult(transcript, id, m)
    }

    companion object {
        const val DEFAULT_BASE = "https://api.deepgram.com/v1"
    }
}
