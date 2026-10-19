package ai.whisperio.android

import ai.whisperio.android.di.AppGraph
import ai.whisperio.android.di.TextTidy
import ai.whisperio.android.dictation.DictationController
import ai.whisperio.android.dictation.DictationState
import ai.whisperio.android.dictation.StartOptions
import ai.whisperio.android.history.AppDatabase
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.history.RoomHistoryStore
import ai.whisperio.android.security.KeystoreSecretStore
import ai.whisperio.android.settings.SettingsRepository
import ai.whisperio.core.ProviderId
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
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
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EraseAllTest {
    @get:Rule val tmp = TemporaryFolder()
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var db: AppDatabase
    private lateinit var recordingsDir: File
    private lateinit var history: RoomHistoryStore
    private lateinit var secrets: KeystoreSecretStore
    private lateinit var settings: SettingsRepository
    private val recorder = FakeRecorder()
    private val transcriber = FakeTranscriber(latencyMs = 10_000)
    private var ids = 0

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        recordingsDir = File(tmp.root, "recordings").also { it.mkdirs() }
        history = RoomHistoryStore(db.recordings(), recordingsDir)
        secrets = KeystoreSecretStore(
            PreferenceDataStoreFactory.create(scope = ioScope) { File(tmp.root, "secrets.preferences_pb") }, TestCipher(),
        )
        settings = SettingsRepository(
            PreferenceDataStoreFactory.create(scope = ioScope) { File(tmp.root, "settings.preferences_pb") },
            secrets, FakeCatalog(),
        )
    }

    @After fun tearDown() { db.close(); ioScope.cancel() }

    private fun row(id: String, audio: File?) = Recording(
        id = id, createdAt = 1000L + id.hashCode(), durationMs = 1000, status = RecordingStatus.DONE,
        provider = "openai", model = "whisper-1", language = "auto", transcript = "text $id",
        audioPath = audio?.path, source = RecordingSource.APP,
    )

    private suspend fun seedEverything() {
        val a = File(recordingsDir, "a.m4a").also { it.writeBytes(byteArrayOf(1, 2, 3)) }
        File(recordingsDir, "orphan.m4a").writeBytes(byteArrayOf(9))
        history.upsert(row("a", a)); history.upsert(row("b", null))
        secrets.put(ProviderId.OPENAI, "sk-secret"); secrets.put(ProviderId.GROQ, "gsk-x")
        settings.setConsent(true); settings.setSensitive(true); settings.setKeepAudio(false)
        settings.setAutoDeleteDays(7); settings.setLanguage("pl"); settings.setVocabulary("Whisperio")
        settings.setOnboardingDone(true)
    }

    private fun TestScope.appScope() = CoroutineScope(StandardTestDispatcher(testScheduler))

    private lateinit var lastController: DictationController

    private fun TestScope.controller(scope: CoroutineScope) = DictationController(
        scope = scope, recorder = recorder, focus = FakeFocus(), transcriber = transcriber,
        settings = FakeSettings(), history = history, tidy = TextTidy { it },
        recordingsDir = recordingsDir, micGranted = { true },
        nowMs = { testScheduler.currentTime }, wallClockMs = { 1_000_000L }, newId = { "live${++ids}" },
    ).also { lastController = it }

    private fun TestScope.awaitState(done: (DictationState) -> Boolean) {
        val dictation = lastController
        repeat(300) {
            runCurrent()
            if (done(dictation.state.value)) return
            Thread.sleep(10)
            advanceTimeBy(100)
        }
        assertTrue("state=${lastController.state.value}", done(lastController.state.value))
    }

    private fun graph(scope: CoroutineScope, dictation: DictationController) = AppGraph(
        AppGraph.Overrides(scope, db, secrets, settings, recordingsDir, dictation),
    )

    @Test fun eraseLeavesNoRowsFilesSecretsAndDefaultSettings() = runTest {
        val scope = appScope()
        val dictation = controller(scope)
        seedEverything()
        assertEquals(2, history.observeAll().first().size)

        graph(scope, dictation).eraseAllData()

        assertTrue(history.observeAll().first().isEmpty())
        assertEquals(emptyList<File>(), recordingsDir.listFiles().orEmpty().toList())
        assertNull(secrets.get(ProviderId.OPENAI)); assertNull(secrets.get(ProviderId.GROQ))
        assertTrue(secrets.configured.first().isEmpty())
        val fresh = SettingsRepository(
            PreferenceDataStoreFactory.create(scope = ioScope) { File(tmp.root, "fresh.preferences_pb") }, secrets, FakeCatalog(),
        ).current()
        assertEquals(fresh, settings.current())
    }

    @Test fun eraseDuringInFlightTranscriptionWritesNothingAfterwards() = runTest {
        val scope = appScope()
        val dictation = controller(scope)
        seedEverything()

        dictation.start(StartOptions(RecordingSource.APP, session = "s"))
        // The real RoomHistoryStore writes on Room's own executor, so the controller only moves on after a
        // real-time hop: interleave virtual time with short real sleeps until the state is reached (bounded).
        awaitState { (it as? DictationState.Recording)?.let { r -> r.elapsedMs >= 1_500 } == true }
        dictation.stopAndTranscribe()
        awaitState { it is DictationState.Transcribing }

        graph(scope, dictation).eraseAllData()
        assertEquals(DictationState.Idle, dictation.state.value)

        advanceTimeBy(60_000); runCurrent() // transcriber latency long elapsed
        assertTrue(history.observeAll().first().isEmpty())
        assertEquals(emptyList<File>(), recordingsDir.listFiles().orEmpty().toList())
        assertTrue(secrets.configured.first().isEmpty())
    }
}
