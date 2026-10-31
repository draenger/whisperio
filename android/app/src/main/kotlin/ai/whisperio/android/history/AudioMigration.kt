package ai.whisperio.android.history

import ai.whisperio.android.security.AudioCipher
import java.io.File
import kotlinx.coroutines.CancellationException

/** Kept clips converted, and clips left as they were (cannot be encrypted/decrypted right now). */
data class AudioMigrationReport(val converted: Int, val unreadable: Int)

/**
 * Converts kept audio clips when the "Encrypt history and recordings" switch changes (design doc 3.2): `<id>.m4a`
 * to `<id>.m4a.wea` or back. One clip at a time, and never in a way that can lose audio: the converted file is
 * fully written and verified first, the row is then re-pointed with [RecordingDao.swapAudioPath] (compare-and-swap),
 * and only if that took effect is the old file deleted. If the row changed meanwhile the converted file is the one
 * removed. A run killed half-way leaves rows that each still point at an existing, readable clip; the next run
 * finishes the rest, and [HistoryStore.sweepOrphanAudio] removes the unreferenced half-converted leftovers.
 */
class AudioMigration(private val dao: RecordingDao, private val cipher: AudioCipher) {
    /** [skipId] = the recording being recorded/transcribed right now (its file is still in use). */
    suspend fun migrate(encrypt: Boolean, skipId: String?): AudioMigrationReport {
        var converted = 0
        var unreadable = 0
        for (row in dao.withAudio()) {
            if (row.id == skipId) continue
            val path = row.audioPath ?: continue
            val src = File(path)
            val dest = when {
                encrypt && path.endsWith(".m4a") -> AudioCipher.encryptedFor(src)
                !encrypt && AudioCipher.isEncrypted(path) -> AudioCipher.plainFor(src)
                else -> continue // already in the target form (or not one of ours)
            }
            if (!src.exists()) continue
            try {
                if (encrypt) cipher.encryptFile(src, dest, row.id) else cipher.decryptToFile(src, dest, row.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                unreadable++
                continue
            }
            if (dao.swapAudioPath(row.id, path, dest.path) == 1) {
                src.delete()
                converted++
            } else {
                dest.delete()
            }
        }
        return AudioMigrationReport(converted, unreadable)
    }
}
