package ai.whisperio.android.history

import java.io.File
import kotlinx.coroutines.flow.Flow

/** Persistence port used by the dictation pipeline and UI; the Room implementation is [RoomHistoryStore]. */
interface HistoryStore {
    fun observeAll(): Flow<List<Recording>>
    fun observeRecent(limit: Int): Flow<List<Recording>>
    fun observe(id: String): Flow<Recording?>
    suspend fun get(id: String): Recording?
    suspend fun upsert(recording: Recording)
    suspend fun setInserted(id: String, inserted: Boolean)

    /** CONTRACT-1.2 F3: sets (or with null clears) one row's category without touching any other column. */
    suspend fun setCategory(id: String, category: String?)

    /** CONTRACT-1.2 F3: every row with [categoryId] becomes uncategorised (a custom category was deleted). */
    suspend fun clearCategory(categoryId: String)

    /** Deletes the row and its audio file. */
    suspend fun delete(id: String)

    /** rows in recording/transcribing become failed("Interrupted"); returns how many. */
    suspend fun sweepInterrupted(excludeId: String? = null): Int

    /** Auto-delete by age: removes rows (and audio) created before [cutoffEpochMs]. */
    suspend fun deleteOlderThan(cutoffEpochMs: Long): Int

    /**
     * Deletes files in the recordings dir that no row references (e.g. a no-history clip left by process death),
     * except [exclude] (the file being recorded right now). Returns how many were removed.
     */
    suspend fun sweepOrphanAudio(exclude: File?): Int

    /**
     * Deletes every audio file but keeps the transcripts. The row [keepId] and its file (the recording in progress) are left
     * untouched; [keepFile] is the no-history active file, which has no row.
     */
    suspend fun deleteAllAudio(keepId: String? = null, keepFile: File? = null)

    /** Deletes every row and every audio file. */
    suspend fun clear()

    companion object {
        const val INTERRUPTED = "Interrupted"
    }
}

class RoomHistoryStore(
    private val dao: RecordingDao,
    private val recordingsDir: File,
) : HistoryStore {
    override fun observeAll() = dao.observeAll()
    override fun observeRecent(limit: Int) = dao.observeRecent(limit)
    override fun observe(id: String) = dao.observe(id)
    override suspend fun get(id: String) = dao.get(id)
    override suspend fun upsert(recording: Recording) = dao.upsert(recording)
    override suspend fun setInserted(id: String, inserted: Boolean) = dao.setInserted(id, inserted)
    override suspend fun setCategory(id: String, category: String?) = dao.setCategory(id, category)
    override suspend fun clearCategory(categoryId: String) { dao.clearCategory(categoryId) }

    override suspend fun delete(id: String) {
        dao.get(id)?.audioPath?.let { File(it).delete() }
        dao.delete(id)
    }

    override suspend fun sweepInterrupted(excludeId: String?): Int =
        dao.sweepInterrupted(HistoryStore.INTERRUPTED, excludeId ?: "")

    override suspend fun deleteOlderThan(cutoffEpochMs: Long): Int {
        val old = dao.olderThan(cutoffEpochMs)
        old.forEach { r ->
            r.audioPath?.let { File(it).delete() }
            dao.delete(r.id)
        }
        return old.size
    }

    override suspend fun sweepOrphanAudio(exclude: File?): Int {
        val referenced = dao.withAudio().mapNotNull { it.audioPath }.map { File(it).absoluteFile }.toSet()
        val skip = exclude?.absoluteFile
        var n = 0
        recordingsDir.listFiles()?.forEach { f ->
            if (f.isFile && f.absoluteFile !in referenced && f.absoluteFile != skip && f.delete()) n++
        }
        return n
    }

    override suspend fun deleteAllAudio(keepId: String?, keepFile: File?) {
        val keep = keepFile?.absoluteFile
        dao.withAudio().filter { it.id != keepId }.forEach { File(it.audioPath!!).delete() }
        if (keepId == null) dao.clearAudioPaths() else dao.clearAudioPathsExcept(keepId)
        val keepRow = keepId?.let { dao.get(it)?.audioPath }?.let { File(it).absoluteFile }
        recordingsDir.listFiles()?.forEach { if (it.absoluteFile != keep && it.absoluteFile != keepRow) it.delete() }
    }

    override suspend fun clear() {
        dao.deleteAll()
        recordingsDir.listFiles()?.forEach { it.delete() }
    }
}
