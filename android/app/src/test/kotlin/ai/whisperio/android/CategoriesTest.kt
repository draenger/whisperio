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
import ai.whisperio.android.security.InMemorySecretStore
import ai.whisperio.android.security.KeystoreSecretStore
import ai.whisperio.android.settings.AppLanguageStore
import ai.whisperio.android.settings.CategoryNameCheck
import ai.whisperio.android.settings.CustomCategories
import ai.whisperio.android.settings.CustomCategory
import ai.whisperio.android.settings.SettingsRepository
import ai.whisperio.core.Categories
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
import kotlinx.coroutines.runBlocking
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

private val SEED_LABELS_EN = listOf("Work", "Personal", "Ideas", "Messages", "Code", "To-do")
private val SEED_LABELS_PL = listOf("Praca", "Prywatne", "Pomysły", "Wiadomości", "Kod", "Do zrobienia")

/** CONTRACT-1.2 F3 pure logic: D6 name rule, hue slots, add / delete, JSON round trip. */
class CustomCategoriesTest {
    private fun ok(name: String, taken: List<String> = SEED_LABELS_EN) =
        (CustomCategories.check(name, taken) as CategoryNameCheck.Ok).name

    @Test fun nameIsTrimmed() {
        assertEquals("Reading", ok("  Reading  "))
    }

    @Test fun blankIsRejected() {
        assertEquals(CategoryNameCheck.Blank, CustomCategories.check("", SEED_LABELS_EN))
        assertEquals(CategoryNameCheck.Blank, CustomCategories.check("   \t", SEED_LABELS_EN))
    }

    @Test fun lengthBoundsAre1To24AfterTrim() {
        assertEquals("a", ok("a"))
        assertEquals("x".repeat(24), ok(" " + "x".repeat(24) + " "))
        assertEquals(CategoryNameCheck.TooLong, CustomCategories.check("x".repeat(25), SEED_LABELS_EN))
    }

    @Test fun duplicateOfASeedLabelIsCaseInsensitive() {
        assertEquals(CategoryNameCheck.Duplicate, CustomCategories.check("work", SEED_LABELS_EN))
        assertEquals(CategoryNameCheck.Duplicate, CustomCategories.check("  TO-DO ", SEED_LABELS_EN))
        assertEquals(CategoryNameCheck.Duplicate, CustomCategories.check("PRACA", SEED_LABELS_PL))
        assertEquals(CategoryNameCheck.Duplicate, CustomCategories.check("pomysły", SEED_LABELS_PL))
    }

    @Test fun duplicateOfAnExistingCustomNameIsRejected() {
        val taken = SEED_LABELS_EN + "Łódź"
        assertEquals(CategoryNameCheck.Duplicate, CustomCategories.check("łÓDŹ", taken))
    }

    @Test fun otherLanguageSeedLabelIsRejected() {
        SEED_LABELS_PL.forEach { label ->
            assertEquals(CategoryNameCheck.Duplicate, CustomCategories.check("  ${label.uppercase(java.util.Locale.ROOT)}  ", SEED_LABELS_EN))
        }
        SEED_LABELS_EN.forEach { label ->
            assertEquals(CategoryNameCheck.Duplicate, CustomCategories.check("  ${label.uppercase(java.util.Locale.ROOT)}  ", SEED_LABELS_PL))
        }
    }

    @Test fun firstCustomGetsSlotZeroAndSlotsFollowCreationOrder() {
        var list = emptyList<CustomCategory>()
        list = CustomCategories.add(list, "A", "c_1")
        list = CustomCategories.add(list, "B", "c_2")
        list = CustomCategories.add(list, "C", "c_3")
        assertEquals(listOf(0, 1, 2), list.map { it.hueIndex })
        assertEquals(listOf("A", "B", "C"), list.map { it.name })
    }

    @Test fun deletingOneNeverShiftsTheColoursOfTheOthers() {
        var list = emptyList<CustomCategory>()
        list = CustomCategories.add(list, "A", "c_1")
        list = CustomCategories.add(list, "B", "c_2")
        list = CustomCategories.add(list, "C", "c_3")
        val before = list.associate { it.id to Categories.customHue(it.hueIndex) }
        val after = CustomCategories.remove(list, "c_2")
        after.forEach { assertEquals(before[it.id], Categories.customHue(it.hueIndex)) }
        // The next one continues after the highest stored slot instead of reusing a live slot.
        val next = CustomCategories.add(after, "D", "c_4")
        assertEquals(3, next.last().hueIndex)
    }

