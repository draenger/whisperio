package ai.whisperio.android

import ai.whisperio.android.dictation.DictationController
import ai.whisperio.android.dictation.DictationError
import ai.whisperio.android.dictation.DictationResult
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.dictation.StartOptions
import ai.whisperio.android.di.TextTidy
import ai.whisperio.android.history.HistoryStore
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.settings.AppSettings
import ai.whisperio.core.ProviderId
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.launch
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.Rule

@OptIn(ExperimentalCoroutinesApi::class)
class DictationControllerTest {
    @get:Rule val tmp = TemporaryFolder()

    private lateinit var recorder: FakeRecorder
    private lateinit var focus: FakeFocus
    private lateinit var transcriber: FakeTranscriber
    private lateinit var settings: FakeSettings
    private lateinit var history: FakeHistory
    private var mic = true
    private var ids = 0

    @Before fun setUp() {
        recorder = FakeRecorder()
        focus = FakeFocus()
        transcriber = FakeTranscriber()
        settings = FakeSettings()
        history = FakeHistory()
        mic = true
        ids = 0
    }

    @After fun tearDown() = Unit

    private fun TestScope.controller(tidy: TextTidy = TextTidy { it }) = DictationController(
        scope = CoroutineScope(StandardTestDispatcher(testScheduler)),
        recorder = recorder,
        focus = focus,
        transcriber = transcriber,
        settings = settings,
        history = history,
        tidy = tidy,
        recordingsDir = File(tmp.root, "recordings"),
        micGranted = { mic },
        nowMs = { testScheduler.currentTime },
        wallClockMs = { 1_000_000L },
        newId = { "id${++ids}" },
    )

    private fun TestScope.advance(ms: Long) {
        advanceTimeBy(ms)
        runCurrent()
    }

    private fun audioFile(id: String) = File(File(tmp.root, "recordings"), "$id.m4a")

    @Test fun happyPathRecordsTranscribesAndSavesHistory() = runTest {
        val c = controller()
        val results = mutableListOf<DictationResult>()
        backgroundScope.launch { c.results.collect { results += it } }
        runCurrent()

        c.start(StartOptions(RecordingSource.KEYBOARD, session = "field-1"))
        runCurrent()
        assertTrue(c.state.value is DictationState.Recording)
        advance(1_000)
        assertTrue((c.state.value as DictationState.Recording).elapsedMs >= 900)
        assertEquals(RecordingStatus.RECORDING, history.rows.value["id1"]!!.status)

        c.stopAndTranscribe()
        advance(200)

        val done = c.state.value as DictationState.Done
        assertEquals("hello world", done.text)
        val row = history.rows.value["id1"]!!
        assertEquals(RecordingStatus.DONE, row.status)
        assertEquals("hello world", row.transcript)
        assertEquals(false, row.inserted) // keyboard rows start as "not inserted" until the IME commits
        assertNotNull(row.audioPath) // keepAudio default
        assertTrue(audioFile("id1").exists())
        assertEquals("field-1", results.single().session)
        assertEquals("auto", transcriber.calls.single().first.language)
        assertTrue(transcriber.calls.single().second.cloudConsentGranted)
        assertEquals(1, focus.abandoned)
    }

    @Test fun cleanupRunsWhenEnabled() = runTest {
        settings.settings = settings.settings.copy(cleanupEnabled = true)
        transcriber.text = "  um hello  "
        val c = controller(TextTidy { it.replace("um ", "") })
        c.start(StartOptions(RecordingSource.APP))
        runCurrent(); advance(500)
        c.stopAndTranscribe(); advance(200)
        assertEquals("hello", (c.state.value as DictationState.Done).text)
    }

    @Test fun silentMicIsRejectedAfterThreeSecondsWithoutUpload() = runTest {
        recorder.amplitude = { 0 }
        val c = controller()
        c.start(StartOptions(RecordingSource.TILE))
        runCurrent()
        advance(2_500)
        assertTrue(c.state.value is DictationState.Recording)
        advance(1_000)
        assertEquals(DictationError.SILENT_MIC, (c.state.value as DictationState.Error).error)
        assertTrue(transcriber.calls.isEmpty())
        val row = history.rows.value["id1"]!!
        assertEquals(RecordingStatus.FAILED, row.status)
        assertNull(row.audioPath)
        assertFalse(audioFile("id1").exists())
    }

