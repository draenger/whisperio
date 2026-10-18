package ai.whisperio.core

import okhttp3.ConnectionSpec
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.io.IOException
import java.net.InetAddress
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
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

    @Test fun secureClientNeverFollowsRedirects() {
        val c = HttpClients.secureClient
        assertFalse(c.followRedirects)
        assertFalse(c.followSslRedirects)
    }

    @Test fun crossHostRedirectIsNotFollowedAndKeyNotSent() {
        val target = MockWebServer().apply { start() }
        val origin = MockWebServer().apply { start() }
        try {
            origin.enqueue(MockResponse().setResponseCode(302).setHeader("Location", target.url("/steal").toString()))
            val client = HttpClients.secureClient.newBuilder()
                .connectionSpecs(listOf(ConnectionSpec.CLEARTEXT)).build()
            val resp = client.newCall(
                Request.Builder().url(origin.url("/v1")).header("xi-api-key", "secret-key").build(),
            ).execute()
            assertEquals(302, resp.code)
            resp.close()
            assertEquals(0, target.requestCount)
            assertEquals("secret-key", origin.takeRequest().getHeader("xi-api-key"))
        } finally {
            target.shutdown(); origin.shutdown()
        }
    }

    @Test fun privateAddressClassifier() {
        fun ip(s: String) = InetAddress.getByName(s)
        for (s in listOf("127.0.0.1", "::1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.5",
            "169.254.1.1", "fe80::1", "fd12:3456::1", "fc00::1", "100.64.0.1", "100.127.255.255")) {
            assertTrue(HttpClients.isPrivateAddress(ip(s)), s)
        }
        for (s in listOf("8.8.8.8", "172.32.0.1", "172.15.0.1", "100.63.255.255", "100.128.0.1",
            "192.169.0.1", "11.0.0.1", "2001:4860:4860::8888", "fe00::1")) {
            assertFalse(HttpClients.isPrivateAddress(ip(s)), s)
        }
    }
}
