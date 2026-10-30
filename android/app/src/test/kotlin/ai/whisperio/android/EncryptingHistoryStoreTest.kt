package ai.whisperio.android

import ai.whisperio.android.history.AppDatabase
import ai.whisperio.android.history.EncryptingHistoryStore
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.history.RoomHistoryStore
import ai.whisperio.android.security.DataCipher
import ai.whisperio.android.security.SecretCipher
import ai.whisperio.android.security.WrappedKeyStore
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import java.io.File
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

private class TestWrapper : SecretCipher {
    private val key = SecretKeySpec(ByteArray(32) { 7 }, "AES")
    override fun encrypt(plain: ByteArray): ByteArray {
        val iv = ByteArray(12) { it.toByte() }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        return iv + c.doFinal(plain)
    }

    override fun decrypt(blob: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, blob, 0, 12))
        return c.doFinal(blob, 12, blob.size - 12)
    }
}

private class TestKeys : WrappedKeyStore {
    var blob: ByteArray? = null
    override suspend fun read() = blob
    override suspend fun write(wrapped: ByteArray) { blob = wrapped }
    override suspend fun delete() { blob = null }
}

@RunWith(RobolectricTestRunner::class)
class EncryptingHistoryStoreTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var db: AppDatabase
    private lateinit var keys: TestKeys
    private lateinit var cipher: DataCipher
    private var on = false
    private lateinit var store: EncryptingHistoryStore

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        keys = TestKeys()
        cipher = DataCipher(TestWrapper(), keys)
        store = EncryptingHistoryStore(
            RoomHistoryStore(db.recordings(), File(tmp.root, "r").also { it.mkdirs() }),
            db.recordings(), cipher, { on },
        )
    }

    @After fun tearDown() = db.close()

    private fun row(id: String, text: String?, err: String? = null) = Recording(
        id = id, createdAt = 1, durationMs = 1, status = RecordingStatus.DONE, provider = "openai", model = "m",
        language = "pl", transcript = text, error = err, source = RecordingSource.APP, category = "work",
    )

    private suspend fun raw(id: String) = db.recordings().get(id)!!

    @Test fun offStoresPlaintext() = runBlocking {
        store.upsert(row("a", "zażółć"))
        assertEquals("zażółć", raw("a").transcript)
        assertEquals("zażółć", store.get("a")!!.transcript)
    }

    @Test fun onStoresSealedAndReadsPlain() = runBlocking {
        on = true
        store.upsert(row("a", "tajne", "boom"))
        val r = raw("a")
        assertTrue(r.transcript!!.startsWith("WE1:") && !r.transcript!!.contains("tajne"))
        assertTrue(r.error!!.startsWith("WE1:"))
        assertEquals("tajne", store.get("a")!!.transcript)
        assertEquals("tajne", store.observeAll().first().single().transcript)
        assertEquals("work", r.category)
    }

    @Test fun migrateBothWaysKeepsMetadata() = runBlocking {
        store.upsert(row("a", "one"))
        store.upsert(row("b", null))
        assertEquals(1, store.migrate(true).converted)
        assertTrue(raw("a").transcript!!.startsWith("WE1:"))
        assertEquals("one", store.get("a")!!.transcript)
        assertEquals(0, store.migrate(true).converted) // idempotent
        assertEquals(1, store.migrate(false).converted)
        assertEquals("one", raw("a").transcript)
        assertEquals("work", raw("a").category)
    }

    @Test fun interruptedMigrationLeavesReadableMixAndResumes() = runBlocking {
        for (i in 1..4) store.upsert(row("r$i", "text $i"))
        // Process killed after two rows: those two are sealed, the other two are still plain.
        on = true
        store.upsert(row("r1", "text 1"))
        store.upsert(row("r2", "text 2"))
        on = false
        assertEquals((1..4).map { "text $it" }, (1..4).map { store.get("r$it")!!.transcript })
        assertEquals(2, store.migrate(true).converted) // resumes: only the two plain rows
        assertTrue((1..4).all { raw("r$it").transcript!!.startsWith("WE1:") })
        assertEquals((1..4).map { "text $it" }, (1..4).map { store.get("r$it")!!.transcript })
    }

    @Test fun lostKeyShowsUnreadableAndDoesNotCrashOrOverwrite() = runBlocking {
        on = true
        store.upsert(row("a", "tajne"))
        val sealed = raw("a").transcript
        cipher.shred() // crypto-shred: wrapped key destroyed
        val shown = store.get("a")!!
        assertNull(shown.transcript)
        assertEquals(EncryptingHistoryStore.UNREADABLE, shown.error)
        val rep = store.migrate(false)
        assertEquals(1, rep.unreadable)
        assertEquals(0, rep.converted)
        assertEquals(sealed, raw("a").transcript)
    }
}
