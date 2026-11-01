package ai.whisperio.android

import ai.whisperio.android.history.AppDatabase
import ai.whisperio.android.history.EncryptingHistoryStore
import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.history.RoomHistoryStore
import ai.whisperio.android.history.hasSealedData
import ai.whisperio.android.security.DataCipher
import ai.whisperio.android.security.DataKeyMissingException
import ai.whisperio.android.security.SecretCipher
import ai.whisperio.android.security.WrappedKeyStore
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.security.KeyStoreException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
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

/** AES-GCM stand-in for the Keystore; [failing] makes it throw like a broken Keystore. */
private class HardenWrapper : SecretCipher {
    @Volatile var failing = false
    private val key = SecretKeySpec(ByteArray(32) { 9 }, "AES")
    override fun encrypt(plain: ByteArray): ByteArray {
        if (failing) throw KeyStoreException("keystore unavailable")
        val iv = ByteArray(12) { it.toByte() }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        return iv + c.doFinal(plain)
    }

    override fun decrypt(blob: ByteArray): ByteArray {
        if (failing) throw KeyStoreException("keystore unavailable")
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, blob, 0, 12))
        return c.doFinal(blob, 12, blob.size - 12)
    }
}

private class HardenKeys : WrappedKeyStore {
    @Volatile var blob: ByteArray? = null
    override suspend fun read() = blob
    override suspend fun write(wrapped: ByteArray) { blob = wrapped }
    override suspend fun delete() { blob = null }
}

/** Review follow-ups for #20-#23: pending-encryption state and the "never mint a new DEK over sealed data" guard. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EncryptHardeningTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var db: AppDatabase
    private val wrapper = HardenWrapper()
    private val keys = HardenKeys()
    private var on = true

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
    }

    @After fun tearDown() = db.close()

    private fun storeFor(cipher: DataCipher) = EncryptingHistoryStore(
        RoomHistoryStore(db.recordings(), File(tmp.root, "r").also { it.mkdirs() }),
        db.recordings(), cipher, { on },
    )

    private fun row(id: String, text: String?) = Recording(
        id = id, createdAt = 1, durationMs = 1, status = RecordingStatus.DONE, provider = "openai", model = "m",
        language = "pl", transcript = text, source = RecordingSource.APP,
    )

    private suspend fun rawText(id: String) = db.recordings().get(id)!!.transcript

    @Test fun keystoreFailureWhileOnWritesPlainCountsPendingAndMaintenanceSealsIt() = runBlocking {
        val store = storeFor(DataCipher(wrapper, keys))
        assertEquals(0, store.pendingEncryption.value)

        wrapper.failing = true
        store.upsert(row("a", "hello"))

        assertEquals("fail-soft: the dictation is not lost", "hello", rawText("a"))
        assertEquals(1, store.pendingEncryption.value)

        wrapper.failing = false
        val report = store.migrate(true) // what runMaintenance does when the key is usable again

        assertEquals(1, report.converted)
        assertTrue(DataCipher.isSealedText(rawText("a")!!))
        assertEquals(0, store.pendingEncryption.value)
        assertEquals("hello", store.get("a")!!.transcript)
    }

    @Test fun pendingIsZeroWhileSwitchIsOff() = runBlocking {
        on = false
        val store = storeFor(DataCipher(wrapper, keys))
        store.upsert(row("a", "plain by design"))
        store.refreshPending()
        assertEquals(0, store.pendingEncryption.value)
    }

    @Test fun missingDataKeyWithSealedRowsDoesNotMintANewKeyAndIsLocked() = runBlocking {
        val first = DataCipher(wrapper, keys)
        storeFor(first).upsert(row("a", "secret"))
        assertTrue(DataCipher.isSealedText(rawText("a")!!))

        keys.blob = null // data_key gone (cleared app data of the DataStore, restore, ...)
        val probe: suspend () -> Boolean = { db.recordings().sealedCandidates().any { it.hasSealedData() } }
        val cipher = DataCipher(wrapper, keys, sealedDataExists = probe)
        assertFalse(cipher.locked.value)

        try {
            cipher.sealText("new")
            fail("must refuse to mint a new DEK while sealed data exists")
        } catch (e: DataKeyMissingException) {
            // expected
        }
        assertNull("no new wrapped key was written", keys.blob)
        assertTrue(cipher.locked.value)

        val store = storeFor(cipher)
        store.upsert(row("b", "after loss"))
        assertEquals("fail-soft plaintext, not a row sealed with a new key", "after loss", rawText("b"))
        assertNull(keys.blob)
        assertEquals(1, store.pendingEncryption.value)
        assertNull("old row stays unreadable, never garbled", store.get("a")!!.transcript)
    }

    @Test fun firstEverSealStillMintsAKeyWhenNothingIsSealed() = runBlocking {
        val probe: suspend () -> Boolean = { db.recordings().sealedCandidates().any { it.hasSealedData() } }
        val cipher = DataCipher(wrapper, keys, sealedDataExists = probe)
        storeFor(cipher).upsert(row("a", "first"))
        assertTrue(DataCipher.isSealedText(rawText("a")!!))
        assertFalse(cipher.locked.value)
    }
}

/** The new/changed strings exist in the default (EN) locale. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EncryptStringsEnTest {
    @Test fun stringsPresent() {
        val r = ApplicationProvider.getApplicationContext<android.app.Application>().resources
        for (id in STRINGS) assertTrue(r.getResourceName(id), r.getString(id).isNotBlank())
        assertTrue(r.getQuantityString(R.plurals.settings_encrypt_pending, 1, 1).contains("1"))
        assertTrue(r.getQuantityString(R.plurals.settings_encrypt_pending, 5, 5).contains("5"))
        assertTrue(r.getString(R.string.settings_encrypt_hint).contains("flash"))
    }

    companion object {
        val STRINGS = intArrayOf(
            R.string.settings_encrypt_hint, R.string.settings_encrypt_status_on, R.string.settings_encrypt_locked,
            R.string.history_unreadable,
        )
    }
}

/** ...and in Polish (translated, not falling back to EN), including every plural form. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "pl")
class EncryptStringsPlTest {
    @Test fun stringsTranslated() {
        val ctx = ApplicationProvider.getApplicationContext<android.app.Application>()
        val r = ctx.resources
        val en = android.content.res.Configuration(r.configuration).apply { setLocale(java.util.Locale.ENGLISH) }
        val enRes = ctx.createConfigurationContext(en).resources
        for (id in EncryptStringsEnTest.STRINGS) {
            assertTrue(r.getResourceName(id), r.getString(id).isNotBlank())
            assertNotEquals(r.getResourceName(id), enRes.getString(id), r.getString(id))
        }
        for (n in intArrayOf(1, 2, 5, 22)) {
            val pl = r.getQuantityString(R.plurals.settings_encrypt_pending, n, n)
            assertTrue(pl.contains(n.toString()))
            assertNotEquals(enRes.getQuantityString(R.plurals.settings_encrypt_pending, n, n), pl)
        }
    }
}
