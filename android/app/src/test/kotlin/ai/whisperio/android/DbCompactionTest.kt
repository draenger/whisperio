package ai.whisperio.android

import ai.whisperio.android.di.AppGraph
import ai.whisperio.android.di.EncryptHistoryResult
import ai.whisperio.android.di.TextTidy
import ai.whisperio.android.dictation.DictationController
import ai.whisperio.android.history.AppDatabase
import ai.whisperio.android.history.DbCompactor
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.security.DataCipher
import ai.whisperio.android.security.DataStoreWrappedKeyStore
import ai.whisperio.android.security.InMemorySecretStore
import ai.whisperio.android.settings.AppLanguageStore
import ai.whisperio.android.settings.SettingsRepository
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Counts calls and can be told to fail, in place of the real VACUUM. */
private class SpyCompactor(db: AppDatabase, var succeed: Boolean = true) : DbCompactor(db) {
    var compactCalls = 0
    val secureDeleteCalls = mutableListOf<Boolean>()

    override suspend fun compact(): Boolean {
        compactCalls++
        return succeed
    }

    override suspend fun setSecureDelete(on: Boolean) {
        secureDeleteCalls += on
        super.setSecureDelete(on)
    }
}

/** #21 follow-up: WAL checkpoint + VACUUM + secure_delete after the encryption switch. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DbCompactionTest {
    @get:Rule val tmp = TemporaryFolder()
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default.limitedParallelism(1))
    private lateinit var db: AppDatabase
    private lateinit var settings: SettingsRepository
    private lateinit var keys: DataStoreWrappedKeyStore
    private var files = 0

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        settings = SettingsRepository(store("settings"), InMemorySecretStore(), FakeCatalog())
        keys = DataStoreWrappedKeyStore(store("data_key"))
    }

    @After fun tearDown() {
        db.close(); appScope.cancel(); ioScope.cancel()
    }

    private fun store(name: String) =
        PreferenceDataStoreFactory.create(scope = ioScope) { File(tmp.root, "$name-${files++}.preferences_pb") }

    private fun graph(compactor: DbCompactor?): AppGraph {
        val dir = File(tmp.root, "recordings").also { it.mkdirs() }
        val dictation = DictationController(
            scope = appScope, recorder = FakeRecorder(), focus = FakeFocus(), transcriber = FakeTranscriber(),
            settings = FakeSettings(), history = FakeHistory(), tidy = TextTidy { it }, recordingsDir = dir,
            micGranted = { true }, nowMs = { 0L }, wallClockMs = { 1_000_000L }, newId = { "x" },
        )
        return AppGraph(
            AppGraph.Overrides(
                appScope, db, InMemorySecretStore(), settings, dir, dictation,
                appLanguages = AppLanguageStore(store("app_languages")),
                dataCipher = DataCipher(TestCipher(), keys), compactor = compactor,
            ),
        )
    }

    private fun row(id: String, text: String) = Recording(
        id = id, createdAt = 1000L + id.hashCode(), durationMs = 1000, status = RecordingStatus.DONE,
        provider = "openai", model = "whisper-1", language = "pl", transcript = text, source = RecordingSource.APP,
    )

    private fun pragma(sql: String): Long =
        db.openHelper.writableDatabase.query(sql).use { if (it.moveToFirst()) it.getLong(0) else -1L }

    private suspend fun awaitAll(cond: suspend () -> Boolean) {
        repeat(200) { if (cond()) return; delay(25) }
        fail("condition not reached")
    }

    @Test fun turningOnCheckpointsVacuumsAndLeavesNoFreePages() = runBlocking {
        val g = graph(null) // real DbCompactor on the real (in-memory) Room database
        val big = "x".repeat(4000)
        for (i in 1..40) g.history.upsert(row("r$i", big))
        db.openHelper.writableDatabase.execSQL("DELETE FROM recording WHERE id IN (SELECT id FROM recording LIMIT 30)")
        assertTrue("setup must leave free pages", pragma("PRAGMA freelist_count") > 0)

        val res = g.setEncryptHistory(true)

        assertTrue(res is EncryptHistoryResult.Done)
        assertEquals(0L, pragma("PRAGMA freelist_count"))
        assertEquals(1L, pragma("PRAGMA secure_delete"))
        assertFalse(settings.needsCompaction())
    }

    @Test fun turningOnRunsCompactionAndSecureDeleteOnce() = runBlocking {
        val spy = SpyCompactor(db)
        val g = graph(spy)
        g.history.upsert(row("a", "one"))

        g.setEncryptHistory(true)

        assertEquals(1, spy.compactCalls)
        assertEquals(listOf(true), spy.secureDeleteCalls)
        assertFalse(settings.needsCompaction())
    }

    @Test fun turningOffClearsSecureDeleteAndDoesNotCompact() = runBlocking {
        val spy = SpyCompactor(db)
        val g = graph(spy)
        g.setEncryptHistory(true)
        assertEquals(1L, pragma("PRAGMA secure_delete"))

        g.setEncryptHistory(false)

        assertEquals(0L, pragma("PRAGMA secure_delete"))
        assertEquals(listOf(true, false), spy.secureDeleteCalls)
        assertEquals(1, spy.compactCalls)
    }

    @Test fun failedVacuumKeepsTheMigrationSuccessfulAndRaisesTheFlag() = runBlocking {
        val spy = SpyCompactor(db, succeed = false)
        val g = graph(spy)
        g.history.upsert(row("a", "one"))

        val res = g.setEncryptHistory(true)

        assertTrue(res is EncryptHistoryResult.Done)
        assertTrue(DataCipher.isSealedText(db.recordings().get("a")!!.transcript!!))
        assertTrue(settings.current().encryptHistory)
        assertTrue(settings.needsCompaction())
    }

    @Test fun nextMaintenanceRetriesAndClearsTheFlag() = runBlocking {
        val spy = SpyCompactor(db, succeed = false)
        val g = graph(spy)
        g.history.upsert(row("a", "one"))
        g.setEncryptHistory(true)
        assertTrue(settings.needsCompaction())
        val before = spy.compactCalls

        spy.succeed = true
        g.runMaintenance()

        awaitAll { !settings.needsCompaction() }
        assertEquals(before + 1, spy.compactCalls)
    }

    @Test fun maintenanceWithoutTheFlagDoesNotCompact() = runBlocking {
        val spy = SpyCompactor(db)
        val g = graph(spy)

        g.runMaintenance()
        awaitAll { spy.secureDeleteCalls.isNotEmpty() }

        assertEquals(0, spy.compactCalls)
        assertEquals(listOf(false), spy.secureDeleteCalls)
    }
}
