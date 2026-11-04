package ai.whisperio.android

import ai.whisperio.android.di.Transcriber
import ai.whisperio.android.dictation.DictationController
import ai.whisperio.android.dictation.DictationError
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.dictation.RetryOutcome
import ai.whisperio.android.dictation.StartOptions
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.security.AudioCipher
import ai.whisperio.android.security.DataCipher
import ai.whisperio.core.ChainSettings
import ai.whisperio.core.TranscriptionRequest
import ai.whisperio.core.TranscriptionResult
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** A3: DictationController keeps clips encrypted (`.wea`) when the setting is ON and retries them via a temp plaintext copy. */
@OptIn(ExperimentalCoroutinesApi::class)
class AudioEncryptionFlowTest {
    @get:Rule val tmp = TemporaryFolder()

    private class Upload(val name: String, val bytes: ByteArray)

    private val uploads = mutableListOf<Upload>()
    private val transcriber = object : Transcriber {
        override suspend fun transcribe(req: TranscriptionRequest, settings: ChainSettings): TranscriptionResult {
            // What the provider would receive: the file exactly as it is at upload time.
            uploads += Upload(req.audio.name, req.audio.readBytes())
            return TranscriptionResult("hello world", settings.order.first().id, settings.order.first().model)
        }
    }
    private val recorder = FakeRecorder()
    private val settings = FakeSettings()
    private val history = FakeHistory()
    private val keys = AudioMemKeys()
    private val data = DataCipher(TestCipher(), keys)
    private val audio = AudioCipher(data)
    private var encryptOn = true
    private val dir get() = File(tmp.root, "recordings")

    private fun TestScope.controller(cipher: AudioCipher? = audio) = DictationController(
        scope = CoroutineScope(StandardTestDispatcher(testScheduler)),
        recorder = recorder,
        focus = FakeFocus(),
        transcriber = transcriber,
        settings = settings,
        history = history,
        tidy = { it },
        recordingsDir = dir,
        micGranted = { true },
        nowMs = { testScheduler.currentTime },
        wallClockMs = { 1_000_000L },
        newId = { "id1" },
        audioCipher = cipher,
        encryptAudio = { encryptOn },
    )

    /** Encryption runs on Dispatchers.IO, so wait for real time while pumping the test scheduler. */
    private fun TestScope.settle(done: () -> Boolean) {
        repeat(500) {
            runCurrent()
            if (done()) return
            Thread.sleep(10)
        }
        runCurrent()
        assertTrue("condition not reached", done())
    }

    private fun TestScope.record(c: DictationController) {
        c.start(StartOptions(RecordingSource.APP))
        runCurrent()
        advanceTimeBy(500); runCurrent()
        c.stopAndTranscribe()
        advanceTimeBy(200); runCurrent()
    }

    private fun finished(id: String) = history.rows.value[id]?.status.let { it == RecordingStatus.DONE || it == RecordingStatus.FAILED }

    @Test fun keepWithEncryptionOnStoresAWeaAndLeavesNoPlaintext() = runTest {
        val c = controller()
        record(c)
        settle { finished("id1") }

        val plain = File(dir, "id1.m4a")
        val enc = File(dir, "id1.m4a.wea")
        val row = history.rows.value["id1"]!!
        assertEquals(RecordingStatus.DONE, row.status)
        assertEquals(enc.path, row.audioPath)
        assertTrue(enc.exists())
        assertFalse("no plaintext clip may remain", plain.exists())
        assertTrue(dir.listFiles()!!.none { it.name.endsWith(".tmp") })
        // The upload itself was made from the plaintext recording.
        assertEquals("id1.m4a", uploads.single().name)
        assertTrue(uploads.single().bytes.all { it == 1.toByte() })
        // And the stored clip decrypts to what was recorded.
        val back = File(tmp.root, "back.m4a")
        kotlinx.coroutines.runBlocking { audio.decryptToFile(enc, back, "id1") }
        assertArrayEquals(ByteArray(2048) { 1 }, back.readBytes())
    }

    @Test fun keepWithEncryptionOffLeavesThePlainClip() = runTest {
        encryptOn = false
        val c = controller()
        record(c)
        settle { finished("id1") }

        assertEquals(File(dir, "id1.m4a").path, history.rows.value["id1"]!!.audioPath)
        assertTrue(File(dir, "id1.m4a").exists())
        assertFalse(File(dir, "id1.m4a.wea").exists())
    }

    @Test fun aFailingCipherKeepsThePlaintextClip() = runTest {
        val broken = AudioCipher(DataCipher(AudioBrokenWrapper(), AudioMemKeys()))
        val c = controller(broken)
        record(c)
        settle { finished("id1") }

        val row = history.rows.value["id1"]!!
        assertEquals(RecordingStatus.DONE, row.status)
        assertEquals("the transcript is not lost either", "hello world", row.transcript)
        assertEquals(File(dir, "id1.m4a").path, row.audioPath)
        assertTrue("audio is never lost", File(dir, "id1.m4a").exists())
        assertFalse(File(dir, "id1.m4a.wea").exists())
        assertFalse(File(dir, "id1.m4a.wea.tmp").exists())
    }