    @Test fun deletingEverythingRestartsAtSlotZero() {
        val list = CustomCategories.remove(CustomCategories.add(emptyList(), "A", "c_1"), "c_1")
        assertEquals(0, CustomCategories.nextHue(list))
    }

    @Test fun removeUnknownIdIsANoOp() {
        val list = CustomCategories.add(emptyList(), "A", "c_1")
        assertEquals(list, CustomCategories.remove(list, "c_zzz"))
    }

    @Test fun jsonRoundTripKeepsIdNameAndStoredHue() {
        val list = listOf(CustomCategory("c_a", "Zażółć \"gęślą\"", 4), CustomCategory("c_b", "B", 9))
        assertEquals(list, CustomCategories.decode(CustomCategories.encode(list)))
    }

    @Test fun decodeToleratesGarbageAndDuplicates() {
        assertEquals(emptyList<CustomCategory>(), CustomCategories.decode(null))
        assertEquals(emptyList<CustomCategory>(), CustomCategories.decode(""))
        assertEquals(emptyList<CustomCategory>(), CustomCategories.decode("not json"))
        assertEquals(emptyList<CustomCategory>(), CustomCategories.decode("{\"a\":1}"))
        val raw = "[{\"id\":\"c_1\",\"name\":\"A\",\"hue\":0},{\"id\":\"c_1\",\"name\":\"dup\",\"hue\":1}," +
            "{\"id\":\"work\",\"name\":\"seed id\",\"hue\":2},{\"id\":\"c_2\",\"name\":\"\",\"hue\":3},7]"
        assertEquals(listOf(CustomCategory("c_1", "A", 0)), CustomCategories.decode(raw))
    }
}

/** Repository + graph + Room: add / delete, rows reset, Erase all, and the controller not clobbering a category. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CategoryPersistenceTest {
    @get:Rule val tmp = TemporaryFolder()
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var db: AppDatabase
    private lateinit var recordingsDir: File
    private lateinit var history: RoomHistoryStore
    private lateinit var settings: SettingsRepository
    private var ids = 0

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        recordingsDir = File(tmp.root, "recordings").also { it.mkdirs() }
        history = RoomHistoryStore(db.recordings(), recordingsDir)
        settings = SettingsRepository(
            PreferenceDataStoreFactory.create(scope = ioScope) { File(tmp.root, "settings.preferences_pb") },
            InMemorySecretStore(), FakeCatalog(),
        )
    }

    @After fun tearDown() { db.close(); ioScope.cancel() }

    private fun row(id: String, category: String? = null, status: RecordingStatus = RecordingStatus.DONE) = Recording(
        id = id, createdAt = 1_000L + id.hashCode(), durationMs = 1_000, status = status, provider = "openai",
        model = "whisper-1", language = "auto", transcript = "text $id", source = RecordingSource.WIDGET, category = category,
    )

    private fun newId() = Categories.CUSTOM_PREFIX + "id${++ids}"

    private fun graph(scope: CoroutineScope, dictation: DictationController): AppGraph {
        val secrets = KeystoreSecretStore(
            PreferenceDataStoreFactory.create(scope = ioScope) { File(tmp.root, "secrets.preferences_pb") }, TestCipher(),
        )
        val appLanguages = AppLanguageStore(
            PreferenceDataStoreFactory.create(scope = ioScope) { File(tmp.root, "app_languages.preferences_pb") },
        )
        return AppGraph(AppGraph.Overrides(scope, db, secrets, settings, recordingsDir, dictation, appLanguages))
    }

    @Test fun addPersistsInCreationOrderWithStoredHue() = runBlocking {
        assertEquals(CategoryNameCheck.Ok("Reading"), settings.addCustomCategory("  Reading ", SEED_LABELS_EN, { newId() }))
        settings.addCustomCategory("Gym", SEED_LABELS_EN, { newId() })
        val list = settings.customCategories.first()
        assertEquals(listOf("Reading", "Gym"), list.map { it.name })
        assertEquals(listOf(0, 1), list.map { it.hueIndex })
        assertTrue(list.all { it.id.startsWith("c_") })
    }

    @Test fun addRejectsDuplicatesAgainstSeedsAndExistingNamesAtomically() = runBlocking {
        settings.addCustomCategory("Reading", SEED_LABELS_EN, { newId() })
        assertEquals(CategoryNameCheck.Duplicate, settings.addCustomCategory("work", SEED_LABELS_EN, { newId() }))
        assertEquals(CategoryNameCheck.Duplicate, settings.addCustomCategory("READING", SEED_LABELS_EN, { newId() }))
        assertEquals(CategoryNameCheck.Blank, settings.addCustomCategory("  ", SEED_LABELS_EN, { newId() }))
        assertEquals(1, settings.customCategories.first().size)
    }

    @Test fun deleteResetsEveryRowThatCarriedIt() = runTest {
        val scope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val g = graph(scope, controllerFor(scope))
        settings.addCustomCategory("Reading", SEED_LABELS_EN, { newId() })
        val id = settings.customCategories.first().single().id
        history.upsert(row("a", id)); history.upsert(row("b", id)); history.upsert(row("c", "work")); history.upsert(row("d", null))

        g.deleteCategory(id)

        assertTrue(settings.customCategories.first().isEmpty())
        assertNull(history.get("a")!!.category)
        assertNull(history.get("b")!!.category)
        assertEquals("work", history.get("c")!!.category) // other categories untouched
        assertNull(history.get("d")!!.category)
    }

    @Test fun setCategoryTouchesOnlyThatColumn() = runBlocking {
        history.upsert(row("a"))
        history.setCategory("a", "ideas")
        val set = history.get("a")!!
        assertEquals("ideas", set.category)
        assertEquals(row("a").copy(category = "ideas"), set)
        history.setCategory("a", null)
        assertNull(history.get("a")!!.category)
    }

    @Test fun eraseAllRemovesCustomCategories() = runBlocking {
        settings.addCustomCategory("Reading", SEED_LABELS_EN, { newId() })
        settings.clear()
        assertTrue(settings.customCategories.first().isEmpty())
    }

    @Test fun eraseAllDataDropsCustomCategoriesAndCategorisedRows() = runTest {
        val scope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val g = graph(scope, controllerFor(scope))
        settings.addCustomCategory("Reading", SEED_LABELS_EN, { newId() })
        history.upsert(row("a", "work"))

        g.eraseAllData()

        assertTrue(settings.customCategories.first().isEmpty())
        assertTrue(history.observeAll().first().isEmpty())
    }

    private fun TestScope.controllerFor(scope: CoroutineScope) = DictationController(
        scope = scope, recorder = FakeRecorder(), focus = FakeFocus(), transcriber = FakeTranscriber(),
        settings = FakeSettings(), history = history, tidy = TextTidy { it },
        recordingsDir = recordingsDir, micGranted = { true }, nowMs = { testScheduler.currentTime },
    )
}

/** The controller re-reads the row before every write, so a category set meanwhile survives (CONTRACT-1.2 F3). */
@OptIn(ExperimentalCoroutinesApi::class)
class CategoryControllerTest {
    @get:Rule val tmp = TemporaryFolder()
    private val transcriber = FakeTranscriber(latencyMs = 500)
    private val history = FakeHistory()
    private var ids = 0

