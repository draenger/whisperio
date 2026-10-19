package ai.whisperio.android

import ai.whisperio.android.dictation.DictationController
import ai.whisperio.android.dictation.DictationError
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.dictation.RetryOutcome
import ai.whisperio.android.dictation.retryChoices
import ai.whisperio.android.dictation.singleProviderChain
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.settings.AppSettings
import ai.whisperio.android.settings.ProviderSlot
import ai.whisperio.android.settings.toChainSettings
import ai.whisperio.core.ProviderId
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** CONTRACT-1.1 F5: retry with a chosen provider is a single attempt, never a fallback, and a failure keeps the text. */
@OptIn(ExperimentalCoroutinesApi::class)
class RetryWithProviderTest {
    @get:Rule val tmp = TemporaryFolder()

    private val transcriber = FakeTranscriber(text = "new text")
    private val history = FakeHistory()
    private val settings = FakeSettings(
        settings = FakeSettings.defaultSettings().copy(fallbackEnabled = true),
        keys = mapOf(ProviderId.OPENAI to "sk-a", ProviderId.GROQ to "gsk-b"),
    )

    private fun TestScope.controller() = DictationController(
        scope = CoroutineScope(StandardTestDispatcher(testScheduler)),
        recorder = FakeRecorder(),
        focus = FakeFocus(),
        transcriber = transcriber,
        settings = settings,
        history = history,
        tidy = { it },
        recordingsDir = File(tmp.root, "recordings"),
        micGranted = { true },
        nowMs = { testScheduler.currentTime },
        wallClockMs = { 1_000_000L },
    )

    private suspend fun seed(audio: Boolean = true, status: RecordingStatus = RecordingStatus.DONE): Recording {
        val file = File(tmp.root, "r1.m4a").also { if (audio) it.writeBytes(ByteArray(64) { 1 }) }
        val row = Recording(
            id = "r1", createdAt = 1L, durationMs = 5_000, status = status, provider = "openai", model = "whisper-1",
            language = "pl", transcript = "old text", audioPath = file.path.takeIf { audio }, source = RecordingSource.APP,
        )
        history.upsert(row)
        return row
    }

    private fun TestScope.collectOutcomes(c: DictationController): MutableList<RetryOutcome> {
        val outcomes = mutableListOf<RetryOutcome>()
        backgroundScope.launch { c.retryOutcomes.collect { outcomes += it } }
        runCurrent()
        return outcomes
    }

    @Test fun singleAttemptWithOnlyTheChosenProviderEvenWhenFallbackIsOn() = runTest {
        seed()
        val c = controller()
        c.retryWith("r1", ProviderId.GROQ); runCurrent()

        val (req, chain) = transcriber.calls.single()
        assertEquals(listOf(ProviderId.GROQ), chain.order.map { it.id })
        assertFalse(chain.fallbackEnabled)
        assertEquals("pl", req.language) // the clip keeps the language it was recorded with
        val row = history.rows.value["r1"]!!
        assertEquals("new text", row.transcript)
        assertEquals("groq", row.provider)
        assertEquals("whisper-large-v3-turbo", row.model)
        assertEquals(RecordingStatus.DONE, row.status)
        assertEquals(DictationState.Idle, c.state.value)
    }

    @Test fun failureKeepsPreviousTextAndStatusAndSuccessIsReported() = runTest {
        seed()
        val c = controller()
        val outcomes = collectOutcomes(c)

        transcriber.failure = IllegalStateException("HTTP 500 boom")
        c.retryWith("r1", ProviderId.GROQ); runCurrent()

        val failure = outcomes.single() as RetryOutcome.Failure
        assertEquals(DictationError.PROVIDER, failure.error)
        assertEquals("HTTP 500 boom", failure.detail)
        val row = history.rows.value["r1"]!!
        assertEquals("old text", row.transcript)
        assertEquals("openai", row.provider)
        assertEquals("whisper-1", row.model)
        assertEquals(RecordingStatus.DONE, row.status)
        assertTrue(File(row.audioPath!!).exists()) // the clip stays for another try
        assertEquals(1, transcriber.calls.size) // no second provider was tried
        assertEquals(DictationState.Idle, c.state.value)

        transcriber.failure = null
        c.retryWith("r1", ProviderId.OPENAI); runCurrent()
        assertTrue(outcomes.last() is RetryOutcome.Success)
    }

    @Test fun failedRowStaysFailedWhenRetryFails() = runTest {
        seed(status = RecordingStatus.FAILED)
        transcriber.failure = IllegalStateException("nope")
        val c = controller()
        c.retryWith("r1", ProviderId.OPENAI); runCurrent()
        assertEquals(RecordingStatus.FAILED, history.rows.value["r1"]!!.status)
    }

    @Test fun providerWithoutKeyIsRefusedWithoutUpload() = runTest {
        seed()
        val c = controller()
        val outcomes = collectOutcomes(c)
        c.retryWith("r1", ProviderId.MISTRAL); runCurrent()
        assertEquals(DictationError.NO_KEY, (outcomes.single() as RetryOutcome.Failure).error)
        assertTrue(transcriber.calls.isEmpty())
    }

    @Test fun missingConsentIsRefusedWithoutUpload() = runTest {
        seed()
        settings.settings = settings.settings.copy(cloudConsentGranted = false)
        val c = controller()
        val outcomes = collectOutcomes(c)
        c.retryWith("r1", ProviderId.OPENAI); runCurrent()
        assertEquals(DictationError.CONSENT_MISSING, (outcomes.single() as RetryOutcome.Failure).error)
        assertTrue(transcriber.calls.isEmpty())
    }

    @Test fun goneAudioIsRefusedAndKeepsTheRow() = runTest {
        seed(audio = false)
        val c = controller()
        val outcomes = collectOutcomes(c)
        c.retryWith("r1", ProviderId.OPENAI); runCurrent()
        assertEquals(DictationError.NO_AUDIO, (outcomes.single() as RetryOutcome.Failure).error)
        assertEquals("old text", history.rows.value["r1"]!!.transcript)
        assertTrue(transcriber.calls.isEmpty())
    }

    @Test fun choicesAreOnlyProvidersWithAKeyInPriorityOrder() {
        val s = AppSettings(
            order = listOf(
                ProviderSlot(ProviderId.GROQ, "m"), ProviderSlot(ProviderId.OPENAI, "m"),
                ProviderSlot(ProviderId.MISTRAL, "m"), ProviderSlot(ProviderId.SELFHOSTED, "m"),
            ),
            baseUrls = mapOf(ProviderId.SELFHOSTED to "http://192.168.1.5:8000"),
            cloudConsentGranted = true,
        )
        val chain = s.toChainSettings(mapOf(ProviderId.OPENAI to "k", ProviderId.GROQ to "k", ProviderId.MISTRAL to " "))
        assertEquals(listOf(ProviderId.GROQ, ProviderId.OPENAI, ProviderId.SELFHOSTED), retryChoices(chain).map { it.id })
        assertNull(singleProviderChain(chain, ProviderId.MISTRAL))
        assertEquals(listOf(ProviderId.OPENAI), singleProviderChain(chain, ProviderId.OPENAI)!!.order.map { it.id })
    }

    @Test fun selfHostedWithoutUrlIsNotOffered() {
        val s = AppSettings(order = listOf(ProviderSlot(ProviderId.SELFHOSTED, "m")), cloudConsentGranted = true)
        assertTrue(retryChoices(s.toChainSettings(emptyMap())).isEmpty())
    }
}
