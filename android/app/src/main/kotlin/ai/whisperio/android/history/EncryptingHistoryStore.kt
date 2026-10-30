package ai.whisperio.android.history

import ai.whisperio.android.security.DataCipher
import ai.whisperio.android.security.Decrypted
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/** Result of [EncryptingHistoryStore.migrate]: rows rewritten, and rows left as they were because they cannot be read. */
data class MigrationReport(val converted: Int, val unreadable: Int)

/**
 * Opt-in field-level encryption of transcript and error (docs/design/opt-in-encryption.md). Metadata stays plain.
 * Every stored value is self-describing (`WE1:` prefix = sealed), so a row is always either plaintext or sealed:
 * a migration killed half-way leaves a readable mix, never a row that needs a separate marker. Reads decrypt
 * whatever they find regardless of [enabled]; [enabled] only decides what new writes look like.
 */
class EncryptingHistoryStore(
    private val inner: HistoryStore,
    private val dao: RecordingDao,
    private val cipher: DataCipher,
    private val enabled: suspend () -> Boolean,
) : HistoryStore by inner {
    override fun observeAll(): Flow<List<Recording>> = inner.observeAll().map { rows -> rows.map { reveal(it) } }
    override fun observeRecent(limit: Int): Flow<List<Recording>> =
        inner.observeRecent(limit).map { rows -> rows.map { reveal(it) } }
    override fun observe(id: String): Flow<Recording?> = inner.observe(id).map { it?.let { r -> reveal(r) } }
    override suspend fun get(id: String): Recording? = inner.get(id)?.let { reveal(it) }

    override suspend fun upsert(recording: Recording) {
        inner.upsert(if (enabled()) (tryConceal(recording) ?: recording) else recording)
    }

    /** Rewrites every row to sealed ([encrypt]=true) or plain form. One row at a time, each verified before it is saved. */
    suspend fun migrate(encrypt: Boolean): MigrationReport {
        var converted = 0
        var unreadable = 0
        for (raw in dao.observeAll().first()) {
            val target = if (encrypt) tryConceal(raw) else tryReveal(raw)
            when {
                target == null -> unreadable++
                target != raw -> {
                    dao.upsert(target)
                    converted++
                }
            }
        }
        return MigrationReport(converted, unreadable)
    }

    /** Null only if the sealed value could not be read back (never save a row we cannot decrypt). */
    private suspend fun tryConceal(r: Recording): Recording? {
        val t = seal(r.transcript, r.id, TRANSCRIPT) ?: return null
        val e = seal(r.error, r.id, ERROR) ?: return null
        return r.copy(transcript = t.value, error = e.value)
    }

    private data class Field(val value: String?)

    private suspend fun seal(plain: String?, id: String, field: String): Field? {
        if (plain == null || DataCipher.isSealedText(plain)) return Field(plain)
        val sealed = cipher.sealText(plain, "$id:$field")
        return if (cipher.openText(sealed, "$id:$field") == Decrypted.Ok(plain)) Field(sealed) else null
    }

    private suspend fun tryReveal(r: Recording): Recording? {
        val t = unseal(r.transcript, r.id, TRANSCRIPT) ?: return null
        val e = unseal(r.error, r.id, ERROR) ?: return null
        return r.copy(transcript = t.value, error = e.value)
    }

    private suspend fun unseal(stored: String?, id: String, field: String): Field? {
        if (stored == null) return Field(null)
        return when (val d = cipher.openText(stored, "$id:$field")) {
            is Decrypted.Ok -> Field(d.value)
            Decrypted.Unreadable -> null
        }
    }

    /** For display: unreadable data becomes a null transcript plus [UNREADABLE], never an exception. */
    private suspend fun reveal(r: Recording): Recording {
        val sealed = r.transcript?.let(DataCipher::isSealedText) == true || r.error?.let(DataCipher::isSealedText) == true
        if (!sealed) return r
        return tryReveal(r) ?: r.copy(
            transcript = r.transcript?.takeUnless(DataCipher::isSealedText),
            error = UNREADABLE,
        )
    }

    companion object {
        const val UNREADABLE = "Encrypted data cannot be read"
        private const val TRANSCRIPT = "transcript"
        private const val ERROR = "error"
    }
}
