package ai.whisperio.core

import okhttp3.ConnectionSpec
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HttpClientsTest {
    @Test fun secureClientIsTlsOnlyWithContractTimeouts() {
        val c = HttpClients.secureClient
        assertEquals(listOf(ConnectionSpec.MODERN_TLS, ConnectionSpec.COMPATIBLE_TLS), c.connectionSpecs)
        assertFalse(c.connectionSpecs.contains(ConnectionSpec.CLEARTEXT))
        assertEquals(TimeUnit.SECONDS.toMillis(15), c.connectTimeoutMillis.toLong())
        assertEquals(TimeUnit.SECONDS.toMillis(120), c.readTimeoutMillis.toLong())
        assertEquals(TimeUnit.SECONDS.toMillis(120), c.writeTimeoutMillis.toLong())
        assertEquals(TimeUnit.SECONDS.toMillis(600), c.callTimeoutMillis.toLong())
    }

    @Test fun localClientNeverFollowsRedirectsAndKeepsTimeouts() {
        val c = HttpClients.localClient()
        assertFalse(c.followRedirects)
        assertFalse(c.followSslRedirects)
        assertTrue(c.networkInterceptors.isNotEmpty())
        assertEquals(TimeUnit.SECONDS.toMillis(120), c.readTimeoutMillis.toLong())
    }

    @Test fun networkInterceptorRechecksPolicyOnEveryHop() {
        HttpClients.assertAllowed("https://api.openai.com/v1".toHttpUrl())
        HttpClients.assertAllowed("http://192.168.1.5:8080/v1".toHttpUrl())
        assertFailsWith<IOException> { HttpClients.assertAllowed("http://example.com/x".toHttpUrl()) }
        assertFailsWith<IOException> { HttpClients.assertAllowed("http://8.8.8.8/".toHttpUrl()) }
    }
}
