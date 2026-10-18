package ai.whisperio.core

import okhttp3.ConnectionSpec
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import java.io.IOException
import java.net.InetAddress
import java.util.concurrent.TimeUnit

/**
 * The two transports from CONTRACT section 4.3. Timeouts mirror iOS `MultipartBody.uploadSession`
 * (idle 120 s, hard cap 600 s) plus a 15 s connect timeout.
 *
 * Test seam: every provider/validator takes an `OkHttpClient` and a base-URL override, so tests
 * pass `localClient()` plus a MockWebServer URL (http://localhost is allowed by [BaseUrlPolicy]).
 */
object HttpClients {
    /** TLS only: no CLEARTEXT spec, so http:// can never reach a host through this client. */
    val secureClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectionSpecs(listOf(ConnectionSpec.MODERN_TLS, ConnectionSpec.COMPATIBLE_TLS))
            // Never follow redirects: a cross-host hop would carry provider headers (xi-api-key etc.).
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .callTimeout(600, TimeUnit.SECONDS)
            .build()
    }

    /**
     * For URLs that already passed [BaseUrlPolicy] (custom OpenAI base, self-hosted). Allows
     * cleartext, but never follows redirects and re-checks the policy on every network hop.
     */
    fun localClient(base: OkHttpClient = secureClient): OkHttpClient =
        base.newBuilder()
            .connectionSpecs(
                listOf(ConnectionSpec.MODERN_TLS, ConnectionSpec.COMPATIBLE_TLS, ConnectionSpec.CLEARTEXT),
            )
            .followRedirects(false)
            .followSslRedirects(false)
            .addNetworkInterceptor(
                Interceptor { chain ->
                    val url = chain.request().url
                    assertAllowed(url)
                    // Plain-http "local" is judged by name in BaseUrlPolicy; verify the address we
                    // actually connected to is private (https custom hosts may be public).
                    if (!url.isHttps) {
                        val addr = chain.connection()?.route()?.socketAddress?.address
                        if (addr != null && !isPrivateAddress(addr)) {
                            throw IOException("Blocked cleartext request to ${url.host}: not a local address")
                        }
                    }
                    chain.proceed(chain.request())
                },
            )
            .build()

    /** Loopback, site-local (10/8, 172.16/12, 192.168/16), link-local, IPv6 ULA fc00::/7, CGNAT 100.64/10. */
    internal fun isPrivateAddress(a: InetAddress): Boolean {
        if (a.isLoopbackAddress || a.isSiteLocalAddress || a.isLinkLocalAddress) return true
        val b = a.address
        return when (b.size) {
            4 -> (b[0].toInt() and 0xFF) == 100 && (b[1].toInt() and 0xC0) == 0x40
            16 -> (b[0].toInt() and 0xFE) == 0xFC
            else -> false
        }
    }

    /** Throws [IOException] unless [url] satisfies [BaseUrlPolicy]. */
    internal fun assertAllowed(url: HttpUrl) {
        val result = BaseUrlPolicy.validate(url.toString())
        if (result is BaseUrlResult.Rejected) {
            throw IOException("Blocked request to ${url.host}: ${result.error.description}")
        }
    }
}
