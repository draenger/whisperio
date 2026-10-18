package ai.whisperio.android.security

import ai.whisperio.core.ProviderId
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import java.security.KeyStore
import java.security.UnrecoverableKeyException
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * True only when the stored ciphertext can never be decrypted again (tampered/corrupt, key
 * invalidated or gone). Anything else (e.g. a transient Keystore/provider error) must not delete the key.
 */
internal fun isPermanentDecryptFailure(e: Throwable): Boolean =
    e is AEADBadTagException ||
        e is KeyPermanentlyInvalidatedException ||
        e is UnrecoverableKeyException ||
        e is IllegalArgumentException // bad base64 / truncated blob

/** Encrypt/decrypt seam so the store logic is testable without an Android Keystore (absent on the JVM). */
interface SecretCipher {
    /** Returns iv + ciphertext. */
    fun encrypt(plain: ByteArray): ByteArray

    /** Takes iv + ciphertext; throws on any failure (invalidated key, tampering, missing key). */
    fun decrypt(blob: ByteArray): ByteArray
}

/** AES-256-GCM with a non-exportable Android Keystore key (alias [ALIAS]). */
class AndroidKeystoreCipher(private val alias: String = ALIAS) : SecretCipher {
    override fun encrypt(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        return cipher.iv + cipher.doFinal(plain)
    }

    override fun decrypt(blob: ByteArray): ByteArray {
        require(blob.size > IV_BYTES) { "blob too short" }
        val key = loadKey() ?: throw UnrecoverableKeyException("keystore key missing")
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, blob, 0, IV_BYTES))
        return cipher.doFinal(blob, IV_BYTES, blob.size - IV_BYTES)
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun loadKey(): SecretKey? = keyStore().getKey(alias, null) as? SecretKey

    private fun getOrCreateKey(): SecretKey {
        loadKey()?.let { return it }
        val spec = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(false)
            .setRandomizedEncryptionRequired(true)
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply { init(spec) }
            .generateKey()
    }

    companion object {
        const val ALIAS = "whisperio.keys.v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_BYTES = 12
        private const val TAG_BITS = 128
    }
}

/**
 * Keys as base64(iv + ciphertext) in a private Preferences DataStore. A decrypt failure wipes that entry and reports
 * the provider as lost (CONTRACT 7.2). Never logs.
 */
class KeystoreSecretStore(
    private val store: DataStore<Preferences>,
    private val cipher: SecretCipher,
) : SecretStore {
    private val lostState = MutableStateFlow<Set<ProviderId>>(emptySet())
    override val lost: StateFlow<Set<ProviderId>> get() = lostState

    private fun keyFor(id: ProviderId) = stringPreferencesKey("secret_${id.wire}")

    override suspend fun get(id: ProviderId): String? {
        val raw = store.data.first()[keyFor(id)] ?: return null
        return try {
            String(cipher.decrypt(Base64.getDecoder().decode(raw)), Charsets.UTF_8)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (!isPermanentDecryptFailure(e)) return null // transient: keep the ciphertext
            // Wipe the unreadable ciphertext; never include it (or the key) in anything logged.
            store.edit { it.remove(keyFor(id)) }
            lostState.value = lostState.value + id
            null
        }
    }

    override suspend fun put(id: ProviderId, value: String) {
        val enc = Base64.getEncoder().encodeToString(cipher.encrypt(value.toByteArray(Charsets.UTF_8)))
        store.edit { it[keyFor(id)] = enc }
        lostState.value = lostState.value - id
    }

    override suspend fun remove(id: ProviderId) {
        store.edit { it.remove(keyFor(id)) }
        lostState.value = lostState.value - id
    }

    override suspend fun clear() {
        store.edit { it.clear() }
        lostState.value = emptySet()
    }

    override val configured: Flow<Set<ProviderId>> = store.data.map { prefs ->
        ProviderId.entries.filter { prefs.contains(keyFor(it)) }.toSet()
    }
}
