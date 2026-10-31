package ai.whisperio.android

import ai.whisperio.android.security.SecretCipher
import ai.whisperio.android.security.WrappedKeyStore
import java.security.KeyStoreException

/** In-memory wrapped-key store (shared by the audio encryption tests). */
class AudioMemKeys : WrappedKeyStore {
    var blob: ByteArray? = null
    override suspend fun read() = blob
    override suspend fun write(wrapped: ByteArray) { blob = wrapped }
    override suspend fun delete() { blob = null }
}

/** Keystore that cannot create or use keys. */
class AudioBrokenWrapper : SecretCipher {
    override fun encrypt(plain: ByteArray): ByteArray = throw KeyStoreException("keystore unavailable")
    override fun decrypt(blob: ByteArray): ByteArray = throw KeyStoreException("keystore unavailable")
}
