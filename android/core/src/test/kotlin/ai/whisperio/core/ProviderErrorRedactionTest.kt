package ai.whisperio.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** [ProviderError] redaction, detail extraction, truncation and messages not covered by ProviderErrorTest. */
class ProviderErrorRedactionTest {
    private fun msg(status: Int, body: String, limit: Int = ProviderError.DEFAULT_LIMIT) =
        ProviderError.userMessage(status, body, limit)

    private fun redact(s: String) = ProviderError.redactSecrets(s)

    // ---- redactSecrets

    @Test fun authSchemesAreRedactedCaseInsensitively() {
        assertEquals("Basic ***", redact("Basic dXNlcjpwYXNz"))
        assertEquals("bearer ***", redact("bearer short"))
        assertEquals("TOKEN ***", redact("TOKEN abc"))
    }

    @Test fun authorizationHeaderEchoLeaksNothing() {
        val out = redact("Authorization: Bearer sk-proj-abcdefghijklmnop")
        assertFalse("abcdefghijklmnop" in out, out)
        assertFalse("sk-proj" in out, out)
    }

    @Test fun keyedCredentialVariants() {
        for (input in listOf(
            "api_key=abc123", "api-key: abc123", "apikey=abc123", "API_KEY = 'abc123'",
            """{"apiKey": "abc123"}""", "xi-api-key=abc123", "authorization=abc123",
        )) {
            val out = redact(input)
            assertFalse("abc123" in out, "$input -> $out")
            assertTrue("***" in out, "$input -> $out")
        }
    }

    @Test fun keyedCredentialStopsAtJsonDelimiters() {
        assertEquals("""{"api_key":"***","ok":true}""", redact("""{"api_key":"secret","ok":true}"""))
        assertEquals("api_key=***, next", redact("api_key=secret, next"))
    }

    @Test fun vendorKeyPrefixes() {
        for (key in listOf(
            "sk-abcdefgh12345", "sk_abcdefgh12345", "gsk_abcdefgh12345", "xi-abcdefgh12345",
            "r8_abcdefgh12345", "aai_abcdefgh12345", "sk-proj-abc_DEF-123456",
        )) {
            assertEquals("key *** here", redact("key $key here"), key)
        }
    }

    @Test fun shortVendorLikeWordsAreLeftAlone() {
        // < 8 chars after the prefix: ordinary words must survive (e.g. "sk-learn", "xi-api").
        assertEquals("use sk-learn now", redact("use sk-learn now"))
        assertEquals("plain text, nothing secret.", redact("plain text, nothing secret."))
    }

    @Test fun longTokensAreRedactedAtThirtyTwoChars() {
        val t31 = "a".repeat(31)
        val t32 = "b".repeat(32)
        assertEquals("x $t31 y", redact("x $t31 y"))
        assertEquals("x *** y", redact("x $t32 y"))
        assertEquals("id=***", redact("id=${"c1".repeat(20)}"))
    }

    @Test fun multipleSecretsInOneLineAreAllRedacted() {
        val out = redact("Bearer one, api_key=two, sk-threethreethree and ${"f".repeat(40)}")
        listOf("one", "two", "threethreethree", "f".repeat(40)).forEach { assertFalse(it in out, "$it in $out") }
    }

    @Test fun redactionIsIdempotent() {
        val once = redact("Bearer abc api_key=xyz sk-abcdefgh12345")
        assertEquals(once, redact(once))
    }

    // ---- extractDetail / userMessage

    @Test fun nonStringJsonMessageFallsBackToRawBody() {
        assertEquals("""HTTP 400: {"error":{"message":42}}""", msg(400, """{"error":{"message":42}}"""))
    }

    @Test fun jsonArrayBodyIsShownRaw() {
        assertEquals("""HTTP 422: ["bad","worse"]""", msg(422, """["bad","worse"]"""))
    }

    @Test fun emptyJsonMessageFallsBackToRawBody() {
        assertEquals("""HTTP 400: {"error":""}""", msg(400, """{"error":""}"""))
    }

    @Test fun errorObjectBeatsTopLevelMessage() {
        assertEquals("HTTP 400: inner", msg(400, """{"message":"outer","error":{"message":"inner"}}"""))
    }

    @Test fun messageBeatsDetail() {
        assertEquals("HTTP 400: m", msg(400, """{"detail":"d","message":"m"}"""))
    }

