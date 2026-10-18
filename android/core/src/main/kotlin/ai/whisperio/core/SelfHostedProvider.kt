package ai.whisperio.core

import okhttp3.HttpUrl
import okhttp3.OkHttpClient

/**
 * User-run OpenAI-compatible STT server (port of Engine/SelfHostedProvider.swift): `/v1` is
 * appended when missing, bearer auth is optional, no `prompt` field, no size pre-check.
 * Default client is [HttpClients.localClient] because plain http to a LAN host is legitimate.
 */
class SelfHostedProvider(
    private val serverUrl: String?,
    private val apiKey: String?,
    private val model: String,
    private val client: OkHttpClient = HttpClients.localClient(),
) : TranscriptionProvider {
    override val id = ProviderId.SELFHOSTED
    override val isConfigured get() = normalizedBase(serverUrl.orEmpty()) != null

    override suspend fun transcribe(request: TranscriptionRequest): TranscriptionResult {
        val raw = serverUrl.orEmpty()
        val base = normalizedBase(raw) ?: run {
            val r = BaseUrlPolicy.validate(raw, assumeHttpForBareHost = true)
            if (r is BaseUrlResult.Rejected && r.error != BaseUrlError.Empty) {
                throw ProviderError.BaseUrlRejected(id, r.error.description)
            }
            throw ProviderError.NotConfigured(id)
        }
        val m = model.trim().ifEmpty { "whisper-1" }
        val bearer = apiKey?.trim()?.takeIf { it.isNotEmpty() }
        val text = client.postOpenAiStyle(id, base.child("audio/transcriptions"), bearer, m, request, sendPrompt = false)
        return TranscriptionResult(text, id, m)
    }

    companion object {
        /** Bare host or full URL, rooted at `/v1`; null when it fails [BaseUrlPolicy]. */
        fun normalizedBase(raw: String): HttpUrl? {
            val ok = BaseUrlPolicy.validate(raw, assumeHttpForBareHost = true) as? BaseUrlResult.Ok ?: return null
            val url = ok.url
            val trimmed = url.encodedPath.trimEnd('/')
            // Existing /v1 (with or without trailing slash) is kept, normalised to no trailing slash.
            return if (trimmed.endsWith("/v1")) url.newBuilder().encodedPath(trimmed).build() else url.child("v1")
        }
    }
}
