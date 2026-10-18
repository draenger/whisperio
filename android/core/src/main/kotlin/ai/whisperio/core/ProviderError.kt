package ai.whisperio.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Every failure a provider/chain can surface. Messages are user-visible and never contain an
 * API key: server text goes through [redactSecrets] and keys are only ever sent in headers.
 *
 * Formatting/redaction is a verbatim port of
 * `mobile/WhisperioKit/Sources/WhisperioKit/ProviderError.swift`.
 */
sealed class ProviderError(message: String, cause: Throwable? = null) : Exception(message, cause) {

    /** Non-2xx response. [detail] is the full redacted `HTTP <status>[: <detail>]` string (<= 200 chars). */
    class Http(
        val provider: ProviderId,
        val status: Int,
        val detail: String,
        val step: String? = null,
    ) : ProviderError("${provider.displayName}${step?.let { " $it" }.orEmpty()} error: $detail")

    /** Transport failure (offline, timeout, DNS, TLS, blocked redirect...). */
    class Network(val provider: ProviderId, val reason: String) :
        ProviderError("Could not reach ${provider.displayName}: $reason")

    /** Provider answered but the payload was unusable, or the provider reported its own failure. */
    class Failed(val provider: ProviderId, val reason: String) : ProviderError(reason)

    /** Missing key / URL. [provider] null = nothing configured at all. */
    class NotConfigured(val provider: ProviderId?) : ProviderError(
        if (provider == null) "No transcription provider is configured. Add one in Settings."
        else "${provider.displayName} is not configured. Add its ${if (provider == ProviderId.SELFHOSTED) "server URL" else "API key"} in Settings.",
    )

    /** Cloud transcription is blocked until the user grants consent (iOS consent gate). */
    class ConsentRequired : ProviderError(
        "Cloud transcription is off. Allow sending audio to your chosen provider in Settings first.",
    )

    class FileTooLarge(val limitBytes: Long) :
        ProviderError("Recording is larger than the ${limitBytes / (1024 * 1024)} MB upload limit.")

    class BaseUrlRejected(val provider: ProviderId, val reason: String) :
        ProviderError("${provider.displayName} URL rejected: $reason")

    /** Every attempted provider failed; [first] is the first failure (iOS surfaces its message). */
    class AllProvidersFailed(val first: Throwable) :
        ProviderError(
        if (first is ProviderError) first.message ?: "Unknown error"
        else redactSecrets(first.message ?: "Unknown error"),
        first,
    )

    companion object {
        const val DEFAULT_LIMIT = 200

        /** "HTTP <status>[: detail]" truncated to [limit] chars with an ellipsis. */
        fun userMessage(status: Int, body: String, limit: Int = DEFAULT_LIMIT): String {
            val detail = extractDetail(body)
            val full = if (detail.isEmpty()) "HTTP $status" else "HTTP $status: $detail"
            return truncate(full, limit)
        }

        fun userMessage(status: Int, body: ByteArray, limit: Int = DEFAULT_LIMIT): String =
            userMessage(status, body.toString(Charsets.UTF_8), limit)

        /** Builds an [Http] error from a raw response body. */
        fun http(provider: ProviderId, status: Int, body: String, step: String? = null): Http =
            Http(provider, status, userMessage(status, body), step)

        internal fun extractDetail(body: String): String {
            val trimmed = body.take(8192).trim()
            if (trimmed.isEmpty()) return ""
            val msg = try { jsonMessage(Json.parseToJsonElement(trimmed)) } catch (_: Exception) { null }
            if (!msg.isNullOrEmpty()) return clean(msg)
            return clean(trimmed)
        }

        private fun jsonMessage(el: kotlinx.serialization.json.JsonElement): String? {
            val dict = el as? JsonObject ?: return null
            val err = dict["error"]
            if (err is JsonObject) (err["message"] as? JsonPrimitive)?.takeIf { it.isString }?.let { return it.content }
            if (err is JsonPrimitive && err.isString) return err.content
            for (key in listOf("message", "detail")) {
                (dict[key] as? JsonPrimitive)?.takeIf { it.isString }?.let { return it.content }
            }
            return null
        }

        private val scriptStyle = Regex("(?is)<(script|style)[^>]*>.*?</\\1>")
        private val blockClose = Regex("(?i)<br\\s*/?>|</(p|div|h[1-6]|li|tr)>")
        private val anyTag = Regex("<[^>]*>")
        private val newline = Regex("[\\n\\r\\u000B\\u000C\\u0085\\u2028\\u2029]")
        private val spaces = Regex("(?U)\\s+")
        private val schemeCred = Regex("(?iU)\\b(bearer|token|basic)\\s+\\S+")
        private val keyedCred =
            Regex("(?i)(api[-_]?key|xi-api-key|authorization)([\"']?\\s*[:=]\\s*[\"']?)[^\\s\"',}]+")
        private val vendorKey = Regex("(?U)\\b(sk|gsk|xi|r8|aai)[-_][A-Za-z0-9_\\-]{8,}")
        private val longToken = Regex("(?U)\\b[A-Za-z0-9_\\-]{32,}\\b")

        /** Drops script/style blocks and tags, keeps the first non-empty line, redacts credentials. */
        private fun clean(s: String): String {
            var t = s
            t = scriptStyle.replace(t, " ")
            t = blockClose.replace(t, "\n")
            t = anyTag.replace(t, " ")
            val firstLine = t.split(newline).map { it.trim() }.firstOrNull { it.isNotEmpty() } ?: ""
            return redactSecrets(spaces.replace(firstLine, " "))
        }

        /** Never let a credential echoed back by a server reach the UI. */
        fun redactSecrets(text: String): String {
            var out = text
            out = schemeCred.replace(out, "\$1 ***")
            out = keyedCred.replace(out, "\$1\$2***")
            out = vendorKey.replace(out, "***")
            out = longToken.replace(out, "***")
            return out
        }

        private fun truncate(s: String, limit: Int): String {
            if (limit <= 0 || s.codePointCount(0, s.length) <= limit) return s
            val end = s.offsetByCodePoints(0, maxOf(limit - 1, 0))
            return s.substring(0, end) + "…"
        }
    }
}
