package ai.whisperio.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * ElevenLabs Scribe (port of Engine/ElevenLabsProvider.swift, non-diarized path).
 * Vocabulary is sent as `keyterms` (JSON array string) after the iOS filter. Keyterm biasing
 * needs Scribe v2, so an empty model or the default `scribe_v1` is upgraded to `scribe_v2`
 * when keyterms are present (CONTRACT 4.1); any other explicit model is respected.
 */
class ElevenLabsProvider(
    private val apiKey: String?,
    private val model: String,
    private val baseUrl: String = DEFAULT_BASE,
    private val client: OkHttpClient = HttpClients.secureClient,
) : TranscriptionProvider {
    override val id = ProviderId.ELEVENLABS
    override val isConfigured get() = !apiKey.isNullOrBlank()

    override suspend fun transcribe(request: TranscriptionRequest): TranscriptionResult {
        val key = requireKey(id, apiKey)
        val terms = cleanKeyterms(request.vocabulary)
        val trimmed = model.trim()
        val modelId = if (trimmed.isEmpty() || (trimmed == "scribe_v1" && terms.isNotEmpty())) {
            if (terms.isNotEmpty()) "scribe_v2" else "scribe_v1"
        } else {
            trimmed
        }
        val body = formBody {
            addFormDataPart("model_id", modelId)
            if (!isAutoLanguage(request.language)) addFormDataPart("language_code", request.language.trim())
            if (terms.isNotEmpty()) addFormDataPart("keyterms", JsonArray(terms.map { JsonPrimitive(it) }).toString())
            addAudio(request.audio)
        }
        val http = Request.Builder()
            .url(baseUrl.toHttpUrlStrict().child("speech-to-text"))
            .header("xi-api-key", key)
            .post(body).build()
        val text = parseText(id, client.executeText(id, http))
        return TranscriptionResult(text, id, modelId)
    }

    companion object {
        const val DEFAULT_BASE = "https://api.elevenlabs.io/v1"
        private val banned = "<>{}[]\\".toSet()

        /** Each term: trimmed, non-empty, <= 50 chars, <= 5 words, none of `<>{}[]\`. */
        internal fun cleanKeyterms(vocabulary: String): List<String> =
            vocabulary.split(",").map { it.trim() }.filter { t ->
                t.isNotEmpty() && t.length <= 50 &&
                    t.split(" ").count { it.isNotEmpty() } <= 5 &&
                    t.none { it in banned }
            }
    }
}