    @Test fun jsonMessageIsAlsoCleanedAndRedacted() {
        assertEquals(
            "HTTP 401: bad key ***",
            msg(401, """{"error":{"message":"<b>bad key</b> sk-abcdefgh12345\nsecond line"}}"""),
        )
    }

    @Test fun scriptAndStyleContentNeverReachesTheUser() {
        val body = "<script>var key='sk-abcdefgh12345';</script><style>.a{}</style><p>Service unavailable</p>"
        assertEquals("HTTP 503: Service unavailable", msg(503, body))
    }

    @Test fun brTagsSplitLines() {
        assertEquals("HTTP 500: first", msg(500, "first<br/>second<BR>third"))
    }

    @Test fun whitespaceRunsAreCollapsed() {
        assertEquals("HTTP 500: a b c", msg(500, "  a \t  b  c  "))
    }

    @Test fun onlyTagsBodyFallsBackToStatus() {
        assertEquals("HTTP 500", msg(500, "<html><body></body></html>"))
    }

    @Test fun bodyIsCappedBeforeParsing() {
        // A key beyond the 8 KiB parse window can never be echoed.
        val body = "x ".repeat(5000) + "sk-abcdefgh12345"
        assertFalse("abcdefgh12345" in msg(500, body, limit = 0))
        assertTrue(msg(500, body, limit = 0).length <= "HTTP 500: ".length + 8192)
    }

    @Test fun truncationLimits() {
        val body = "abcdefghij"
        assertEquals("HTTP 400: abcdefghij", msg(400, body, limit = 20))
        assertEquals("HTTP 400: abcdefgh…", msg(400, body, limit = 19))
        assertEquals("…", msg(400, body, limit = 1))
        assertEquals("HTTP 400: abcdefghij", msg(400, body, limit = 0), "limit <= 0 disables truncation")
        assertEquals("HTTP 400: abcdefghij", msg(400, body, limit = -5))
    }

    @Test fun truncationNeverSplitsSurrogatePairs() {
        val m = msg(400, "😀".repeat(300))
        assertEquals(200, m.codePointCount(0, m.length))
        assertTrue(m.endsWith("😀…"), m.takeLast(4))
        assertFalse(m.dropLast(1).last().isHighSurrogate())
    }

    @Test fun byteArrayIsDecodedAsUtf8() {
        assertEquals("HTTP 400: zażółć", ProviderError.userMessage(400, "zażółć".toByteArray(Charsets.UTF_8)))
    }

    // ---- Error messages

    @Test fun httpWithoutStepAndDetailAreExposed() {
        val e = ProviderError.http(ProviderId.DEEPGRAM, 502, "")
        assertEquals("Deepgram error: HTTP 502", e.message)
        assertEquals("HTTP 502", e.detail)
        assertEquals(null, e.step)
        assertEquals(ProviderId.DEEPGRAM, e.provider)
    }

    @Test fun userFacingMessagesPerErrorKind() {
        assertEquals("Could not reach Groq: timeout", ProviderError.Network(ProviderId.GROQ, "timeout").message)
        assertEquals("empty transcript", ProviderError.Failed(ProviderId.MISTRAL, "empty transcript").message)
        assertEquals(
            "No transcription provider is configured. Add one in Settings.",
            ProviderError.NotConfigured(null).message,
        )
        assertTrue(ProviderError.NotConfigured(ProviderId.SELFHOSTED).message!!.contains("server URL"))
        assertTrue(ProviderError.NotConfigured(ProviderId.OPENAI).message!!.contains("API key"))
        assertEquals(
            "Recording is larger than the 25 MB upload limit.",
            ProviderError.FileTooLarge(25L * 1024 * 1024).message,
        )
        assertEquals(
            "OpenAI URL rejected: Enter a URL.",
            ProviderError.BaseUrlRejected(ProviderId.OPENAI, BaseUrlError.Empty.description).message,
        )
    }

    @Test fun notConfiguredNamesEveryProvider() {
        for (id in ProviderId.entries) {
            assertTrue(ProviderError.NotConfigured(id).message!!.startsWith(id.displayName), id.name)
        }
    }

    @Test fun allProvidersFailedKeepsCauseChain() {
        val io = java.io.IOException("reset")
        val e = ProviderError.AllProvidersFailed(io)
        assertEquals(io, e.cause)
        assertEquals("reset", e.message)
    }
}
