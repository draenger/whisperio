package ai.whisperio.android

import ai.whisperio.android.security.InMemorySecretStore
import ai.whisperio.android.security.KeystoreSecretStore
import ai.whisperio.android.security.SecretStore
import ai.whisperio.core.ProviderId
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Behaviour every [SecretStore] must have; run against both implementations. */
abstract class SecretStoreContract {
    abstract fun create(): SecretStore

    @Test fun putGetRemove() = runBlocking {
        val s = create()
        assertNull(s.get(ProviderId.OPENAI))
        s.put(ProviderId.OPENAI, "sk-secret")
        assertEquals("sk-secret", s.get(ProviderId.OPENAI))
        assertEquals(setOf(ProviderId.OPENAI), s.configured.first())
        s.remove(ProviderId.OPENAI)
        assertNull(s.get(ProviderId.OPENAI))
        assertTrue(s.configured.first().isEmpty())
    }

    @Test fun keysAreIndependentPerProvider() = runBlocking {
        val s = create()
        s.put(ProviderId.OPENAI, "a"); s.put(ProviderId.GROQ, "b")
        assertEquals("a", s.get(ProviderId.OPENAI))
        assertEquals("b", s.get(ProviderId.GROQ))
        s.remove(ProviderId.OPENAI)
        assertEquals("b", s.get(ProviderId.GROQ))
    }

    @Test fun putReplacesAndClearWipesAll() = runBlocking {
        val s = create()
        s.put(ProviderId.OPENAI, "old"); s.put(ProviderId.OPENAI, "new")
        assertEquals("new", s.get(ProviderId.OPENAI))
        s.put(ProviderId.GROQ, "x")
        s.clear()
        assertNull(s.get(ProviderId.OPENAI))
        assertNull(s.get(ProviderId.GROQ))
        assertTrue(s.lost.value.isEmpty())
    }

    @Test fun unicodeAndLongValuesSurvive() = runBlocking {
        val s = create()
        val v = "sk-" + "ząż".repeat(200)
        s.put(ProviderId.MISTRAL, v)
        assertEquals(v, s.get(ProviderId.MISTRAL))
    }
}

class InMemorySecretStoreTest : SecretStoreContract() {
    override fun create(): SecretStore = InMemorySecretStore()
}

class KeystoreSecretStoreTest : SecretStoreContract() {
    @get:Rule val tmp = TemporaryFolder()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val cipher = TestCipher()

    @After fun tearDown() = scope.cancel()

    private var n = 0
    private fun store() = KeystoreSecretStore(
        PreferenceDataStoreFactory.create(scope = scope) { File(tmp.root, "secrets${n++}.preferences_pb") },
        cipher,
    )

    override fun create(): SecretStore = store()

    @Test fun decryptFailureWipesEntryReportsLostAndReturnsNull() = runBlocking {
        val s = store()
        s.put(ProviderId.OPENAI, "sk-secret")
        s.put(ProviderId.GROQ, "gsk-other")

        cipher.fail = true // Keystore key invalidated
        assertNull(s.get(ProviderId.OPENAI))
        assertEquals(setOf(ProviderId.OPENAI), s.lost.value)

        cipher.fail = false // even a working cipher finds nothing: the ciphertext was wiped
        assertNull(s.get(ProviderId.OPENAI))
        assertFalse(ProviderId.OPENAI in s.configured.first())
        assertEquals("gsk-other", s.get(ProviderId.GROQ))
    }

    @Test fun pastingAgainClearsTheLostFlag() = runBlocking {
        val s = store()
        s.put(ProviderId.OPENAI, "old")
        cipher.fail = true
        s.get(ProviderId.OPENAI)
        cipher.fail = false
        s.put(ProviderId.OPENAI, "fresh")
        assertTrue(s.lost.value.isEmpty())
        assertEquals("fresh", s.get(ProviderId.OPENAI))
    }

    @Test fun storedValueIsNotPlaintext() = runBlocking {
        val file = File(tmp.root, "plain.preferences_pb")
        val s = KeystoreSecretStore(PreferenceDataStoreFactory.create(scope = scope) { file }, cipher)
        s.put(ProviderId.OPENAI, "sk-PLAINTEXT-MARKER")
        assertFalse(String(file.readBytes(), Charsets.ISO_8859_1).contains("sk-PLAINTEXT-MARKER"))
    }
}
