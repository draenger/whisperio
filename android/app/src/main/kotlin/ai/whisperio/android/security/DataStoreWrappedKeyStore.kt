package ai.whisperio.android.security

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import java.util.Base64
import kotlinx.coroutines.flow.first

/**
 * Keeps the Keystore-wrapped data key in its own Preferences DataStore (`data_key`), separate from the provider
 * API keys, so "Erase all" can shred it first and turning provider keys over never touches history. Holds only
 * ciphertext (the DEK wrapped by the non-exportable Keystore key [DATA_KEK_ALIAS]); never logged.
 */
class DataStoreWrappedKeyStore(private val store: DataStore<Preferences>) : WrappedKeyStore {
    override suspend fun read(): ByteArray? =
        store.data.first()[KEY]?.let {
            try {
                Base64.getDecoder().decode(it)
            } catch (e: IllegalArgumentException) {
                // Corrupt entry: report "a key exists but cannot be unwrapped" (empty blob), never "no key", so
                // DataCipher does not silently mint a new DEK over it.
                ByteArray(0)
            }
        }

    override suspend fun write(wrapped: ByteArray) {
        store.edit { it[KEY] = Base64.getEncoder().encodeToString(wrapped) }
    }

    override suspend fun delete() {
        store.edit { it.remove(KEY) }
    }

    companion object {
        /** Keystore alias of the key-encryption key that wraps the history DEK (design doc 3.1). */
        const val DATA_KEK_ALIAS = "whisperio.data.kek"
        private val KEY = stringPreferencesKey("wrapped_dek_v1")
    }
}
