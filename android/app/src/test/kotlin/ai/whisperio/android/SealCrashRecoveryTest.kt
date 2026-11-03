package ai.whisperio.android

import ai.whisperio.android.history.AppDatabase
import ai.whisperio.android.history.AudioMigration
import ai.whisperio.android.history.Recording
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Process death between sealing a finished clip (`<id>.m4a` -> `<id>.m4a.wea`, plaintext deleted) and the row update:
 * the row still names the missing `.m4a`. The `.wea` is the only copy, so the orphan sweep must keep it and the audio
 * migration must re-point the row to it (second-opinion review, finding 2).
 */
@RunWith(RobolectricTestRunner::class)
class SealCrashRecoveryTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var db: AppDatabase
    private lateinit var dir: File
    private lateinit var store: RoomHistoryStore

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        dir = File(tmp.root, "r").also { it.mkdirs() }
        store = RoomHistoryStore(db.recordings(), dir)
    }

    @After fun tearDown() = db.close()

    private fun row(id: String, audio: File) = Recording(
        id = id, createdAt = 1, durationMs = 1, status = RecordingStatus.DONE, provider = "openai", model = "m",
        language = "pl", transcript = "t", source = RecordingSource.APP, audioPath = audio.path,
    )

    @Test fun sealedOnlyCopySurvivesTheSweepAndTheRowIsRepointed() = runBlocking {
        val plain = File(dir, "a.m4a")
        val sealed = File(dir, "a.m4a.wea").apply { writeBytes(byteArrayOf(1, 2, 3)) }
        store.upsert(row("a", plain)) // the row was never updated: it still names the deleted .m4a
        val orphan = File(dir, "b.m4a.wea").apply { writeBytes(byteArrayOf(9)) } // a real orphan still goes

        store.sweepOrphanAudio(null)
        assertTrue(sealed.exists())
        assertFalse(orphan.exists())

        val report = AudioMigration(db.recordings(), AudioCipher(DataCipher(TestCipher(), AudioMemKeys())))
            .migrate(encrypt = true, skipId = null)
        assertEquals(1, report.converted)
        assertEquals(sealed.path, store.get("a")!!.audioPath)
        assertTrue(sealed.exists())
    }

    @Test fun aLeftoverWeaNextToAnExistingPlainClipIsStillSwept() = runBlocking {
        val plain = File(dir, "c.m4a").apply { writeBytes(byteArrayOf(4)) }
        val half = File(dir, "c.m4a.wea").apply { writeBytes(byteArrayOf(5)) } // interrupted encrypt, plain intact
        store.upsert(row("c", plain))
        store.sweepOrphanAudio(null)
        assertTrue(plain.exists())
        assertFalse(half.exists())
    }
}
