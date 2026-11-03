package ai.whisperio.android

import ai.whisperio.android.di.MAX_CLIPBOARD_DELAY_MS
import ai.whisperio.android.di.appScopeExceptionHandler
import ai.whisperio.android.di.isFatal
import ai.whisperio.android.dictate.DictateActivity
import ai.whisperio.android.dictation.DictationResult
import ai.whisperio.android.di.copyDictateResults
import ai.whisperio.android.di.corruptionHandlerFor
import ai.whisperio.android.history.RecordingSource
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.edit
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.yield
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Finding #3: a corrupt settings file falls back to defaults, and a throwing app-scope job cannot kill the process. */
@RunWith(RobolectricTestRunner::class)
class AppGraphRobustnessTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test fun corruptDataStoreFileFallsBackToDefaultsAndStaysWritable() = runBlocking {
        val file = File(tmp.root, "settings.preferences_pb").also { it.writeBytes(ByteArray(64) { 0x7F }) }
        val store = PreferenceDataStoreFactory.create(corruptionHandler = corruptionHandlerFor("test")) { file }
        assertTrue(store.data.first().asMap().isEmpty())
        val key = stringPreferencesKey("k")
        store.edit { it[key] = "v" }
        assertEquals("v", store.data.first()[key])
    }

    @Test fun appScopeSurvivesAnUncaughtException() = runBlocking {
        var recovered = 0
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + appScopeExceptionHandler(recover = { recovered++ }))
        scope.launch { error("boom") }.join()
        assertEquals(1, recovered)
        var ran: String? = null
        scope.launch { ran = "ok" }.join()
        assertEquals("ok", ran)
        assertTrue(scope.coroutineContext[kotlinx.coroutines.Job]!!.isActive)
    }

    /** Finding #5: the copy must not depend on any Activity; it is driven purely by the app-scoped results flow. */
    @Test fun dictateResultsAreCopiedWithoutAnyActivityAndOtherSessionsAreIgnored() = runBlocking {
        val results = MutableSharedFlow<DictationResult>(extraBufferCapacity = 8)
        val copied = java.util.concurrent.CopyOnWriteArrayList<Pair<String, Boolean>>()
        val job = CoroutineScope(Dispatchers.Default).launch {
            copyDictateResults(results, sensitive = { true }, copy = { t, s -> copied += t to s })
        }
        results.subscriptionCount.first { it > 0 }
        results.emit(DictationResult("r1", "from keyboard", RecordingSource.KEYBOARD, session = Any()))
        results.emit(DictationResult("r2", "from tile", RecordingSource.TILE, DictateActivity.SESSION_TAG))
        while (copied.isEmpty()) yield()
        job.cancel()
        assertEquals(listOf("from tile" to true), copied.toList())
    }

    @Test fun fatalErrorsAreRethrownNotSwallowedAndDoNotRecover() = runBlocking {
        val rethrown = java.util.concurrent.CopyOnWriteArrayList<Throwable>()
        var recovered = 0
        val scope = CoroutineScope(
            SupervisorJob() + Dispatchers.Default + appScopeExceptionHandler(recover = { recovered++ }, rethrowFatal = { rethrown += it }),
        )
        scope.launch { throw OutOfMemoryError("x") }.join()
        assertEquals(1, rethrown.size)
        assertEquals(0, recovered)
        assertTrue(isFatal(LinkageError()))
        assertTrue(!isFatal(IllegalStateException()))
    }

    @Test fun lateResultsDoNotTouchTheClipboard() = runBlocking {
        val results = MutableSharedFlow<DictationResult>(extraBufferCapacity = 8)
        val copied = java.util.concurrent.CopyOnWriteArrayList<String>()
        val job = CoroutineScope(Dispatchers.Default).launch {
            copyDictateResults(results, sensitive = { false }, copy = { t, _ -> copied += t })
        }
        results.subscriptionCount.first { it > 0 }
        results.emit(DictationResult("r1", "late", RecordingSource.TILE, DictateActivity.SESSION_TAG, MAX_CLIPBOARD_DELAY_MS + 1))
        results.emit(DictationResult("r2", "fresh", RecordingSource.TILE, DictateActivity.SESSION_TAG, 1_000))
        while (copied.isEmpty()) yield()
        job.cancel()
        assertEquals(listOf("fresh"), copied.toList())
    }
}
