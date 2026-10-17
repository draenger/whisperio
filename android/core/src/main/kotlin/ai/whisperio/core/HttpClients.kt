package ai.whisperio.core

import okhttp3.ConnectionSpec
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import java.io.IOException
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
                    assertAllowed(chain.request().url)
                    chain.proceed(chain.request())
                },
            )
            .build()

    /** Throws [IOException] unless [url] satisfies [BaseUrlPolicy]. */
    internal fun assertAllowed(url: HttpUrl) {
        val result = BaseUrlPolicy.validate(url.toString())
        if (result is BaseUrlResult.Rejected) {
            throw IOException("Blocked request to ${url.host}: ${result.error.description}")
        }
    }
}