    @Test fun silentWholeClipStoppedEarlyIsRejected() = runTest {
        recorder.amplitude = { 0 }
        val c = controller()
        c.start(StartOptions(RecordingSource.APP))
        runCurrent(); advance(1_000)
        c.stopAndTranscribe(); advance(200)
        assertEquals(DictationError.SILENT_MIC, (c.state.value as DictationState.Error).error)
        assertTrue(transcriber.calls.isEmpty())
    }

    @Test fun missingConsentBlocksRecordingAndUpload() = runTest {
        settings.settings = settings.settings.copy(cloudConsentGranted = false)
        val c = controller()
        c.start(StartOptions(RecordingSource.APP))
        runCurrent()
        assertEquals(DictationError.CONSENT_MISSING, (c.state.value as DictationState.Error).error)
        assertEquals(0, recorder.started)
        assertTrue(transcriber.calls.isEmpty())
        assertTrue(history.rows.value.isEmpty())
    }

    @Test fun missingKeyAndMicAreReportedBeforeRecording() = runTest {
        settings.keys = emptyMap()
        val c = controller()
        c.start(StartOptions(RecordingSource.APP)); runCurrent()
        assertEquals(DictationError.NO_KEY, (c.state.value as DictationState.Error).error)

        settings.keys = mapOf(ProviderId.OPENAI to "sk")
        mic = false
        c.start(StartOptions(RecordingSource.APP)); runCurrent()
        assertEquals(DictationError.PERMISSION_MISSING, (c.state.value as DictationState.Error).error)
        assertEquals(0, recorder.started)
    }

    @Test fun providerFailureKeepsAudioForRetry() = runTest {
        transcriber.failure = IllegalStateException("HTTP 401: Incorrect API key")
        val c = controller()
        c.start(StartOptions(RecordingSource.APP))
        runCurrent(); advance(500)
        c.stopAndTranscribe(); advance(200)
        val err = c.state.value as DictationState.Error
        assertEquals(DictationError.PROVIDER, err.error)
        assertEquals("HTTP 401: Incorrect API key", err.detail)
        val row = history.rows.value["id1"]!!
        assertEquals(RecordingStatus.FAILED, row.status)
        assertNotNull(row.audioPath)

        // Retry succeeds from history.
        transcriber.failure = null
        c.retry("id1"); runCurrent()
        assertEquals(RecordingStatus.DONE, history.rows.value["id1"]!!.status)
        assertEquals("hello world", (c.state.value as DictationState.Done).text)
    }

    @Test fun failedRetryNeverDeletesTheOnlyClipEvenWithKeepAudioOff() = runTest {
        transcriber.failure = IllegalStateException("HTTP 500")
        val c = controller()
        c.start(StartOptions(RecordingSource.APP))
        runCurrent(); advance(500)
        c.stopAndTranscribe(); advance(200)
        assertTrue(audioFile("id1").exists())

        settings.settings = settings.settings.copy(keepAudio = false) // changed after the failure
        c.retry("id1"); runCurrent()
        assertTrue(c.state.value is DictationState.Error)
        assertTrue(audioFile("id1").exists())
        val row = history.rows.value["id1"]!!
        assertEquals(RecordingStatus.FAILED, row.status)
        assertNotNull(row.audioPath)
    }

    @Test fun categorySetDuringTranscriptionSurvivesTheResult() = runTest {
        transcriber.latencyMs = 1_000
        val c = controller()
        c.start(StartOptions(RecordingSource.APP))
        runCurrent(); advance(500)
        c.stopAndTranscribe(); advance(200)
        assertTrue(c.state.value is DictationState.Transcribing)
        history.setCategory("id1", "work")
        advance(1_500)
        val row = history.rows.value["id1"]!!
        assertEquals(RecordingStatus.DONE, row.status)
        assertEquals("hello world", row.transcript)
        assertEquals("work", row.category)
    }

