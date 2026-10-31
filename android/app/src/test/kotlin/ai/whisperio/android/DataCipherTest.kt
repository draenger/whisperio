package ai.whisperio.android

import ai.whisperio.android.security.DataCipher
import ai.whisperio.android.security.Decrypted
import ai.whisperio.android.security.SecretCipher
import ai.whisperio.android.security.WrappedKeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** AES-GCM stand-in for the Keystore; [broken] simulates a lost/invalidated Keystore key. */
private class FakeWrapper(var broken: Boolean = false) : SecretCipher {
    private val key = SecretKeySpec(ByteArray(32) { it.toByte() }, "AES")
    override fun encrypt(plain: ByteArray): ByteArray {
        val iv = ByteArray(12).also(SecureRandom()::nextBytes)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        return iv + c.doFinal(plain)
    }

    override fun decrypt(blob: ByteArray): ByteArray {
        if (broken) throw java.security.UnrecoverableKeyException("lost")
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, blob, 0, 12))
        return c.doFinal(blob, 12, blob.size - 12)
    }
}

private class MemKeys : WrappedKeyStore {
    @Volatile var blob: ByteArray? = null
    val writes = java.util.concurrent.atomic.AtomicInteger()
    override suspend fun read() = blob
    override suspend fun write(wrapped: ByteArray) { writes.incrementAndGet(); kotlinx.coroutines.yield(); blob = wrapped }
    override suspend fun delete() { blob = null }
}

class DataCipherTest {
    private fun cipher(w: FakeWrapper = FakeWrapper(), k: MemKeys = MemKeys()) = Triple(DataCipher(w, k), w, k)

    @Test fun textRoundTripAndPrefix() = runBlocking {
        val (c) = cipher()
        val sealed = c.sealText("dzień dobry, zażółć gęślą jaźń", "r1:transcript")
        assertTrue(DataCipher.isSealedText(sealed))
        assertFalse(sealed.contains("dobry"))
        assertEquals(Decrypted.Ok("dzień dobry, zażółć gęślą jaźń"), c.openText(sealed, "r1:transcript"))
    }

    @Test fun nonceIsFreshPerSeal() = runBlocking {
        val (c) = cipher()
        assertNotEquals(c.sealText("same"), c.sealText("same"))
    }

    @Test fun plaintextPassesThroughUntilMigrated() = runBlocking {
        val (c) = cipher()
        assertEquals(Decrypted.Ok("old plain row"), c.openText("old plain row"))
    }

    @Test fun movedCiphertextIsUnreadable() = runBlocking {
        val (c) = cipher()
        val sealed = c.sealText("secret", "r1:transcript")
        assertEquals(Decrypted.Unreadable, c.openText(sealed, "r2:transcript"))
    }

    @Test fun tamperedAndTruncatedAreUnreadableNotThrown() = runBlocking {
        val (c) = cipher()
        val blob = c.seal("payload".toByteArray())
        val flipped = blob.copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() }
        assertEquals(Decrypted.Unreadable, c.open(flipped))
        assertEquals(Decrypted.Unreadable, c.open(blob.copyOf(5)))
        assertEquals(Decrypted.Unreadable, c.open(ByteArray(0)))
        val badMagic = blob.copyOf().also { it[2] = 9 }
        assertEquals(Decrypted.Unreadable, c.open(badMagic))
    }

    @Test fun dekPersistsAcrossInstances() = runBlocking {
        val w = FakeWrapper()
        val k = MemKeys()
        val sealed = DataCipher(w, k).sealText("kept")
        assertEquals(Decrypted.Ok("kept"), DataCipher(w, k).openText(sealed))
    }

    @Test fun lostKeystoreKeyIsUnreadableAndDekIsNeverReplaced() = runBlocking {
        val w = FakeWrapper()
        val k = MemKeys()
        val sealed = DataCipher(w, k).sealText("kept")
        val wrappedBefore = k.blob!!.copyOf()
        w.broken = true
        val fresh = DataCipher(w, k)
        assertEquals(Decrypted.Unreadable, fresh.openText(sealed))
        // Encrypting must fail loudly rather than overwrite the wrapped key and orphan existing data.
        val threw = try { fresh.sealText("new"); false } catch (e: Exception) { true }
        assertTrue(threw)
        assertTrue(wrappedBefore.contentEquals(k.blob!!))
    }

    @Test fun shredMakesDataPermanentlyUnreadable() = runBlocking {
        val (c, _, k) = cipher()
        val sealed = c.sealText("gone soon")
        c.shred()
        assertTrue(k.blob == null)
        assertEquals(Decrypted.Unreadable, c.openText(sealed))
        // A new key after shred must not resurrect old data.
        c.sealText("again")
        assertEquals(Decrypted.Unreadable, c.openText(sealed))
    }

    @Test fun lookalikePlaintextIsNotCiphertext() = runBlocking {
        val (c) = cipher()
        for (text in listOf("WE1: hello world", "WE1:", "WE1:%%%not-base64", "WE1:AAAA")) {
            assertFalse(DataCipher.isSealedText(text))
            assertEquals(Decrypted.Ok(text), c.openText(text))
        }
        val sealed = c.sealText("WE1: hello world", "r1:t")
        assertTrue(DataCipher.isSealedText(sealed))
        assertEquals(Decrypted.Ok("WE1: hello world"), c.openText(sealed, "r1:t"))
    }

    @Test fun concurrentFirstSealsMintExactlyOneDek() = runBlocking {
        val (c, _, k) = cipher()
        val sealed = (1..16).map { i ->
            async(Dispatchers.Default) { i to c.sealText("text $i", "r$i") }
        }.awaitAll()
        sealed.forEach { (i, s) -> assertEquals(Decrypted.Ok("text $i"), c.openText(s, "r$i")) }
        assertEquals(1, k.writes.get())
        // A fresh instance over the same store (cold cache) reads them all too.
        val cold = DataCipher(FakeWrapper(), k)
        sealed.forEach { (i, s) -> assertEquals(Decrypted.Ok("text $i"), cold.openText(s, "r$i")) }
    }
}
