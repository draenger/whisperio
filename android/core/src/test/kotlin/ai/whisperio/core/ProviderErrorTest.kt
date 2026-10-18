package ai.whisperio.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Vectors ported from ProviderErrorTests.swift. */
class ProviderErrorTest {
    private fun msg(status: Int, body: String) = ProviderError.userMessage(status, body)

    @Test fun jsonErrorMessageWins() {
        val body = """{"error":{"message":"Incorrect API key provided","type":"invalid_request_error"}}"""
        assertEquals("HTTP 401: Incorrect API key provided", msg(401, body))
    }

    @Test fun htmlIsStrippedToFirstLine() {
        val body = "<html><head><style>x{}</style></head><body><h1>502 Bad Gateway</h1><p>nginx</p></body></html>"
        assertEquals("HTTP 502: 502 Bad Gateway", msg(502, body))
    }

    @Test fun onlyFirstLineKept() {
        assertEquals("HTTP 500: boom", msg(500, "boom\n  stack line 1\nstack line 2"))
    }

    @Test fun truncatesTo200WithEllipsis() {
        val m = msg(400, "word ".repeat(300))
        assertEquals(200, m.length)
        assertTrue(m.endsWith("…"))
    }

    @Test fun emptyBodyFallsBackToStatus() {
        assertEquals("HTTP 503", msg(503, "  \n "))
    }

    @Test fun byteArrayOverload() {
        assertEquals("HTTP 429: slow down", ProviderError.userMessage(429, """{"error":"slow down"}""".toByteArray()))
    }

    @Test fun otherJsonShapes() {
        assertEquals("HTTP 400: bad", msg(400, """{"message":"bad"}"""))
        assertEquals("HTTP 400: nope", msg(400, """{"detail":"nope"}"""))
    }

    @Test fun credentialsEchoedByServerAreRedacted() {
        val m = msg(401, "Bad key sk-abcdef1234567890 / Bearer abc.def")
        assertFalse(m.contains("abcdef1234567890"))
        assertFalse(m.contains("abc.def"))
    }

    @Test fun vendorKeyShapesAreRedacted() {
        val dg = "a1b2c3d4e5".repeat(4)
        val aai = "0123456789abcdef0123456789abcdef"
        for (secret in listOf(dg, aai)) {
            assertFalse(msg(401, "Invalid credentials $secret rejected").contains(secret))
        }
        assertFalse(msg(401, "Token abc123XYZ invalid").contains("abc123XYZ"))
        assertFalse(msg(401, """{"detail":"bad","api_key":"shortkey1"}""").contains("shortkey1"))
        assertFalse(msg(401, "xi-api-key: hunter2hunter2 invalid").contains("hunter2hunter2"))
    }

    @Test fun httpErrorMessageNamesProviderAndNeverLeaksKey() {
        val e = ProviderError.http(ProviderId.OPENAI, 401, """{"error":{"message":"bad sk-abcdef1234567890"}}""")
        assertEquals("OpenAI error: HTTP 401: bad ***", e.message)
        assertEquals(401, e.status)
    }

    @Test fun stepAppearsInMessage() {
        val e = ProviderError.http(ProviderId.ASSEMBLYAI, 500, "oops", step = "upload")
        assertEquals("AssemblyAI upload error: HTTP 500: oops", e.message)
    }

    @Test fun allProvidersFailedCarriesFirstMessage() {
        val first = ProviderError.NotConfigured(ProviderId.GROQ)
        assertEquals(first.message, ProviderError.AllProvidersFailed(first).message)
    }

    @Test fun allProvidersFailedRedactsNonProviderErrors() {
        val e = ProviderError.AllProvidersFailed(java.io.IOException("failed: xi-api-key: hunter2hunter2"))
        assertFalse(e.message!!.contains("hunter2hunter2"))
    }

    @Test fun networkReasonFromIoExceptionIsRedactedAtSource() {
        val reason = ProviderError.redactSecrets("unexpected url https://x/?api_key=abcdef123456 sk-abcdef1234567890")
        assertFalse(reason.contains("abcdef123456"))
        assertFalse(reason.contains("sk-abcdef1234567890"))
    }
}
