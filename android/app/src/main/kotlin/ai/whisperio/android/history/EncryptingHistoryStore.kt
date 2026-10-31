package ai.whisperio.android.history

import ai.whisperio.android.security.DataCipher
import ai.whisperio.android.security.Decrypted
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * Result of a migration: rows rewritten, and rows left as they were (cannot be read, or the key failed). The audio
 * counters count kept clips converted to / from `.wea` and clips left as they were (unreadable or key failed).
 */
data class MigrationReport(val converted: Int, val unreadable: Int, val audioConverted: Int = 0, val audioUnreadable: Int = 0)

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
        val kept = keepUnreadable(recording)
        inner.upsert(if (enabled()) (tryConceal(kept) ?: kept) else kept)
    }

    /**
     * [reveal] hands out an unreadable row with a null transcript / [UNREADABLE] error, and callers write such rows
     * back after a status change. If the stored value is sealed and does not open with the current key, and the
     * incoming value is only that placeholder, keep the stored ciphertext: it may be readable again once the
     * Keystore recovers. A real new value always wins. (An incoming null error is a legitimate "cleared", so only
     * the sentinel protects the error field.)
     */
    private suspend fun keepUnreadable(incoming: Recording): Recording {
        val stored = dao.get(incoming.id) ?: return incoming
        val keepTranscript = isStoredUnreadable(stored.transcript, stored.id, TRANSCRIPT) &&
            (incoming.transcript == null || incoming.transcript == UNREADABLE)
        val keepError = isStoredUnreadable(stored.error, stored.id, ERROR) && incoming.error == UNREADABLE
        if (!keepTranscript && !keepError) return incoming
        return incoming.copy(
            transcript = if (keepTranscript) stored.transcript else incoming.transcript,
            error = if (keepError) stored.error else incoming.error,
        )
    }

    private suspend fun isStoredUnreadable(stored: String?, id: String, field: String): Boolean =
        stored != null && DataCipher.isSealedText(stored) &&
            cipher.openText(stored, "$id:$field") == Decrypted.Unreadable

    /**
     * Rewrites every row to sealed ([encrypt]=true) or plain form. One row at a time, each verified before it is
     * saved, and saved through [RecordingDao.swapText] so only transcript/error change and a row written
     * concurrently by dictation is skipped (it is then written in the right form by [upsert] anyway; a later run
     * picks up whatever is left).
     */
    suspend fun migrate(encrypt: Boolean): MigrationReport {
        var converted = 0
        var unreadable = 0
        for (raw in dao.observeAll().first()) {
            val target = if (encrypt) tryConceal(raw) else tryReveal(raw)
            when {
                target == null -> unreadable++
                target != raw -> {
                    val n = dao.swapText(raw.id, raw.transcript, raw.error, target.transcript, target.error)
                    if (n > 0) converted++
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
        // A Keystore failure must not lose the row being written: null keeps it as it is (plaintext on write,
        // untouched in a migration), and the next maintenance run seals it once the key works again.
        val sealed = try {
            cipher.sealText(plain, "$id:$field")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return null
        }
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
