package ai.whisperio.android

import ai.whisperio.android.di.AppGraph
import ai.whisperio.android.di.EncryptHistoryResult
import ai.whisperio.android.di.TextTidy
import ai.whisperio.android.dictation.DictationController
import ai.whisperio.android.history.AppDatabase
import ai.whisperio.android.history.MigrationReport
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.security.DataCipher
import ai.whisperio.android.security.DataStoreWrappedKeyStore
import ai.whisperio.android.security.InMemorySecretStore
import ai.whisperio.android.security.SecretCipher
import ai.whisperio.android.security.WrappedKeyStore
import ai.whisperio.android.ui.settings.EncryptNotice
import ai.whisperio.android.ui.settings.encryptNoticeFor
import ai.whisperio.android.settings.AppLanguageStore
import ai.whisperio.android.settings.SettingsRepository
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.security.KeyStoreException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Keystore that cannot create or use keys (e.g. OEM Keystore broken): turning encryption ON must fail closed. */
private class BrokenKeystore : SecretCipher {
    override fun encrypt(plain: ByteArray): ByteArray = throw KeyStoreException("keystore unavailable")
    override fun decrypt(blob: ByteArray): ByteArray = throw KeyStoreException("keystore unavailable")
}

/** A2: the encryptHistory setting (default OFF), its AppGraph wiring and the switch's migration. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EncryptHistorySettingTest {
    @get:Rule val tmp = TemporaryFolder()
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default.limitedParallelism(1))
    private lateinit var db: AppDatabase
    private lateinit var recordingsDir: File
    private lateinit var settings: SettingsRepository
    private lateinit var keys: DataStoreWrappedKeyStore
    private var files = 0

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        recordingsDir = File(tmp.root, "recordings").also { it.mkdirs() }
        settings = SettingsRepository(store("settings"), InMemorySecretStore(), FakeCatalog())
        keys = DataStoreWrappedKeyStore(store("data_key"))
    }

    @After fun tearDown() {
        db.close(); appScope.cancel(); ioScope.cancel()
    }

    private fun store(name: String) =
        PreferenceDataStoreFactory.create(scope = ioScope) { File(tmp.root, "$name-${files++}.preferences_pb") }

    private fun graph(cipher: DataCipher? = DataCipher(TestCipher(), keys)): AppGraph {
        val dictation = DictationController(
            scope = appScope, recorder = FakeRecorder(), focus = FakeFocus(), transcriber = FakeTranscriber(),
            settings = FakeSettings(), history = FakeHistory(), tidy = TextTidy { it }, recordingsDir = recordingsDir,
            micGranted = { true }, nowMs = { 0L }, wallClockMs = { 1_000_000L }, newId = { "x" },
        )
        return AppGraph(
            AppGraph.Overrides(
                appScope, db, InMemorySecretStore(), settings, recordingsDir, dictation,
                appLanguages = AppLanguageStore(store("app_languages")), dataCipher = cipher,
            ),
        )
    }

    private fun row(id: String, text: String?) = Recording(
        id = id, createdAt = 1000L + id.hashCode(), durationMs = 1000, status = RecordingStatus.DONE,
        provider = "openai", model = "whisper-1", language = "pl", transcript = text, source = RecordingSource.APP,
    )

    private suspend fun raw(id: String) = db.recordings().get(id)!!.transcript

    private fun sealed(s: String?) = s != null && DataCipher.isSealedText(s)

    @Test fun settingIsOffByDefaultAndNewRowsStayPlain() = runBlocking {
        val g = graph()
        assertFalse(settings.current().encryptHistory)
        g.history.upsert(row("a", "zażółć gęślą jaźń"))
        assertEquals("zażółć gęślą jaźń", raw("a"))
        assertNull("no data key is minted while the switch is OFF", keys.read())
    }

    @Test fun turningOnSealsExistingAndNewRowsAndReadsStayPlain() = runBlocking {
        val g = graph()
        g.history.upsert(row("a", "one")); g.history.upsert(row("b", "two")); g.history.upsert(row("c", null))

        val res = g.setEncryptHistory(true)

        assertEquals(EncryptHistoryResult.Done(MigrationReport(converted = 2, unreadable = 0)), res)
        assertTrue(settings.current().encryptHistory)
        assertTrue(sealed(raw("a")) && sealed(raw("b")))
        assertNull(raw("c"))
        g.history.upsert(row("d", "three"))
        assertTrue("written after the switch: sealed", sealed(raw("d")))
        assertEquals(listOf("one", "two", null, "three"), listOf("a", "b", "c", "d").map { g.history.get(it)!!.transcript })
        assertEquals(setOf("one", "two", "three"), g.history.observeAll().first().mapNotNull { it.transcript }.toSet())
    }

    @Test fun turningOffOpensEveryRowAgain() = runBlocking {
        val g = graph()
        g.history.upsert(row("a", "one"))
        g.setEncryptHistory(true)
        assertTrue(sealed(raw("a")))

        val res = g.setEncryptHistory(false)

        assertEquals(EncryptHistoryResult.Done(MigrationReport(converted = 1, unreadable = 0)), res)
        assertFalse(settings.current().encryptHistory)
        assertEquals("one", raw("a"))
        g.history.upsert(row("b", "two"))
        assertEquals("two", raw("b"))
    }

    @Test fun brokenKeystoreRefusesToTurnOnAndChangesNothing() = runBlocking {
        val g = graph(DataCipher(BrokenKeystore(), keys))
        g.history.upsert(row("a", "one"))

        assertEquals(EncryptHistoryResult.KeystoreUnavailable, g.setEncryptHistory(true))

        assertFalse(settings.current().encryptHistory)
        assertEquals("one", raw("a"))
    }

    @Test fun backToBackTogglesEndInAConsistentState() = runBlocking {
        val g = graph()
        for (i in 1..5) g.history.upsert(row("r$i", "text $i"))
        val a = async(Dispatchers.Default) { g.setEncryptHistory(true) }
        val b = async(Dispatchers.Default) { g.setEncryptHistory(false) }
        a.await(); b.await()
        val on = settings.current().encryptHistory
        // Whichever toggle ran last wins, and every row matches the flag (no half-migrated mix).
        assertTrue((1..5).all { sealed(raw("r$it")) == on })
        assertEquals((1..5).map { "text $it" }, (1..5).map { g.history.get("r$it")!!.transcript })
    }

    @Test fun graphWithoutCipherKeepsPlainHistoryAndRefuses() = runBlocking {
        val g = graph(cipher = null)
        g.history.upsert(row("a", "one"))
        assertEquals(EncryptHistoryResult.KeystoreUnavailable, g.setEncryptHistory(true))
        assertFalse(settings.current().encryptHistory)
        assertEquals("one", raw("a"))
    }

    @Test fun maintenanceFinishesASwitchKilledHalfWay() = runBlocking {
        val g = graph()
        for (i in 1..4) g.history.upsert(row("r$i", "text $i"))
        // Process died right after the flag was saved, before the migration ran.
        settings.setEncryptHistory(true)
        g.history.upsert(row("r5", "text 5"))
        assertTrue(sealed(raw("r5")))
        assertFalse(sealed(raw("r1")))

        g.runMaintenance()
        awaitAll { (1..5).all { sealed(raw("r$it")) } }

        assertEquals((1..5).map { "text $it" }, (1..5).map { g.history.get("r$it")!!.transcript })
    }

    @Test fun maintenanceFinishesAnInterruptedTurnOff() = runBlocking {
        val g = graph()
        g.history.upsert(row("a", "one")); g.history.upsert(row("b", "two"))
        g.setEncryptHistory(true)
        settings.setEncryptHistory(false) // killed after the flag, before the rows were opened

        g.runMaintenance()
        awaitAll { raw("a") == "one" && raw("b") == "two" }
    }

    @Test fun migrationNeverPutsBackAStaleRow() = runBlocking {
        // The compare-and-swap the migration saves through: a row rewritten since it was read is left alone.
        val dao = db.recordings()
        dao.upsert(row("a", "old"))
        dao.upsert(row("a", "new").copy(status = RecordingStatus.DONE))
        assertEquals(0, dao.swapText("a", oldTranscript = "old", oldError = null, newTranscript = "WE1:x", newError = null))
        assertEquals("new", raw("a"))
        assertEquals(1, dao.swapText("a", oldTranscript = "new", oldError = null, newTranscript = "WE1:y", newError = null))
        assertEquals("WE1:y", raw("a"))
    }

    @Test fun wrappedKeyStoreRoundTripsAndDeletes() = runBlocking {
        assertNull(keys.read())
        keys.write(byteArrayOf(1, 2, 3, 4))
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), keys.read())
        keys.delete()
        assertNull(keys.read())
    }

    @Test fun corruptWrappedKeyIsNeverSilentlyReplaced() = runBlocking {
        val ds = store("corrupt")
        ds.updateData { p ->
            p.toMutablePreferences().apply {
                set(androidx.datastore.preferences.core.stringPreferencesKey("wrapped_dek_v1"), "%%% not base64 %%%")
            }
        }
        val corrupt = DataStoreWrappedKeyStore(ds)
        assertArrayEquals(ByteArray(0), corrupt.read())
        val cipher = DataCipher(TestCipher(), corrupt)
        try {
            cipher.sealText("x")
            fail("sealing must not mint a new key over an existing one")
        } catch (expected: Exception) {
            // TestCipher.decrypt on an empty blob throws: fail closed.
        }
        assertArrayEquals(ByteArray(0), corrupt.read())
    }

    @Test fun switchEncryptsKeptClipsOnAndRestoresThemOff() = runBlocking {
        val g = graph()
        val plain = File(recordingsDir, "a.m4a").also { f -> f.writeBytes(ByteArray(200_000) { i -> (i * 31).toByte() }) }
        val bytes = plain.readBytes()
        g.history.upsert(row("a", "one").copy(audioPath = plain.path))
        val enc = File(plain.path + ".wea")

        val on = g.setEncryptHistory(true)

        assertEquals(EncryptHistoryResult.Done(MigrationReport(converted = 1, unreadable = 0, audioConverted = 1)), on)
        assertEquals(enc.path, db.recordings().get("a")!!.audioPath)
        assertTrue(enc.exists())
        assertFalse("no plaintext clip may remain", plain.exists())

        val off = g.setEncryptHistory(false)

        assertEquals(EncryptHistoryResult.Done(MigrationReport(converted = 1, unreadable = 0, audioConverted = 1)), off)
        assertEquals(plain.path, db.recordings().get("a")!!.audioPath)
        assertArrayEquals(bytes, plain.readBytes())
        assertFalse(enc.exists())
    }

    @Test fun maintenanceEncryptsClipsLeftPlainWhileEncryptionIsOn() = runBlocking {
        val g = graph()
        settings.setEncryptHistory(true) // ON, but a clip was kept plain (Keystore failed at the time)
        val plain = File(recordingsDir, "a.m4a").also { it.writeBytes(ByteArray(1000) { 5 }) }
        g.history.upsert(row("a", "one").copy(audioPath = plain.path))

        g.runMaintenance()
        awaitAll { db.recordings().get("a")!!.audioPath == plain.path + ".wea" }

        assertFalse(plain.exists())
        assertTrue(File(plain.path + ".wea").exists())
    }

    @Test fun eraseShredsTheDataKeyBeforeDeletingRows() = runBlocking {
        var rowsWhenShredded = -1
        val spy = object : WrappedKeyStore {
            override suspend fun read() = keys.read()
            override suspend fun write(wrapped: ByteArray) = keys.write(wrapped)
            override suspend fun delete() {
                rowsWhenShredded = db.recordings().observeAll().first().size
                keys.delete()
            }
        }
        val g = graph(DataCipher(TestCipher(), spy))
        g.history.upsert(row("a", "one")); g.history.upsert(row("b", "two"))
        g.setEncryptHistory(true)
        assertTrue(keys.read() != null)

        g.eraseAllData()

        assertEquals("key destroyed while the rows still existed", 2, rowsWhenShredded)
        assertNull(keys.read())
        assertTrue(db.recordings().observeAll().first().isEmpty())
        assertFalse(settings.current().encryptHistory)
    }

    @Test fun eraseWithEncryptionOffStillLeavesNoKey() = runBlocking {
        val g = graph()
        g.history.upsert(row("a", "one"))
        g.eraseAllData()
        assertNull(keys.read())
        assertTrue(db.recordings().observeAll().first().isEmpty())
    }

    @Test fun noticeOnlyForProblems() {
        assertEquals(EncryptNotice.Unavailable, encryptNoticeFor(EncryptHistoryResult.KeystoreUnavailable))
        assertNull(encryptNoticeFor(EncryptHistoryResult.Done(MigrationReport(converted = 3, unreadable = 0))))
        assertEquals(EncryptNotice.Unreadable(2), encryptNoticeFor(EncryptHistoryResult.Done(MigrationReport(converted = 1, unreadable = 2))))
        assertEquals(
            "clips that could not be converted count too",
            EncryptNotice.Unreadable(3),
            encryptNoticeFor(EncryptHistoryResult.Done(MigrationReport(converted = 0, unreadable = 1, audioUnreadable = 2))),
        )
    }

    private suspend fun awaitAll(done: suspend () -> Boolean) {
        repeat(200) {
            if (done()) return
            Thread.sleep(10)
        }
        assertTrue("condition not reached", done())
    }
}
