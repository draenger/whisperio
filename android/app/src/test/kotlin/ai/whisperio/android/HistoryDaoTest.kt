package ai.whisperio.android

import ai.whisperio.android.history.AppDatabase
import ai.whisperio.android.history.HistoryStore
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.history.RoomHistoryStore
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class HistoryDaoTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var db: AppDatabase
    private lateinit var store: RoomHistoryStore

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        store = RoomHistoryStore(db.recordings(), File(tmp.root, "recordings").also { it.mkdirs() })
    }

    @After fun tearDown() = db.close()

    private fun row(id: String, at: Long, st: RecordingStatus = RecordingStatus.DONE, audio: File? = null) = Recording(
        id = id, createdAt = at, durationMs = 1000, status = st, provider = "openai", model = "whisper-1",
        language = "auto", transcript = if (st == RecordingStatus.DONE) "text $id" else null,
        audioPath = audio?.path, source = RecordingSource.APP,
    )

    private fun audio(name: String) = File(tmp.root, "recordings/$name.m4a").also { it.writeBytes(byteArrayOf(1, 2, 3)) }

    @Test fun roundTripAndNewestFirstOrdering() = runBlocking {
        store.upsert(row("old", 100)); store.upsert(row("new", 300)); store.upsert(row("mid", 200))
        assertEquals(listOf("new", "mid", "old"), store.observeAll().first().map { it.id })
        assertEquals(listOf("new", "mid"), store.observeRecent(2).first().map { it.id })
        assertEquals("text mid", store.get("mid")!!.transcript)
        assertEquals("new", store.observe("new").first()!!.id)
    }

    @Test fun upsertUpdatesInPlace() = runBlocking {
        store.upsert(row("a", 1, RecordingStatus.RECORDING))
        store.upsert(row("a", 1, RecordingStatus.DONE))
        assertEquals(1, store.observeAll().first().size)
        assertEquals(RecordingStatus.DONE, store.get("a")!!.status)
    }

    @Test fun startupSweepTurnsInFlightRowsIntoInterruptedFailures() = runBlocking {
        val f = audio("a")
        store.upsert(row("a", 1, RecordingStatus.RECORDING, f))
        store.upsert(row("b", 2, RecordingStatus.TRANSCRIBING))
        store.upsert(row("c", 3, RecordingStatus.DONE))
        store.upsert(row("d", 4, RecordingStatus.FAILED).copy(error = "boom"))

        assertEquals(2, store.sweepInterrupted())

        val a = store.get("a")!!
        assertEquals(RecordingStatus.FAILED, a.status)
        assertEquals("Interrupted", a.error)
        assertNotNull(a.audioPath) // audio kept so the clip is retryable
        assertEquals(RecordingStatus.FAILED, store.get("b")!!.status)
        assertEquals(RecordingStatus.DONE, store.get("c")!!.status)
        assertEquals("boom", store.get("d")!!.error)
        assertEquals(0, store.sweepInterrupted()) // idempotent
    }

    @Test fun autoDeleteRemovesOldRowsAndTheirAudio() = runBlocking {
        val oldAudio = audio("old"); val newAudio = audio("new")
        store.upsert(row("old", 1_000, audio = oldAudio))
        store.upsert(row("new", 9_000, audio = newAudio))
        assertEquals(1, store.deleteOlderThan(5_000))
        assertNull(store.get("old"))
        assertFalse(oldAudio.exists())
        assertNotNull(store.get("new"))
        assertTrue(newAudio.exists())
    }

    @Test fun deleteRemovesRowAndAudio() = runBlocking {
        val f = audio("x")
        store.upsert(row("x", 1, audio = f))
        store.delete("x")
        assertNull(store.get("x"))
        assertFalse(f.exists())
    }

    @Test fun deleteAllAudioKeepsTranscripts() = runBlocking {
        val f = audio("x")
        store.upsert(row("x", 1, audio = f))
        store.deleteAllAudio()
        assertFalse(f.exists())
        val r = store.get("x")!!
        assertNull(r.audioPath)
        assertEquals("text x", r.transcript)
    }

    @Test fun deleteAllAudioSkipsTheActiveRecording() = runBlocking {
        val old = audio("old")
        val live = audio("live")
        store.upsert(row("old", 1, audio = old))
        store.upsert(row("live", 2, RecordingStatus.RECORDING, audio = live))
        store.deleteAllAudio(keepId = "live", keepFile = live)
        assertFalse(old.exists())
        assertTrue(live.exists())
        assertNull(store.get("old")!!.audioPath)
        assertEquals(live.path, store.get("live")!!.audioPath)
    }

    @Test fun setInsertedTracksKeyboardCommits() = runBlocking {
        store.upsert(row("k", 1).copy(source = RecordingSource.KEYBOARD, inserted = false))
        store.setInserted("k", true)
        assertEquals(true, store.get("k")!!.inserted)
    }

    @Test fun clearWipesRowsAndAudio() = runBlocking {
        val f = audio("x")
        store.upsert(row("x", 1, audio = f)); store.upsert(row("y", 2))
        store.clear()
        assertTrue(store.observeAll().first().isEmpty())
        assertFalse(f.exists())
    }

    @Test fun interruptedConstantMatchesContract() {
        assertEquals("Interrupted", HistoryStore.INTERRUPTED)
    }
}