    @Test fun cancelWhileRecordingDiscardsEverything() = runTest {
        val c = controller()
        c.start(StartOptions(RecordingSource.KEYBOARD))
        runCurrent(); advance(500)
        c.cancel(); runCurrent()
        assertEquals(DictationState.Idle, c.state.value)
        assertTrue(history.rows.value.isEmpty())
        assertFalse(audioFile("id1").exists())
        assertTrue(recorder.released >= 1)
        advance(5_000) // the loop must be dead
        assertEquals(DictationState.Idle, c.state.value)
    }

    @Test fun noHistoryModeWritesNothingAndDeletesAudio() = runTest {
        val c = controller()
        val results = mutableListOf<DictationResult>()
        backgroundScope.launch { c.results.collect { results += it } }
        runCurrent()
        c.start(StartOptions(RecordingSource.KEYBOARD, saveToHistory = false))
        runCurrent(); advance(500)
        c.stopAndTranscribe(); advance(200)
        assertTrue(c.state.value is DictationState.Done)
        assertTrue(history.rows.value.isEmpty())
        assertFalse(audioFile("id1").exists())
        assertNull(results.single().recordingId)
    }

    @Test fun keepAudioOffDeletesClipAfterSuccess() = runTest {
        settings.settings = settings.settings.copy(keepAudio = false)
        val c = controller()
        c.start(StartOptions(RecordingSource.APP))
        runCurrent(); advance(500)
        c.stopAndTranscribe(); advance(200)
        assertNull(history.rows.value["id1"]!!.audioPath)
        assertFalse(audioFile("id1").exists())
    }

    @Test fun autoStopAfterSilenceFollowingSpeech() = runTest {
        settings.settings = settings.settings.copy(autoStopSeconds = 2)
        val start = testScheduler.currentTime
        recorder.amplitude = { if (testScheduler.currentTime - start < 1_000) 8000 else 1 } // near-silent, but signal present
        val c = controller()
        c.start(StartOptions(RecordingSource.APP))
        runCurrent()
        advance(2_500)
        assertTrue(c.state.value is DictationState.Recording)
        advance(1_000)
        assertTrue(c.state.value is DictationState.Done)
    }

    @Test fun sixtyMinuteCapWarnsAtFiftyFiveThenStops() = runTest {
        val c = controller()
        c.start(StartOptions(RecordingSource.APP))
        runCurrent()
        advance(55 * 60_000L + 1_000)
        assertTrue((c.state.value as DictationState.Recording).nearLimit)
        advance(5 * 60_000L)
        assertTrue(c.state.value is DictationState.Done)
    }

    @Test fun audioFocusLossStopsAndTranscribes() = runTest {
        val c = controller()
        c.start(StartOptions(RecordingSource.APP))
        runCurrent(); advance(500)
        focus.onLost!!.invoke()
        advance(300)
        assertTrue(c.state.value is DictationState.Done)
    }

    @Test fun recorderStartFailureSurfacesAsError() = runTest {
        recorder.failOnStart = true
        val c = controller()
        c.start(StartOptions(RecordingSource.APP)); runCurrent()
        assertEquals(DictationError.RECORDER_FAILED, (c.state.value as DictationState.Error).error)
        assertTrue(history.rows.value.isEmpty())
    }

    @Test fun processDeathSweepTurnsInFlightRowsIntoRetryableFailures() = runTest {
        fun row(id: String, st: RecordingStatus) = Recording(
            id, 1L, 0, st, "openai", "whisper-1", "auto", audioPath = "/x/$id.m4a", source = RecordingSource.APP,
        )
        history.upsert(row("a", RecordingStatus.RECORDING))
        history.upsert(row("b", RecordingStatus.TRANSCRIBING))
        history.upsert(row("c", RecordingStatus.DONE).copy(transcript = "ok"))

        assertEquals(2, history.sweepInterrupted())

        assertEquals(RecordingStatus.FAILED, history.rows.value["a"]!!.status)
        assertEquals("Interrupted", history.rows.value["a"]!!.error)
        assertEquals("/x/a.m4a", history.rows.value["a"]!!.audioPath) // kept: retryable
        assertEquals(RecordingStatus.FAILED, history.rows.value["b"]!!.status)
        assertEquals(RecordingStatus.DONE, history.rows.value["c"]!!.status)
    }

