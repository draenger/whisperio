package ai.whisperio.core

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Before
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** ElevenLabs, Deepgram and AssemblyAI each have their own wire format. */
class NativeApiProvidersTest {
    private lateinit var server: MockWebServer
    private val client = HttpClients.localClient()
    private val audio = audioFixture()

    @Before fun start() { server = MockWebServer().apply { start() } }
    @After fun stop() { server.shutdown() }

    private fun req(lang: String = "en", vocab: String = "") = TranscriptionRequest(audio, lang, vocab)

    // ---- ElevenLabs

    @Test fun elevenLabsWireFormatWithKeyterms() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"eleven text"}""")
        val r = ElevenLabsProvider("xi-key", "", server.base("/v1"), client)
            .transcribe(req("pl", "Whisperio, Kotlin Native"))
        assertEquals("eleven text", r.text)
        assertEquals("scribe_v2", r.model) // keyterms need v2
        val rec = server.takeRequest()
        assertEquals("POST", rec.method)
        assertEquals("/v1/speech-to-text", rec.path)
        assertEquals("xi-key", rec.getHeader("xi-api-key"))
        assertNull(rec.getHeader("Authorization"))
        assertEquals(listOf("model_id", "language_code", "keyterms", "file"), rec.partNames())
        val f = rec.fields()
        assertEquals("scribe_v2", f["model_id"])
        assertEquals("pl", f["language_code"])
        assertEquals("""["Whisperio","Kotlin Native"]""", f["keyterms"])
    }

    @Test fun elevenLabsPlainDefaultsToV1AndOmitsOptionalFields() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"x"}""")
        ElevenLabsProvider("k", "", server.base("/v1"), client).transcribe(req("auto", "  ,  "))
        assertEquals(mapOf("model_id" to "scribe_v1"), server.takeRequest().fields())
    }

    @Test fun elevenLabsDefaultChipIsUpgradedOnlyWhenKeytermsPresent() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"x"}""")
        server.enqueueJson("""{"text":"x"}""")
        val p = ElevenLabsProvider("k", "scribe_v1", server.base("/v1"), client)
        p.transcribe(req("auto", ""))
        p.transcribe(req("auto", "Acme"))
        assertEquals("scribe_v1", server.takeRequest().fields()["model_id"])
        assertEquals("scribe_v2", server.takeRequest().fields()["model_id"])
    }

    @Test fun elevenLabsKeytermFilter() {
        val long = "x".repeat(51)
        val terms = ElevenLabsProvider.cleanKeyterms(
            "ok, a b c d e, a b c d e f, $long, has<angle>, brace{, sq[uare, back\\slash, , fine",
        )
        assertEquals(listOf("ok", "a b c d e", "fine"), terms)
        assertTrue(ElevenLabsProvider.cleanKeyterms("x".repeat(50)).size == 1)
    }

    @Test fun elevenLabsNon2xx() {
        server.enqueueJson("""{"detail":"invalid api key"}""", 401)
        val e = assertFailsWith<ProviderError.Http> {
            runBlocking { ElevenLabsProvider("k", "", server.base("/v1"), client).transcribe(req()) }
        }
        assertEquals("ElevenLabs error: HTTP 401: invalid api key", e.message)
    }

    @Test fun elevenLabsHasNoSizeLimitCheck() = runBlocking<Unit> {
        server.enqueueJson("""{"text":"x"}""")
        val big = java.io.File.createTempFile("big", ".m4a").apply {
            deleteOnExit()
            java.io.RandomAccessFile(this, "rw").use { it.setLength(MAX_UPLOAD_BYTES + 1) }
        }
        assertEquals("x", ElevenLabsProvider("k", "", server.base("/v1"), client).transcribe(TranscriptionRequest(big, "en")).text)
    }

    // ---- Deepgram

    private val deepgramBody = """{"results":{"channels":[{"alternatives":[{"transcript":"deepgram text"}]}]}}"""

    @Test fun deepgramWireFormat() = runBlocking<Unit> {
        server.enqueueJson(deepgramBody)
        val r = DeepgramProvider("dg-key", "", server.base("/v1"), client).transcribe(req("es"))
        assertEquals("deepgram text", r.text)
        assertEquals("nova-3", r.model)
        val rec = server.takeRequest()
        assertEquals("POST", rec.method)
        assertEquals("/v1/listen", rec.requestUrl!!.encodedPath)
        assertEquals("nova-3", rec.requestUrl!!.queryParameter("model"))
        assertEquals("true", rec.requestUrl!!.queryParameter("smart_format"))
        assertEquals("es", rec.requestUrl!!.queryParameter("language"))
        assertEquals("Token dg-key", rec.getHeader("Authorization"))
        assertEquals("application/octet-stream", rec.getHeader("Content-Type"))
        assertEquals("FAKE-AUDIO-BYTES", rec.body.readUtf8()) // raw body, not multipart
    }

    @Test fun deepgramAutoOmitsLanguage() = runBlocking<Unit> {
        server.enqueueJson(deepgramBody)
        DeepgramProvider("k", "nova-2", server.base("/v1"), client).transcribe(req("auto"))
        val url = server.takeRequest().requestUrl!!
        assertNull(url.queryParameter("language"))
        assertEquals("nova-2", url.queryParameter("model"))
    }

    @Test fun deepgramModelAliases() {
        fun m(s: String) = DeepgramProvider("k", s).apiModel()
        assertEquals("nova-3", m(""))
        assertEquals("whisper-large", m("whisper-cloud"))
        assertEquals("nova-2", m("nova-2"))
    }

    @Test fun deepgramMissingTranscriptIsFailed() {
        server.enqueueJson("""{"results":{"channels":[]}}""")
        assertFailsWith<ProviderError.Failed> {
            runBlocking { DeepgramProvider("k", "", server.base("/v1"), client).transcribe(req()) }
        }
    }

    @Test fun deepgramNon2xx() {
        server.enqueueJson("""{"err_msg":"x","message":"bad creds"}""", 403)
        val e = assertFailsWith<ProviderError.Http> {
            runBlocking { DeepgramProvider("k", "", server.base("/v1"), client).transcribe(req()) }
        }
        assertEquals("Deepgram error: HTTP 403: bad creds", e.message)
    }

    // ---- AssemblyAI

    /** Scripted AssemblyAI: [pollStatuses] are returned in order, the last one repeats. */
    private fun assemblyDispatcher(pollStatuses: List<String>, requests: MutableList<RecordedRequest>) =
        object : Dispatcher() {
            var polls = 0
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request
                val path = request.requestUrl!!.encodedPath
                val json = when {
                    path == "/v2/upload" -> """{"upload_url":"https://cdn.example/audio-1"}"""
                    path == "/v2/transcript" -> """{"id":"job-9","status":"queued"}"""
                    path == "/v2/transcript/job-9" -> {
                        val s = pollStatuses[minOf(polls++, pollStatuses.size - 1)]
                        when (s) {
                            "completed" -> """{"id":"job-9","status":"completed","text":"assembly text"}"""
                            "error" -> """{"id":"job-9","status":"error","error":"bad audio sk-abcdef1234567890"}"""
                            else -> """{"id":"job-9","status":"$s"}"""
                        }
                    }
                    else -> return MockResponse().setResponseCode(404)
                }
                return MockResponse().setHeader("Content-Type", "application/json").setBody(json)
            }
        }

    @Test fun assemblyAiFullFlow() = runBlocking<Unit> {
        val seen = mutableListOf<RecordedRequest>()
        server.dispatcher = assemblyDispatcher(listOf("queued", "processing", "completed"), seen)
        val delays = mutableListOf<Long>()
        val p = AssemblyAiProvider("aai-key", "universal-2", server.base("/v2"), client, delayFn = { delays += it })
        val r = p.transcribe(req("en"))
        assertEquals("assembly text", r.text)
        assertEquals("universal", r.model)
        assertEquals(listOf(2000L, 2000L, 2000L), delays)

        assertEquals(5, seen.size)
        val upload = seen[0]
        assertEquals("POST", upload.method)
        assertEquals("/v2/upload", upload.path)
        assertEquals("aai-key", upload.getHeader("authorization"))
        assertEquals("application/octet-stream", upload.getHeader("Content-Type"))
        assertEquals("FAKE-AUDIO-BYTES", upload.body.readUtf8())

        val create = seen[1]
        assertEquals("POST", create.method)
        assertEquals("/v2/transcript", create.path)
        assertEquals("aai-key", create.getHeader("authorization"))
        assertTrue(create.getHeader("Content-Type")!!.startsWith("application/json"))
        val json = kotlinx.serialization.json.Json.parseToJsonElement(create.body.readUtf8()) as kotlinx.serialization.json.JsonObject
        assertEquals("https://cdn.example/audio-1", json.string("audio_url"))
        assertEquals("universal", json.string("speech_model"))
        assertEquals("en", json.string("language_code"))
        assertNull(json["language_detection"])

        for (poll in seen.drop(2)) {
            assertEquals("GET", poll.method)
            assertEquals("/v2/transcript/job-9", poll.path)
            assertEquals("aai-key", poll.getHeader("authorization"))
        }
    }

    @Test fun assemblyAiAutoLanguageUsesDetection() = runBlocking<Unit> {
        val seen = mutableListOf<RecordedRequest>()
        server.dispatcher = assemblyDispatcher(listOf("completed"), seen)
        AssemblyAiProvider("k", "universal-1", server.base("/v2"), client, delayFn = {}).transcribe(req("auto"))
        val json = kotlinx.serialization.json.Json.parseToJsonElement(seen[1].body.readUtf8()) as kotlinx.serialization.json.JsonObject
        assertEquals("best", json.string("speech_model"))
        assertEquals("true", json.string("language_detection"))
        assertNull(json["language_code"])
    }

    @Test fun assemblyAiModelAliases() {
        fun m(s: String) = AssemblyAiProvider("k", s).apiModel()
        assertEquals("universal", m(""))
        assertEquals("universal", m("universal-2"))
        assertEquals("best", m("universal-1"))
        assertEquals("universal", m("universal"))
    }

    @Test fun assemblyAiErrorStatusIsRedactedFailure() {
        server.dispatcher = assemblyDispatcher(listOf("error"), mutableListOf())
        val e = assertFailsWith<ProviderError.Failed> {
            runBlocking { AssemblyAiProvider("k", "", server.base("/v2"), client, delayFn = {}).transcribe(req()) }
        }
        assertEquals("AssemblyAI failed: bad audio ***", e.message)
    }

    @Test fun assemblyAiPollsAtMost150TimesThenTimesOut() {
        val seen = mutableListOf<RecordedRequest>()
        server.dispatcher = assemblyDispatcher(listOf("processing"), seen)
        var delays = 0
        val e = assertFailsWith<ProviderError.Failed> {
            runBlocking {
                AssemblyAiProvider("k", "", server.base("/v2"), client, delayFn = { delays++ }).transcribe(req())
            }
        }
        assertEquals("AssemblyAI timed out waiting for the transcript.", e.message)
        assertEquals(150, delays)
        assertEquals(2 + 150, seen.size)
    }

    @Test fun assemblyAiUploadErrorNamesTheStep() {
        server.enqueueJson("""{"error":"Invalid API key"}""", 401)
        val e = assertFailsWith<ProviderError.Http> {
            runBlocking { AssemblyAiProvider("k", "", server.base("/v2"), client, delayFn = {}).transcribe(req()) }
        }
        assertEquals("AssemblyAI upload error: HTTP 401: Invalid API key", e.message)
        assertEquals(1, server.requestCount)
    }
}