    private fun TestScope.controller(recorder: FakeRecorder = FakeRecorder()) = DictationController(
        scope = CoroutineScope(StandardTestDispatcher(testScheduler)),
        recorder = recorder, focus = FakeFocus(), transcriber = transcriber, settings = FakeSettings(), history = history,
        tidy = TextTidy { it }, recordingsDir = File(tmp.root, "recordings"), micGranted = { true },
        nowMs = { testScheduler.currentTime }, wallClockMs = { 1_000_000L }, newId = { "id${++ids}" },
    )

    private fun TestScope.advance(ms: Long) { advanceTimeBy(ms); runCurrent() }

    @Test fun categorySetWhileTranscribingSurvivesTheFinalWrite() = runTest {
        val c = controller()
        c.start(StartOptions(RecordingSource.APP))
        runCurrent(); advance(1_000)
        c.stopAndTranscribe()
        advance(100)
        assertTrue(c.state.value is DictationState.Transcribing)

        history.setCategory("id1", "work")
        advance(1_000)

        val row = history.rows.value["id1"]!!
        assertEquals(RecordingStatus.DONE, row.status)
        assertEquals("work", row.category)
    }

    @Test fun categorySetWhileRecordingSurvivesAFailedRecording() = runTest {
        val c = controller(FakeRecorder(amplitude = { 0 })) // silent mic: the controller fails the clip after the guard
        c.start(StartOptions(RecordingSource.APP))
        runCurrent(); advance(500)
        history.setCategory("id1", "ideas")
        advance(4_000)

        val row = history.rows.value["id1"]!!
        assertEquals(RecordingStatus.FAILED, row.status)
        assertEquals("ideas", row.category)
    }
}