    @Test fun rotationDoesNotRestartAnUpload() = runTest {
        // State lives in the controller, not the Activity: a second observer sees the same in-flight state and
        // starting again while transcribing is ignored.
        transcriber.latencyMs = 1_000
        val c = controller()
        c.start(StartOptions(RecordingSource.TILE))
        runCurrent(); advance(500)
        c.stopAndTranscribe(); advance(60)
        c.start(StartOptions(RecordingSource.TILE)); runCurrent()
        advance(2_000)
        assertTrue(c.state.value is DictationState.Done)
        assertEquals(1, transcriber.calls.size)
        assertEquals(1, recorder.started)
    }

    @Test fun abortAllDuringTranscribingWritesNothingAfterwards() = runTest {
        transcriber.latencyMs = 10_000
        val c = controller()
        c.start(StartOptions(RecordingSource.APP))
        runCurrent(); advance(500)
        c.stopAndTranscribe(); advance(200)
        assertTrue(c.state.value is DictationState.Transcribing)
        assertTrue(audioFile("id1").exists())

        c.abortAll()
        history.clear()
        assertEquals(DictationState.Idle, c.state.value)
        assertFalse(audioFile("id1").exists())
        advance(20_000) // the upload would have finished by now
        assertTrue(history.rows.value.isEmpty())
        assertEquals(DictationState.Idle, c.state.value)
    }

    @Test fun orphanAudioFromProcessDeathIsSweptButLiveFileIsKept() = runTest {
        val dir = File(tmp.root, "recordings").also { it.mkdirs() }
        val h = FakeHistory(dir)
        val orphan = File(dir, "orphan.m4a").also { it.writeBytes(byteArrayOf(1)) }
        val referenced = File(dir, "kept.m4a").also { it.writeBytes(byteArrayOf(1)) }
        val live = File(dir, "live.m4a").also { it.writeBytes(byteArrayOf(1)) }
        h.upsert(Recording(id = "kept", createdAt = 1, durationMs = 1, status = RecordingStatus.FAILED,
            provider = "openai", model = "m", language = "en", audioPath = referenced.path, source = RecordingSource.APP))
        assertEquals(1, h.sweepOrphanAudio(live))
        assertFalse(orphan.exists())
        assertTrue(referenced.exists())
        assertTrue(live.exists())
    }

    @Test fun failureWithKeepAudioOffDeletesFile() = runTest {
        settings.settings = settings.settings.copy(keepAudio = false)
        transcriber.failure = IllegalStateException("boom")
        val c = controller()
        c.start(StartOptions(RecordingSource.APP))
        runCurrent(); advance(500)
        c.stopAndTranscribe(); advance(200)
        assertTrue(c.state.value is DictationState.Error)
        assertFalse(audioFile("id1").exists())
        assertNull(history.rows.value["id1"]!!.audioPath)
    }

    @Test fun maintenanceSweepSkipsTheLiveRecordingRow() = runTest {
        val c = controller()
        c.start(StartOptions(RecordingSource.KEYBOARD))
        runCurrent(); advance(500)
        assertEquals("id1", c.activeId())
        assertEquals(0, history.sweepInterrupted(c.activeId()))
        assertEquals(RecordingStatus.RECORDING, history.rows.value["id1"]!!.status)
        c.stopAndTranscribe(); advance(200)
        assertEquals(RecordingStatus.DONE, history.rows.value["id1"]!!.status)
        assertNull(c.activeId().takeIf { c.state.value is DictationState.Idle })
    }
}
