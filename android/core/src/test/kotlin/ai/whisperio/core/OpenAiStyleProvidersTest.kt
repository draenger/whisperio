package ai.whisperio.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** OpenAI, Groq, Mistral and self-hosted share one wire format; each is asserted field by field. */
class OpenAiStyleProvidersTest {
    private lateinit var server: MockWebServer
    private val client = HttpClients.localClient()
    private val audio = audioFixture()

    @Before fun start() { server = MockWebServer().apply { start() } }
    @After fun stop() { server.shutdown() }

    private fun req(lang: String = "en", vocab: String = "") = TranscriptionRequest(audio, lang, vocab)

    // ---- OpenAI

    @Test fun openAiWireFormat() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"hello there"}""")
        val p = OpenAiProvider("sk-test", "gpt-4o-transcribe", server.base("/v1"), client)
        val r = p.transcribe(req("pl", "Whisperio, Kotlin"))
        assertEquals("hello there", r.text)
        assertEquals(ProviderId.OPENAI, r.provider)
        assertEquals("gpt-4o-transcribe", r.model)

        val rec = server.takeRequest()
        assertEquals("POST", rec.method)
        assertEquals("/v1/audio/transcriptions", rec.path)
        assertEquals("Bearer sk-test", rec.getHeader("Authorization"))
        assertTrue(rec.getHeader("Content-Type")!!.startsWith("multipart/form-data; boundary="))
        assertEquals(listOf("model", "language", "prompt", "file"), rec.partNames())
        val f = rec.fields()
        assertEquals("gpt-4o-transcribe", f["model"])
        assertEquals("pl", f["language"])
        assertEquals("Whisperio, Kotlin", f["prompt"])
    }

    @Test fun openAiFilePart() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"x"}""")
        OpenAiProvider("k", "", server.base("/v1"), client).transcribe(req())
        val file = server.takeRequest().multipartParts().single { it.name == "file" }
        assertEquals("FAKE-AUDIO-BYTES", file.body)
        assertEquals(audio.name, file.filename)
        assertEquals("application/octet-stream", file.contentType)
    }

    @Test fun openAiOmitsLanguageForAutoAndPromptForBlankVocabulary() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"x"}""")
        val r = OpenAiProvider("k", "", server.base("/v1"), client).transcribe(req("auto", "   "))
        assertEquals("whisper-1", r.model) // blank model -> default
        assertEquals(listOf("model", "file"), server.takeRequest().partNames())
    }

    @Test fun openAiTrailingSlashBase() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"x"}""")
        OpenAiProvider("k", "m", server.base("/v1") + "/", client).transcribe(req())
        assertEquals("/v1/audio/transcriptions", server.takeRequest().path)
    }

    @Test fun openAiRejectsPublicHttpBase() {
        val e = assertFailsWith<ProviderError.BaseUrlRejected> {
            runBlocking { OpenAiProvider("k", "m", "http://api.openai.com/v1", client).transcribe(req()) }
        }
        assertTrue(e.message!!.contains("public host"))
        assertEquals(0, server.requestCount)
    }

    @Test fun openAiNon2xxIsRedactedProviderError() {
        server.enqueueJson("""{"error":{"message":"Incorrect API key provided: sk-secretsecret1234"}}""", 401)
        val e = assertFailsWith<ProviderError.Http> {
            runBlocking { OpenAiProvider("sk-secretsecret1234", "m", server.base("/v1"), client).transcribe(req()) }
        }
        assertEquals(401, e.status)
        assertEquals(ProviderId.OPENAI, e.provider)
        assertFalse(e.message!!.contains("secretsecret1234"))
        assertTrue(e.message!!.startsWith("OpenAI error: HTTP 401: Incorrect API key provided"))
    }

    @Test fun openAiMalformedSuccessBodyIsFailed() {
        server.enqueueJson("""not json""")
        assertFailsWith<ProviderError.Failed> {
            runBlocking { OpenAiProvider("k", "m", server.base("/v1"), client).transcribe(req()) }
        }
    }

    @Test fun openAiMissingTextIsFailed() {
        server.enqueueJson("""{"other":1}""")
        assertFailsWith<ProviderError.Failed> {
            runBlocking { OpenAiProvider("k", "m", server.base("/v1"), client).transcribe(req()) }
        }
    }

    @Test fun openAiBlankKeyIsNotConfiguredAndSendsNothing() {
        val p = OpenAiProvider("  ", "m", server.base("/v1"), client)
        assertFalse(p.isConfigured)
        assertFailsWith<ProviderError.NotConfigured> { runBlocking { p.transcribe(req()) } }
        assertEquals(0, server.requestCount)
    }

    @Test fun openAiNetworkFailureIsNetworkError() {
        val base = server.base("/v1")
        server.shutdown()
        assertFailsWith<ProviderError.Network> {
            runBlocking { OpenAiProvider("k", "m", base, client).transcribe(req()) }
        }
    }

    @Test fun redirectsAreNotFollowed() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "http://example.com/steal"))
        val e = assertFailsWith<ProviderError.Http> {
            runBlocking { OpenAiProvider("k", "m", server.base("/v1"), client).transcribe(req()) }
        }
        assertEquals(302, e.status)
        assertEquals(1, server.requestCount)
    }

    @Test fun oversizeFileFailsBeforeAnyRequest() {
        val big = File.createTempFile("big", ".m4a").apply {
            deleteOnExit()
            java.io.RandomAccessFile(this, "rw").use { it.setLength(MAX_UPLOAD_BYTES + 1) }
        }
        val request = TranscriptionRequest(big, "en")
        val providers = listOf(
            OpenAiProvider("k", "m", server.base("/v1"), client),
            GroqProvider("k", "m", server.base("/openai/v1"), client),
            MistralProvider("k", "m", server.base("/v1"), client),
        )
        for (p in providers) {
            val e = assertFailsWith<ProviderError.FileTooLarge>(p.id.wire) { runBlocking { p.transcribe(request) } }
            assertEquals(25L * 1024 * 1024, e.limitBytes)
        }
        assertEquals(0, server.requestCount)
    }

    // ---- Groq

    @Test fun groqWireFormat() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"groq text"}""")
        val r = GroqProvider("gsk_test", "whisper-large-v3", server.base("/openai/v1"), client)
            .transcribe(req("de", "term"))
        assertEquals("groq text", r.text)
        val rec = server.takeRequest()
        assertEquals("POST", rec.method)
        assertEquals("/openai/v1/audio/transcriptions", rec.path)
        assertEquals("Bearer gsk_test", rec.getHeader("Authorization"))
        assertEquals(listOf("model", "language", "prompt", "file"), rec.partNames())
        assertEquals(mapOf("model" to "whisper-large-v3", "language" to "de", "prompt" to "term"), rec.fields())
    }

    @Test fun groqModelAliases() {
        fun m(s: String) = GroqProvider("k", s).apiModel()
        assertEquals("whisper-large-v3-turbo", m(""))
        assertEquals("whisper-large-v3-turbo", m("distil-whisper")) // retired -> default
        assertEquals("whisper-large-v3-turbo", m("distil-whisper-large-v3-en"))
        assertEquals("whisper-large-v3", m("whisper-large-v3"))
    }

    @Test fun groqAutoLanguageOmitsLanguageAndNoPromptWhenBlank() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"x"}""")
        GroqProvider("k", "", server.base("/openai/v1"), client).transcribe(req("auto"))
        assertEquals(mapOf("model" to "whisper-large-v3-turbo"), server.takeRequest().fields())
    }

    @Test fun groqNon2xx() {
        server.enqueueJson("""{"error":{"message":"rate limited"}}""", 429)
        val e = assertFailsWith<ProviderError.Http> {
            runBlocking { GroqProvider("k", "", server.base("/openai/v1"), client).transcribe(req()) }
        }
        assertEquals("Groq error: HTTP 429: rate limited", e.message)
    }

    // ---- Mistral

    @Test fun mistralWireFormatHasNoPrompt() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"mistral text"}""")
        val r = MistralProvider("mk", "voxtral-mini", server.base("/v1"), client).transcribe(req("fr", "ignored vocab"))
        assertEquals("mistral text", r.text)
        val rec = server.takeRequest()
        assertEquals("/v1/audio/transcriptions", rec.path)
        assertEquals("Bearer mk", rec.getHeader("Authorization"))
        assertEquals(listOf("model", "language", "file"), rec.partNames())
        assertEquals(mapOf("model" to "voxtral-mini-latest", "language" to "fr"), rec.fields())
    }

    @Test fun mistralModelAliases() {
        fun m(s: String) = MistralProvider("k", s).apiModel()
        assertEquals("voxtral-small-latest", m(""))
        assertEquals("voxtral-small-latest", m("voxtral-small"))
        assertEquals("voxtral-mini-latest", m("voxtral-mini"))
        assertEquals("voxtral-small-latest", m("voxtral-small-latest"))
    }

    @Test fun mistralAutoOmitsLanguage() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"x"}""")
        MistralProvider("k", "", server.base("/v1"), client).transcribe(req("auto"))
        assertEquals(mapOf("model" to "voxtral-small-latest"), server.takeRequest().fields())
    }

    @Test fun mistralNon2xx() {
        server.enqueueJson("""{"message":"unauthorized"}""", 401)
        val e = assertFailsWith<ProviderError.Http> {
            runBlocking { MistralProvider("k", "", server.base("/v1"), client).transcribe(req()) }
        }
        assertEquals("Mistral error: HTTP 401: unauthorized", e.message)
    }

    // ---- Self-hosted

    @Test fun selfHostedAppendsV1AndSendsOptionalBearer() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"local text"}""")
        val r = SelfHostedProvider(server.base(), "secret", "", client).transcribe(req("en", "vocab ignored"))
        assertEquals("local text", r.text)
        val rec = server.takeRequest()
        assertEquals("POST", rec.method)
        assertEquals("/v1/audio/transcriptions", rec.path)
        assertEquals("Bearer secret", rec.getHeader("Authorization"))
        assertEquals(listOf("model", "language", "file"), rec.partNames())
        assertEquals(mapOf("model" to "whisper-1", "language" to "en"), rec.fields())
    }

    @Test fun selfHostedKeepsExistingV1AndOmitsAuthWithoutKey() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"x"}""")
        SelfHostedProvider(server.base("/v1"), null, "large", client).transcribe(req("auto"))
        val rec = server.takeRequest()
        assertEquals("/v1/audio/transcriptions", rec.path)
        assertNull(rec.getHeader("Authorization"))
        assertEquals(mapOf("model" to "large"), rec.fields())
    }

    @Test fun selfHostedBareHostIsReadAsHttp() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"x"}""")
        val bare = "${server.hostName}:${server.port}"
        SelfHostedProvider(bare, null, "", client).transcribe(req())
        assertEquals("/v1/audio/transcriptions", server.takeRequest().path)
    }

    @Test fun selfHostedNormalizedBase() {
        assertEquals("http://localhost:8000/v1", SelfHostedProvider.normalizedBase("localhost:8000").toString())
        assertEquals("http://localhost:8000/v1", SelfHostedProvider.normalizedBase("http://localhost:8000/v1/").toString())
        assertNull(SelfHostedProvider.normalizedBase("http://example.com"))
        assertNull(SelfHostedProvider.normalizedBase(""))
    }

    @Test fun selfHostedPublicHttpRejectedAndEmptyNotConfigured() {
        val bad = SelfHostedProvider("http://example.com", null, "", client)
        assertFalse(bad.isConfigured)
        assertFailsWith<ProviderError.BaseUrlRejected> { runBlocking { bad.transcribe(req()) } }
        assertFailsWith<ProviderError.NotConfigured> {
            runBlocking { SelfHostedProvider("", null, "", client).transcribe(req()) }
        }
    }

    @Test fun selfHostedNon2xx() {
        server.enqueueJson("""{"detail":"model not found"}""", 404)
        val e = assertFailsWith<ProviderError.Http> {
            runBlocking { SelfHostedProvider(server.base(), null, "", client).transcribe(req()) }
        }
        assertEquals("Self-hosted server error: HTTP 404: model not found", e.message)
    }

    @Test fun selfHostedHasNoSizeLimit() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"x"}""")
        val big = File.createTempFile("big", ".m4a").apply {
            deleteOnExit()
            java.io.RandomAccessFile(this, "rw").use { it.setLength(MAX_UPLOAD_BYTES + 1) }
        }
        val r = SelfHostedProvider(server.base(), null, "", client).transcribe(TranscriptionRequest(big, "en"))
        assertEquals("x", r.text)
    }
}
