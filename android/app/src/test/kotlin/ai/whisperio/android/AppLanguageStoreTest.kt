package ai.whisperio.android

import ai.whisperio.android.settings.AppLanguageStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AppLanguageStoreTest {
    @get:Rule val tmp = TemporaryFolder()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val store by lazy {
        AppLanguageStore(PreferenceDataStoreFactory.create(scope = scope) { File(tmp.root, "app_languages.preferences_pb") })
    }

    @After fun tearDown() { scope.cancel() }

    @Test fun rememberThenReadBack() = runBlocking {
        store.remember("com.a", "pl")
        assertEquals("pl", store.languageFor("com.a"))
        assertNull(store.languageFor("com.b"))
        assertEquals(1, store.count.first())
    }

    @Test fun readingTouchesTheEntry() = runBlocking {
        store.remember("com.a", "pl")
        store.remember("com.b", "en")
        store.languageFor("com.a")
        assertEquals(listOf("com.a", "com.b"), store.snapshot().packages)
    }

    @Test fun capsAtTwoHundredEntries() = runBlocking {
        for (i in 1..205) store.remember("com.app$i", "pl")
        assertEquals(200, store.count.first())
        assertNull(store.languageFor("com.app1"))
        assertEquals("pl", store.languageFor("com.app205"))
    }

    @Test fun clearDeletesTheMap() = runBlocking {
        store.remember("com.a", "pl")
        store.clear()
        assertEquals(0, store.count.first())
        assertNull(store.languageFor("com.a"))
    }
}