    @Test fun aKeptClipOfAFailedTranscriptionIsEncryptedToo() = runTest {
        val failing = object : Transcriber {
            override suspend fun transcribe(req: TranscriptionRequest, settings: ChainSettings): TranscriptionResult =
                throw IllegalStateException("HTTP 500")
        }
        val c = DictationController(
            scope = CoroutineScope(StandardTestDispatcher(testScheduler)), recorder = recorder, focus = FakeFocus(),
            transcriber = failing, settings = settings, history = history, tidy = { it }, recordingsDir = dir,
            micGranted = { true }, nowMs = { testScheduler.currentTime }, wallClockMs = { 1_000_000L }, newId = { "id1" },
            audioCipher = audio, encryptAudio = { true },
        )
        record(c)
        settle { finished("id1") }

        val row = history.rows.value["id1"]!!
        assertEquals(RecordingStatus.FAILED, row.status)
        assertEquals(File(dir, "id1.m4a.wea").path, row.audioPath)
        assertFalse(File(dir, "id1.m4a").exists())
    }

    private suspend fun seedEncryptedRow(): File {
        dir.mkdirs()
        val plain = File(dir, "r1.m4a").also { it.writeBytes(ByteArray(100_000) { i -> (i % 251).toByte() }) }
        val enc = File(dir, "r1.m4a.wea")
        audio.encryptFile(plain, enc, "r1")
        plain.delete()
        history.upsert(
            Recording(
                id = "r1", createdAt = 1L, durationMs = 5_000, status = RecordingStatus.FAILED, provider = "openai",
                model = "whisper-1", language = "pl", transcript = null, error = "PROVIDER", audioPath = enc.path,
                source = RecordingSource.APP,
            ),
        )
        return enc
    }

    @Test fun retryOfAWeaRowUploadsATempPlaintextAndRemovesIt() = runTest {
        val enc = seedEncryptedRow()
        val c = controller()

        c.retry("r1")
        settle { c.state.value is DictationState.Done }

        val up = uploads.single()
        assertEquals("r1.retry.m4a", up.name)
        assertArrayEquals(ByteArray(100_000) { i -> (i % 251).toByte() }, up.bytes)
        assertFalse("the temp plaintext is always removed", File(dir, "r1.retry.m4a").exists())
        val row = history.rows.value["r1"]!!
        assertEquals(RecordingStatus.DONE, row.status)
        assertEquals("hello world", row.transcript)
        assertEquals("the stored path stays as it is", enc.path, row.audioPath)
        assertTrue(enc.exists())
        assertEquals(listOf("r1.m4a.wea"), dir.listFiles()!!.map { it.name })
    }

    @Test fun retryWithOfAWeaRowAlsoRemovesTheTemp() = runTest {
        val enc = seedEncryptedRow()
        val c = controller()
        val outcomes = mutableListOf<RetryOutcome>()
        backgroundScope.launch { c.retryOutcomes.collect { outcomes += it } }
        runCurrent()

        c.retryWith("r1", ai.whisperio.core.ProviderId.OPENAI)
        settle { outcomes.isNotEmpty() }

        assertEquals(listOf<RetryOutcome>(RetryOutcome.Success("r1")), outcomes)
        assertEquals("r1.retry.m4a", uploads.single().name)
        assertFalse(File(dir, "r1.retry.m4a").exists())
        assertEquals(enc.path, history.rows.value["r1"]!!.audioPath)
    }

    @Test fun retryWithoutTheKeyReportsNoAudioAndUploadsNothing() = runTest {
        val enc = seedEncryptedRow()
        data.shred()
        val c = controller()

        c.retry("r1")
        settle { c.state.value is DictationState.Error }

        assertEquals(DictationError.NO_AUDIO, (c.state.value as DictationState.Error).error)
        assertTrue(uploads.isEmpty())
        assertFalse(File(dir, "r1.retry.m4a").exists())
        assertFalse(File(dir, "r1.retry.m4a.tmp").exists())
        assertEquals(enc.path, history.rows.value["r1"]!!.audioPath)
    }

    @Test fun retryWithoutAnyCipherInjectedReportsNoAudioForAWeaRow() = runTest {
        seedEncryptedRow()
        val c = controller(cipher = null)

        c.retry("r1")
        settle { c.state.value is DictationState.Error }

        assertEquals(DictationError.NO_AUDIO, (c.state.value as DictationState.Error).error)
        assertTrue(uploads.isEmpty())
    }
}
