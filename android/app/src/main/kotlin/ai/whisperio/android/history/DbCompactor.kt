package ai.whisperio.android.history

import android.util.Log
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Removes plaintext that the SQLite file keeps after rows are rewritten as sealed values (#21 follow-up): the WAL
 * still holds the old pages and freed pages keep their bytes until overwritten. Logs never contain row content.
 * Callers hold the AppGraph maintenance lock; this class does no locking of its own.
 */
open class DbCompactor(
    private val db: RoomDatabase,
    private val onOpen: SecureDeleteCallback = SecureDeleteCallback(),
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    /**
     * Folds the WAL into the main file and truncates it, then VACUUM rewrites the file without free pages.
     * Returns false (never throws, except cancellation) when either step fails, e.g. disk full or database busy.
     */
    open suspend fun compact(): Boolean = withContext(io) {
        try {
            val sdb = db.openHelper.writableDatabase
            if (!checkpointed(sdb)) return@withContext false
            // VACUUM cannot run inside a transaction; none is open here.
            sdb.execSQL("VACUUM")
            // The VACUUM itself was logged to the WAL: truncate it too so the rewritten pages are the only copy.
            checkpointed(sdb)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "database compaction failed: ${e.javaClass.simpleName}")
            false
        }
    }

    /** wal_checkpoint returns a row (busy, log, checkpointed): column 0 != 0 means it was blocked and did not finish. */
    private fun checkpointed(sdb: SupportSQLiteDatabase): Boolean =
        sdb.query("PRAGMA wal_checkpoint(TRUNCATE)").use { !it.moveToFirst() || it.getInt(0) == 0 }

    /**
     * Turns `PRAGMA secure_delete` ON for this connection and for later ones ([SecureDeleteCallback]). There is
     * deliberately no OFF: Android's SQLite is usually built with secure_delete ON, and we must not weaken it.
     */
    open suspend fun enableSecureDelete() {
        onOpen.wanted.set(true)
        withContext(io) {
            try {
                applySecureDelete(db.openHelper.writableDatabase)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "secure_delete not applied: ${e.javaClass.simpleName}")
            }
        }
    }

    /** Current value of the pragma on the write connection (1 = ON); for tests and diagnostics. */
    open suspend fun secureDeleteValue(): Int = withContext(io) {
        db.openHelper.writableDatabase.query("PRAGMA secure_delete").use { if (it.moveToFirst()) it.getInt(0) else -1 }
    }

}

private const val TAG = "DbCompactor"

private fun applySecureDelete(sdb: SupportSQLiteDatabase) {
    // The pragma returns a row, so it goes through query(), not execSQL().
    sdb.query("PRAGMA secure_delete=ON").use { it.moveToFirst() }
}

/**
 * Applies `secure_delete` whenever Room opens a connection. [wanted] follows the "Encrypt history" setting; install
 * with `Room.databaseBuilder(...).addCallback(callback)` and hand the same instance to [DbCompactor].
 */
class SecureDeleteCallback : RoomDatabase.Callback() {
    val wanted = AtomicBoolean(false)

    override fun onOpen(db: SupportSQLiteDatabase) {
        try {
            if (wanted.get()) applySecureDelete(db)
        } catch (e: Exception) {
            Log.w(TAG, "secure_delete not applied on open: ${e.javaClass.simpleName}")
        }
    }
}
