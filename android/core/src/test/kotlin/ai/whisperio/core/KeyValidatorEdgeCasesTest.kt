package ai.whisperio.core

import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** [KeyValidator] paths not covered by KeyValidatorTest: input hygiene, bad bases, cancellation, self-hosted errors. */
class KeyValidatorEdgeCasesTest {
    private lateinit var server: MockWebServer
    private val client = HttpClients.localClient()

    @Before fun start() { server = MockWebServer().apply { start() } }
    @After fun stop() { server.shutdown() }

    private fun validator(id: ProviderId = ProviderId.OPENAI, prefix: String = "/v1") =
        KeyValidator(client, mapOf(id to server.base(prefix)))

    @Test fun blankKeysAreInvalidWithoutANetworkCall() = runBlocking<Unit> {
        val v = validator()
        for (id in ProviderId.entries - ProviderId.SELFHOSTED) {
            assertEquals(KeyValidation.InvalidKey, v.validate(id, ""), id.name)
            assertEquals(KeyValidation.InvalidKey, v.validate(id, " \t\n"), id.name)
        }
        assertEquals(0, server.requestCount)
    }

    @Test fun surroundingWhitespaceIsTrimmedFromTheKey() = runBlocking<Unit> {
        server.enqueue(MockResponse().setResponseCode(200))
        assertEquals(KeyValidation.Valid, validator().validate(ProviderId.OPENAI, "  sk-pasted \n"))
        assertEquals("Bearer sk-pasted", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun keyWithIllegalHeaderCharsIsUnexpectedZeroAndNeverSent() = runBlocking<Unit> {
        val v = validator()
        assertEquals(KeyValidation.Unexpected(0), v.validate(ProviderId.OPENAI, "abc\ndef"))
        assertEquals(KeyValidation.Unexpected(0), v.validate(ProviderId.OPENAI, "kłucz"))
        assertEquals(0, server.requestCount)
    }

    @Test fun malformedOverrideBaseIsUnexpectedZero() = runBlocking<Unit> {
        val v = KeyValidator(client, mapOf(ProviderId.GROQ to "not a url"))
        assertEquals(KeyValidation.Unexpected(0), v.validate(ProviderId.GROQ, "k"))
    }

    @Test fun trailingSlashOnBaseIsTolerated() = runBlocking<Unit> {
        server.enqueue(MockResponse().setResponseCode(200))
        val v = KeyValidator(client, mapOf(ProviderId.OPENAI to server.base("/v1") + "/"))
        assertEquals(KeyValidation.Valid, v.validate(ProviderId.OPENAI, "k"))
        assertEquals("/v1/models", server.takeRequest().path)
    }

    @Test fun otherStatusesAreUnexpected() = runBlocking<Unit> {
        val v = validator()
        for (code in listOf(400, 404, 429, 502)) {
            server.enqueue(MockResponse().setResponseCode(code))
            assertEquals(KeyValidation.Unexpected(code), v.validate(ProviderId.OPENAI, "k"), "$code")
        }
    }

    @Test fun invalidKeyMappingAppliesToEveryVendor() = runBlocking<Unit> {
        val prefixes = mapOf(
            ProviderId.OPENAI to "/v1", ProviderId.GROQ to "/openai/v1", ProviderId.MISTRAL to "/v1",
            ProviderId.ELEVENLABS to "/v1", ProviderId.DEEPGRAM to "/v1", ProviderId.ASSEMBLYAI to "/v2",
        )
        val v = KeyValidator(client, prefixes.mapValues { server.base(it.value) })
        for (id in prefixes.keys) {
            server.enqueue(MockResponse().setResponseCode(401))
            assertEquals(KeyValidation.InvalidKey, v.validate(id, "k"), id.name)
        }
        assertEquals(prefixes.size, server.requestCount)
    }

    @Test fun onlyTheOverriddenProviderHitsTheTestServer() = runBlocking<Unit> {
        // Overrides are per provider; the GET is always a GET with no body.
        server.enqueue(MockResponse().setResponseCode(200))
        assertEquals(KeyValidation.Valid, validator(ProviderId.DEEPGRAM).validate(ProviderId.DEEPGRAM, "k"))
        val rec = server.takeRequest()
        assertEquals("GET", rec.method)
        assertEquals(0L, rec.bodySize)
    }

    @Test fun cancellationPropagatesInsteadOfBecomingNetwork() = runBlocking<Unit> {
        server.enqueue(MockResponse().setResponseCode(200).setHeadersDelay(2, TimeUnit.SECONDS))
        val v = validator()
        assertFailsWith<TimeoutCancellationException> {
            withTimeout(200) { v.validate(ProviderId.OPENAI, "k") }
        }
    }

    @Test fun networkResultHasAMessageEvenWithoutExceptionText() = runBlocking<Unit> {
        val failing = client.newBuilder().addInterceptor { throw java.io.IOException() }.build()
        val r = KeyValidator(failing, mapOf(ProviderId.OPENAI to server.base("/v1"))).validate(ProviderId.OPENAI, "k")
        assertEquals(KeyValidation.Network("IOException"), r)
    }

    // ---- self-hosted: "the key" is the server URL

    @Test fun selfHostedRejectionsCarryThePolicyMessage() = runBlocking<Unit> {
        val v = KeyValidator(client)
        assertEquals(
            KeyValidation.InvalidUrl(BaseUrlError.InsecureHttp("example.com").description),
            v.validate(ProviderId.SELFHOSTED, "example.com"),
        )
        assertEquals(
            KeyValidation.InvalidUrl(BaseUrlError.UnsupportedScheme("ftp").description),
            v.validate(ProviderId.SELFHOSTED, "ftp://nas/v1"),
        )
        assertEquals(KeyValidation.InvalidUrl(BaseUrlError.Invalid.description), v.validate(ProviderId.SELFHOSTED, "not a url"))
        assertEquals(KeyValidation.Unexpected(0), v.validate(ProviderId.SELFHOSTED, ""))
    }

    @Test fun selfHostedAcceptsLanAndHttpsWithoutTouchingTheNetwork() = runBlocking<Unit> {
        val v = KeyValidator(client)
        for (url in listOf("localhost:8000", "http://[::1]:9000/v1", " http://nas.local/v1 ", "https://stt.example.com")) {
            assertEquals(KeyValidation.Valid, v.validate(ProviderId.SELFHOSTED, url), url)
        }
        assertEquals(0, server.requestCount)
    }

    @Test fun networkReasonForRealTransportFailureIsNonEmpty() = runBlocking<Unit> {
        val v = validator()
        server.shutdown()
        val r = assertIs<KeyValidation.Network>(v.validate(ProviderId.OPENAI, "k"))
        assertTrue(r.message.isNotBlank())
    }
}
