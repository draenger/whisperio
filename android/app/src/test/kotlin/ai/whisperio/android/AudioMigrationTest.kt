package ai.whisperio.android

import ai.whisperio.android.history.AppDatabase
import ai.whisperio.android.history.AudioMigration
import ai.whisperio.android.history.AudioMigrationReport
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingDao
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.history.RoomHistoryStore
import ai.whisperio.android.security.AudioCipher
import ai.whisperio.android.security.DataCipher
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** A3: converting kept clips when the switch changes, the audio_path compare-and-swap, and the orphan sweep. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AudioMigrationTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var db: AppDatabase
    private lateinit var dir: File
    private val keys = AudioMemKeys()
    private val data = DataCipher(TestCipher(), keys)
    private val audio = AudioCipher(data)

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        dir = File(tmp.root, "recordings").also { it.mkdirs() }
    }

    @After fun tearDown() = db.close()

    private fun clip(id: String, size: Int = 150_000) =
        File(dir, "$id.m4a").also { f -> f.writeBytes(ByteArray(size) { i -> (i * 7 + id.hashCode()).toByte() }) }

    private suspend fun seed(id: String, audioPath: String?) = db.recordings().upsert(
        Recording(
            id = id, createdAt = 1000L + id.hashCode(), durationMs = 1000, status = RecordingStatus.DONE, provider = "openai",
            model = "whisper-1", language = "pl", transcript = "t", audioPath = audioPath, source = RecordingSource.APP,
        ),
    )

    private suspend fun path(id: String) = db.recordings().get(id)!!.audioPath

    @Test fun turningOnConvertsKeptClipsAndDeletesThePlaintext() = runBlocking {
        val a = clip("a"); val b = clip("b")
        val original = a.readBytes()
        seed("a", a.path); seed("b", b.path); seed("c", null)

        val report = AudioMigration(db.recordings(), audio).migrate(encrypt = true, skipId = null)

        assertEquals(AudioMigrationReport(converted = 2, unreadable = 0), report)
        assertEquals(a.path + ".wea", path("a"))
        assertEquals(b.path + ".wea", path("b"))
        assertNull(path("c"))
        assertFalse(a.exists()); assertFalse(b.exists())
        assertTrue(File(a.path + ".wea").exists())
        assertTrue(dir.listFiles()!!.none { it.name.endsWith(".tmp") })
        val back = File(tmp.root, "back.m4a")
        audio.decryptToFile(File(a.path + ".wea"), back, "a")
        assertArrayEquals(original, back.readBytes())

        // Running it again changes nothing.
        assertEquals(AudioMigrationReport(0, 0), AudioMigration(db.recordings(), audio).migrate(true, null))
    }

    @Test fun turningOffConvertsBackAndDeletesTheEncryptedFile() = runBlocking {
        val a = clip("a")
        val original = a.readBytes()
        seed("a", a.path)
        val m = AudioMigration(db.recordings(), audio)
        m.migrate(true, null)

        val report = m.migrate(encrypt = false, skipId = null)

        assertEquals(AudioMigrationReport(1, 0), report)
        assertEquals(a.path, path("a"))
        assertArrayEquals(original, a.readBytes())
        assertFalse(File(a.path + ".wea").exists())
    }

    @Test fun anInterruptedConversionLeavesTheRowPointingAtAReadableClip() = runBlocking {
        // Killed after the .wea was written but before the row was re-pointed: plaintext + orphan .wea exist.
        val a = clip("a")
        seed("a", a.path)
        audio.encryptFile(a, AudioCipher.encryptedFor(a), "a")
        assertEquals(a.path, path("a"))
        assertTrue(a.exists())

        // The next run converts (replacing the orphan) and finishes the job.
        assertEquals(1, AudioMigration(db.recordings(), audio).migrate(true, null).converted)
        assertEquals(a.path + ".wea", path("a"))
        assertFalse(a.exists())
    }

    @Test fun aRowThatChangedMeanwhileIsNotOverwrittenAndTheOrphanOutputIsRemoved() = runBlocking {
        val real = db.recordings()
        val a = clip("a")
        seed("a", a.path)
        // Between the migration read and its swap the pipeline re-points the row (here: to some other clip).
        val racing = object : RecordingDao by real {
            override suspend fun swapAudioPath(id: String, old: String?, new: String?): Int {
                real.upsert(real.get(id)!!.copy(audioPath = "/elsewhere/a.m4a"))
                return real.swapAudioPath(id, old, new)
            }
        }

        val report = AudioMigration(racing, audio).migrate(true, null)

        assertEquals(AudioMigrationReport(0, 0), report)
        assertEquals("/elsewhere/a.m4a", path("a"))
        assertFalse("the orphan output is removed", File(a.path + ".wea").exists())
        assertTrue("the old file is not ours to delete", a.exists())
    }

    @Test fun swapAudioPathIsACompareAndSwap() = runBlocking {
        seed("a", "/x/a.m4a")
        val dao = db.recordings()
        assertEquals(0, dao.swapAudioPath("a", "/stale.m4a", "/y/a.m4a.wea"))
        assertEquals("/x/a.m4a", path("a"))
        assertEquals(1, dao.swapAudioPath("a", "/x/a.m4a", "/y/a.m4a.wea"))
        assertEquals("/y/a.m4a.wea", path("a"))
        assertEquals("only audio_path changes", "t", dao.get("a")!!.transcript)
    }

    @Test fun theActiveRecordingIsSkipped() = runBlocking {
        val a = clip("a"); val b = clip("b")
        seed("a", a.path); seed("b", b.path)

        val report = AudioMigration(db.recordings(), audio).migrate(true, skipId = "a")

        assertEquals(1, report.converted)
        assertEquals(a.path, path("a"))
        assertTrue(a.exists())
        assertEquals(b.path + ".wea", path("b"))
    }

    @Test fun aBrokenKeystoreKeepsEveryClipAsItWasAndCountsThem() = runBlocking {
        val a = clip("a")
        seed("a", a.path)
        val broken = AudioCipher(DataCipher(AudioBrokenWrapper(), AudioMemKeys()))

        val report = AudioMigration(db.recordings(), broken).migrate(true, null)

        assertEquals(AudioMigrationReport(converted = 0, unreadable = 1), report)
        assertEquals(a.path, path("a"))
        assertTrue(a.exists())
        assertFalse(File(a.path + ".wea").exists())
    }

    @Test fun turningOffWithTheKeyGoneLeavesEncryptedClipsAlone() = runBlocking {
        val a = clip("a")
        seed("a", a.path)
        val m = AudioMigration(db.recordings(), audio)
        m.migrate(true, null)
        data.shred()

        val report = m.migrate(encrypt = false, skipId = null)

        assertEquals(AudioMigrationReport(0, 1), report)
        assertEquals(a.path + ".wea", path("a"))
        assertTrue(File(a.path + ".wea").exists())
        assertFalse(a.exists())
    }

    @Test fun orphanSweepAlsoRemovesTmpAndRetryLeftoversButSparesTheActiveClip() = runBlocking {
        val store = RoomHistoryStore(db.recordings(), dir)
        val kept = File(dir, "k.m4a.wea").also { it.writeBytes(byteArrayOf(1)) }
        seed("k", kept.path)
        val stale = listOf("x.m4a", "x.m4a.wea.tmp", "x.m4a.tmp", "x.retry.m4a", "y.m4a.wea")
            .map { n -> File(dir, n).also { it.writeBytes(byteArrayOf(1)) } }
        val active = File(dir, "live.m4a").also { it.writeBytes(byteArrayOf(1)) }
        val activeTmp = File(dir, "live.m4a.wea.tmp").also { it.writeBytes(byteArrayOf(1)) }
        val activeWea = File(dir, "live.m4a.wea").also { it.writeBytes(byteArrayOf(1)) }

        assertEquals(stale.size, store.sweepOrphanAudio(active))

        assertTrue(stale.none { it.exists() })
        assertTrue(kept.exists() && active.exists() && activeTmp.exists() && activeWea.exists())
        // A retry in progress passes its temp as the active file.
        val retryTemp = File(dir, "k.retry.m4a").also { it.writeBytes(byteArrayOf(1)) }
        // (live.m4a, live.m4a.wea.tmp and live.m4a.wea are no longer active, so they go; the retry temp stays.)
        assertEquals(3, store.sweepOrphanAudio(retryTemp))
        assertTrue(retryTemp.exists() && kept.exists())
    }
}
