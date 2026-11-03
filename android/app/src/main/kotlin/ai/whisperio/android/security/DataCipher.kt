package ai.whisperio.android.security

import java.security.GeneralSecurityException
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Where the wrapped (Keystore-encrypted) data key lives. Deleting it is the crypto-shred. */
interface WrappedKeyStore {
    suspend fun read(): ByteArray?

    suspend fun write(wrapped: ByteArray)

    suspend fun delete()
}

/** Outcome of a decrypt: a row that cannot be read is reported, never thrown into the UI. */
sealed interface Decrypted<out T> {
    data class Ok<T>(val value: T) : Decrypted<T>

    /** Wrong key, tampering, truncated or unknown-version data. Callers show "unreadable". */
    data object Unreadable : Decrypted<Nothing>
}

/**
 * Field/file encryption for the opt-in "Encrypt history and recordings" setting (docs/design/opt-in-encryption.md).
 *
 * A random 256-bit data key (DEK) is wrapped with the Keystore-backed [SecretCipher] and persisted through
 * [WrappedKeyStore]. Data is sealed with AES-256-GCM; the envelope is `0x57 0x45 0x01 | nonce(12) | ciphertext+tag`
 * (`WE1`), and the text form is `WE1:` + base64 of that. [aad] binds a value to its place (e.g. recording id + field),
 * so moving a ciphertext to another row fails to decrypt. Never logs.
 */
class DataCipher(
    private val wrapper: SecretCipher,
    private val keys: WrappedKeyStore,
    private val random: SecureRandom = SecureRandom(),
) {
    @Volatile private var cachedDek: ByteArray? = null

    /** Serializes key acquisition and shred so two first seals cannot each mint a DEK. */
    private val keyLock = Mutex()

    /** Returns the DEK, creating and persisting a wrapped one if none exists yet. */
    private suspend fun dekForEncrypt(): ByteArray {
        cachedDek?.let { return it }
        return keyLock.withLock {
            cachedDek?.let { return@withLock it }
            val existing = keys.read()
            if (existing != null) {
                // An existing but unwrappable key must NOT be silently replaced: that would orphan all data.
                return@withLock wrapper.decrypt(existing).also { cachedDek = it }
            }
            val fresh = ByteArray(DEK_BYTES).also(random::nextBytes)
            keys.write(wrapper.encrypt(fresh))
            cachedDek = fresh
            fresh
        }
    }

    /** Null when there is no key or it cannot be unwrapped (lost Keystore key). */
    private suspend fun dekForDecrypt(): ByteArray? {
        cachedDek?.let { return it }
        return keyLock.withLock {
            cachedDek?.let { return@withLock it }
            val wrapped = keys.read() ?: return@withLock null
            try {
                wrapper.decrypt(wrapped).also { cachedDek = it }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                null
            }
        }
    }

    suspend fun hasKey(): Boolean = keys.read() != null

    suspend fun seal(plain: ByteArray, aad: ByteArray = EMPTY): ByteArray {
        val dek = dekForEncrypt()
        val nonce = ByteArray(NONCE_BYTES).also(random::nextBytes)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(dek, "AES"), GCMParameterSpec(TAG_BITS, nonce))
        cipher.updateAAD(aad)
        return MAGIC + nonce + cipher.doFinal(plain)
    }

    suspend fun open(blob: ByteArray, aad: ByteArray = EMPTY): Decrypted<ByteArray> {
        if (blob.size < MAGIC.size + NONCE_BYTES + TAG_BITS / 8) return Decrypted.Unreadable
        if (!blob.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) return Decrypted.Unreadable
        val dek = dekForDecrypt() ?: return Decrypted.Unreadable
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                SecretKeySpec(dek, "AES"),
                GCMParameterSpec(TAG_BITS, blob, MAGIC.size, NONCE_BYTES),
            )
            cipher.updateAAD(aad)
            val start = MAGIC.size + NONCE_BYTES
            Decrypted.Ok(cipher.doFinal(blob, start, blob.size - start))
        } catch (e: GeneralSecurityException) {
            Decrypted.Unreadable
        }
    }

    suspend fun sealText(plain: String, aad: String = ""): String =
        TEXT_PREFIX + Base64.getEncoder().encodeToString(seal(plain.toByteArray(Charsets.UTF_8), aad.toByteArray()))

    /**
     * Text that is not strictly a sealed envelope (see [isSealedText]) is plaintext (not yet migrated) and is
     * returned as is, so a user's own "WE1: notes" is never mistaken for ciphertext.
     */
    suspend fun openText(stored: String, aad: String = ""): Decrypted<String> {
        val blob = sealedBlobOrNull(stored) ?: return Decrypted.Ok(stored)
        return when (val r = open(blob, aad.toByteArray())) {
            is Decrypted.Ok -> Decrypted.Ok(String(r.value, Charsets.UTF_8))
            Decrypted.Unreadable -> Decrypted.Unreadable
        }
    }

    /** Crypto-shred: destroy the wrapped key first; everything sealed with it is gone for good. */
    suspend fun shred() {
        keyLock.withLock {
            cachedDek?.fill(0)
            cachedDek = null
            keys.delete()
        }
    }

    companion object {
        const val TEXT_PREFIX = "WE1:"

        /**
         * Strict: the [TEXT_PREFIX], then valid Base64 whose bytes start with the envelope magic and are at least
         * magic + nonce + tag long. Anything else (even starting with "WE1:") is plain user text.
         */
        fun isSealedText(s: String): Boolean = sealedBlobOrNull(s) != null

        private fun sealedBlobOrNull(s: String): ByteArray? {
            if (!s.startsWith(TEXT_PREFIX)) return null
            val blob = try {
                Base64.getDecoder().decode(s.substring(TEXT_PREFIX.length))
            } catch (e: IllegalArgumentException) {
                return null
            }
            if (blob.size < MAGIC.size + NONCE_BYTES + TAG_BITS / 8) return null
            if (!blob.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) return null
            return blob
        }

        private val MAGIC = byteArrayOf(0x57, 0x45, 0x01)
        private val EMPTY = ByteArray(0)
        private const val DEK_BYTES = 32
        private const val NONCE_BYTES = 12
        private const val TAG_BITS = 128
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
