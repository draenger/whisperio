package ai.whisperio.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

class KeyValidatorTest {
    private lateinit var server: MockWebServer
    private val client = HttpClients.localClient()

    @Before fun start() { server = MockWebServer().apply { start() } }
    @After fun stop() { server.shutdown() }

    private fun validator(id: ProviderId, prefix: String) =
        KeyValidator(client, mapOf(id to server.base(prefix)))

    private fun verifyGet(id: ProviderId, prefix: String, expectedPath: String, header: String, expectedValue: String) =
        runBlocking<Unit> {
            server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
            assertEquals(KeyValidation.Valid, validator(id, prefix).validate(id, "the-key"))
            val rec = server.takeRequest()
            assertEquals("GET", rec.method)
            assertEquals(expectedPath, rec.path)
            assertEquals(expectedValue, rec.getHeader(header))
        }

    @Test fun openAi() = verifyGet(ProviderId.OPENAI, "/v1", "/v1/models", "Authorization", "Bearer the-key")
    @Test fun groq() = verifyGet(ProviderId.GROQ, "/openai/v1", "/openai/v1/models", "Authorization", "Bearer the-key")
    @Test fun mistral() = verifyGet(ProviderId.MISTRAL, "/v1", "/v1/models", "Authorization", "Bearer the-key")
    @Test fun elevenLabs() = verifyGet(ProviderId.ELEVENLABS, "/v1", "/v1/user", "xi-api-key", "the-key")
    @Test fun deepgram() = verifyGet(ProviderId.DEEPGRAM, "/v1", "/v1/projects", "Authorization", "Token the-key")
    @Test fun assemblyAi() = verifyGet(ProviderId.ASSEMBLYAI, "/v2", "/v2/transcript?limit=1", "authorization", "the-key")

    @Test fun statusMapping() = runBlocking<Unit> {
        val v = validator(ProviderId.OPENAI, "/v1")
        server.enqueue(MockResponse().setResponseCode(401))
        assertEquals(KeyValidation.InvalidKey, v.validate(ProviderId.OPENAI, "k"))
        server.enqueue(MockResponse().setResponseCode(403))
        assertEquals(KeyValidation.InvalidKey, v.validate(ProviderId.OPENAI, "k"))
        server.enqueue(MockResponse().setResponseCode(500))
        assertEquals(KeyValidation.Unexpected(500), v.validate(ProviderId.OPENAI, "k"))
        server.enqueue(MockResponse().setResponseCode(204))
        assertEquals(KeyValidation.Valid, v.validate(ProviderId.OPENAI, "k"))
    }

    @Test fun transportFailureIsNetwork() = runBlocking<Unit> {
        val v = validator(ProviderId.OPENAI, "/v1")
        server.shutdown()
        assertIs<KeyValidation.Network>(v.validate(ProviderId.OPENAI, "k"))
    }

    @Test fun redirectIsNotFollowedAndIsUnexpected() = runBlocking<Unit> {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "http://example.com/"))
        assertEquals(KeyValidation.Unexpected(302), validator(ProviderId.OPENAI, "/v1").validate(ProviderId.OPENAI, "k"))
        assertEquals(1, server.requestCount)
    }

    @Test fun selfHostedChecksOnlyThePolicy() = runBlocking<Unit> {
        val v = KeyValidator(client)
        assertEquals(KeyValidation.Valid, v.validate(ProviderId.SELFHOSTED, "192.168.1.5:5000"))
        assertEquals(KeyValidation.Valid, v.validate(ProviderId.SELFHOSTED, "https://stt.example.com/v1"))
        assertIs<KeyValidation.InvalidUrl>(v.validate(ProviderId.SELFHOSTED, "http://example.com"))
        assertEquals(KeyValidation.Unexpected(0), v.validate(ProviderId.SELFHOSTED, "  "))
        assertEquals(0, server.requestCount)
    }

    @Test fun defaultsPointAtTheOfficialHosts() {
        assertNull(ProviderCatalog.info(ProviderId.SELFHOSTED).defaultBaseUrl)
        assertEquals("https://api.openai.com/v1", ProviderCatalog.info(ProviderId.OPENAI).defaultBaseUrl)
    }
}
