package ai.whisperio.core

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.URI

/** Why a base URL was rejected. [description] is user-visible (iOS `BaseURLPolicy.Error`). */
sealed class BaseUrlError(val description: String) {
    data object Empty : BaseUrlError("Enter a URL.")
    data object Invalid : BaseUrlError("Not a valid URL. Use the form https://host[:port]/v1.")
    data class UnsupportedScheme(val scheme: String) :
        BaseUrlError("Unsupported URL scheme \"$scheme\". Use https://.")
    data class InsecureHttp(val host: String) : BaseUrlError(
        "Plain http:// is only allowed for localhost and private-network hosts. " +
            "$host is a public host — use https://.",
    )
}

sealed class BaseUrlResult {
    data class Ok(val url: HttpUrl) : BaseUrlResult()
    data class Rejected(val error: BaseUrlError) : BaseUrlResult()
}

/**
 * Connection-security rule for user-editable provider base URLs.
 * Port of `mobile/WhisperioKit/Sources/WhisperioKit/BaseURLPolicy.swift`: https always; plain
 * http only for loopback / private / intranet hosts. Nothing is silently rewritten.
 */
object BaseUrlPolicy {
    /** Validates [raw] (trimmed). A scheme-less value is read as `http://` only if [assumeHttpForBareHost]. */
    fun validate(raw: String, assumeHttpForBareHost: Boolean = false): BaseUrlResult {
        var s = raw.trim()
        if (s.isEmpty()) return BaseUrlResult.Rejected(BaseUrlError.Empty)
        if (!s.contains("://")) {
            if (!assumeHttpForBareHost) return BaseUrlResult.Rejected(BaseUrlError.Invalid)
            s = "http://$s"
        }
        val scheme = s.substringBefore("://").lowercase()
        return when (scheme) {
            "https" -> parse(s)?.let { BaseUrlResult.Ok(it) } ?: BaseUrlResult.Rejected(BaseUrlError.Invalid)
            "http" -> {
                val url = parse(s) ?: return BaseUrlResult.Rejected(BaseUrlError.Invalid)
                if (isLocalHost(url.host)) BaseUrlResult.Ok(url)
                else BaseUrlResult.Rejected(BaseUrlError.InsecureHttp(url.host))
            }
            else -> {
                val host = try { URI(s).host } catch (_: Exception) { null }
                if (host.isNullOrEmpty()) BaseUrlResult.Rejected(BaseUrlError.Invalid)
                else BaseUrlResult.Rejected(BaseUrlError.UnsupportedScheme(scheme))
            }
        }
    }

    private fun parse(s: String): HttpUrl? = s.toHttpUrlOrNull()?.takeIf { it.host.isNotEmpty() }

    /** Loopback / private-network host check (same semantics as desktop `isLocalHost`). */
    fun isLocalHost(hostname: String): Boolean {
        var host = hostname.trim().lowercase()
        if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length - 1)
        if (host == "localhost" || host == "::1" || host == "0.0.0.0") return true
        for (suffix in listOf(".local", ".lan", ".home.arpa", ".internal")) if (host.endsWith(suffix)) return true
        // Dotless intranet names never resolve on the public internet.
        if (!host.contains(".") && !host.contains(":")) return true
        // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
        if (host.contains(":")) {
            return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")
        }
        val parts = host.split(".")
        if (parts.size == 4 && parts.all { it.isNotEmpty() && it.length <= 3 && it.all { c -> c in '0'..'9' } }) {
            val o = parts.map { it.toInt() }
            if (o.any { it > 255 }) return false
            if (o[0] == 127 || o[0] == 10) return true
            if (o[0] == 192 && o[1] == 168) return true
            if (o[0] == 172 && o[1] in 16..31) return true
            if (o[0] == 100 && o[1] in 64..127) return true // Tailscale / CGNAT 100.64.0.0/10
        }
        return false
    }

    /** The provider's official API host; only OpenAI has a user-editable base URL. */
    fun officialHost(provider: ProviderId): String? =
        if (provider == ProviderId.OPENAI) "api.openai.com" else null

    fun isOfficialHost(provider: ProviderId, url: HttpUrl): Boolean {
        val official = officialHost(provider) ?: return false
        return url.host.lowercase() == official
    }
}
