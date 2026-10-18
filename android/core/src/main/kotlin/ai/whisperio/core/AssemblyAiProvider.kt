package ai.whisperio.core

import kotlinx.coroutines.delay
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * AssemblyAI upload -> transcript job -> poll (port of Engine/AssemblyAIProvider.swift).
 * Like iOS, sleeps [pollIntervalMs] before every poll, max [maxPolls] polls. [delayFn] is the
 * injectable clock for tests.
 */
class AssemblyAiProvider(
    private val apiKey: String?,
    private val model: String,
    private val baseUrl: String = DEFAULT_BASE,
    private val client: OkHttpClient = HttpClients.secureClient,
    private val pollIntervalMs: Long = 2_000,
    private val maxPolls: Int = 150,
    private val delayFn: suspend (Long) -> Unit = { delay(it) },
) : TranscriptionProvider {
    override val id = ProviderId.ASSEMBLYAI
    override val isConfigured get() = !apiKey.isNullOrBlank()

    internal fun apiModel(): String = when (val m = model.trim()) {
        "", "universal-2" -> "universal"
        "universal-1" -> "best"
        else -> m
    }

    override suspend fun transcribe(request: TranscriptionRequest): TranscriptionResult {
        val key = requireKey(id, apiKey)
        val base = baseUrl.toHttpUrlStrict()
        val m = apiModel()

        // 1. Upload raw audio.
        val upload = Request.Builder().url(base.child("upload"))
            .header("authorization", key)
            .post(request.audio.asRequestBody(OCTET_STREAM)).build()
        val audioUrl = parseObject(id, client.executeText(id, upload, "upload")).string("upload_url")
            ?: throw ProviderError.Failed(id, "AssemblyAI returned no upload URL.")

        // 2. Create the transcript job.
        val auto = isAutoLanguage(request.language)
        val json = buildJsonObject {
            put("audio_url", audioUrl)
            put("speech_model", m)
            if (auto) put("language_detection", true) else put("language_code", request.language.trim())
        }.toString()
        val create = Request.Builder().url(base.child("transcript"))
            .header("authorization", key)
            .post(json.toRequestBody(JSON_MEDIA)).build()
        val jobId = parseObject(id, client.executeText(id, create, "transcript")).string("id")
            ?: throw ProviderError.Failed(id, "AssemblyAI returned no job id.")

        // 3. Poll until the job settles.
        repeat(maxPolls) {
            delayFn(pollIntervalMs)
            val poll = Request.Builder().url(base.child("transcript/$jobId"))
                .header("authorization", key).get().build()
            val state = parseObject(id, client.executeText(id, poll, "status"))
            when (state.string("status")) {
                "completed" -> {
                    val text = state.string("text")
                        ?: throw ProviderError.Failed(id, "AssemblyAI returned no transcript.")
                    return TranscriptionResult(text, id, m)
                }
                "error" -> throw ProviderError.Failed(
                    id,
                    "AssemblyAI failed: ${ProviderError.redactSecrets(state.string("error") ?: "unknown error")}",
                )
                else -> Unit // queued / processing
            }
        }
        throw ProviderError.Failed(id, "AssemblyAI timed out waiting for the transcript.")
    }

    companion object {
        const val DEFAULT_BASE = "https://api.assemblyai.com/v2"
    }
}
