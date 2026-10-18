package ai.whisperio.core

import kotlinx.coroutines.CancellationException
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Verifies a pasted key with a cheap authenticated GET (port of WhisperioKit/ProviderKeyValidator.swift).
 * 2xx = valid, 401/403 = invalid key, other = unexpected(code), transport failure = network.
 * Self-hosted has no vendor: "the key" is the server URL and only [BaseUrlPolicy] is checked.
 *
 * Test seam: [baseUrls] overrides a provider's API base (including its version prefix).
 */
class KeyValidator(
    client: OkHttpClient = HttpClients.secureClient,
    private val baseUrls: Map<ProviderId, String> = emptyMap(),
) {
    private val client = client.newBuilder().callTimeout(15, TimeUnit.SECONDS).build()

    suspend fun validate(id: ProviderId, key: String): KeyValidation {
        if (id == ProviderId.SELFHOSTED) return validateSelfHostedUrl(key)
        val trimmed = key.trim()
        if (trimmed.isEmpty()) return KeyValidation.InvalidKey
        val request = try {
            buildRequest(id, trimmed)
        } catch (_: IllegalArgumentException) {
            return KeyValidation.Unexpected(0)
        }
        return try {
            client.newCall(request).await().use { response ->
                when (response.code) {
                    in 200..299 -> KeyValidation.Valid
                    401, 403 -> KeyValidation.InvalidKey
                    else -> KeyValidation.Unexpected(response.code)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            KeyValidation.Network(ProviderError.redactSecrets(e.message ?: e.javaClass.simpleName))
        }
    }

    private fun buildRequest(id: ProviderId, key: String): Request {
        val base = (baseUrls[id] ?: ProviderCatalog.info(id).defaultBaseUrl!!).toHttpUrlStrict()
        val builder = Request.Builder()
        val url = when (id) {
            ProviderId.OPENAI, ProviderId.GROQ, ProviderId.MISTRAL -> {
                builder.header("Authorization", "Bearer $key")
                base.child("models")
            }
            ProviderId.ELEVENLABS -> {
                builder.header("xi-api-key", key)
                base.child("user")
            }
            ProviderId.DEEPGRAM -> {
                builder.header("Authorization", "Token $key")
                base.child("projects")
            }
            // Raw key, no "Bearer" prefix.
            ProviderId.ASSEMBLYAI -> {
                builder.header("authorization", key)
                base.child("transcript").newBuilder().addQueryParameter("limit", "1").build()
            }
            ProviderId.SELFHOSTED -> throw IllegalArgumentException("handled earlier")
        }
        return builder.url(url).get().build()
    }

    private fun validateSelfHostedUrl(raw: String): KeyValidation =
        when (val r = BaseUrlPolicy.validate(raw, assumeHttpForBareHost = true)) {
            is BaseUrlResult.Ok -> KeyValidation.Valid
            is BaseUrlResult.Rejected ->
                if (r.error == BaseUrlError.Empty) KeyValidation.Unexpected(0)
                else KeyValidation.InvalidUrl(r.error.description)
        }
}
