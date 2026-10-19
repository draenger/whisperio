package ai.whisperio.android.history

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

enum class RecordingStatus { RECORDING, TRANSCRIBING, DONE, FAILED }

enum class RecordingSource { APP, KEYBOARD, TILE, SHORTCUT, WIDGET }

/** CONTRACT 7.3 plus [inserted] (keyboard only: null = n/a, false = transcript was not typed into a field). */
@Entity(tableName = "recording")
data class Recording(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "duration_ms") val durationMs: Long,
    val status: RecordingStatus,
    val provider: String,
    val model: String,
    val language: String,
    val transcript: String? = null,
    val error: String? = null,
    @ColumnInfo(name = "audio_path") val audioPath: String? = null,
    val source: RecordingSource,
    val inserted: Boolean? = null,
)

@Dao
interface RecordingDao {
    @Query("SELECT * FROM recording ORDER BY created_at DESC")
    fun observeAll(): Flow<List<Recording>>

    @Query("SELECT * FROM recording ORDER BY created_at DESC LIMIT :limit")
    fun observeRecent(limit: Int): Flow<List<Recording>>

    @Query("SELECT * FROM recording WHERE id = :id")
    fun observe(id: String): Flow<Recording?>

    @Query("SELECT * FROM recording WHERE id = :id")
    suspend fun get(id: String): Recording?

    @Upsert
    suspend fun upsert(recording: Recording)

    @Query("DELETE FROM recording WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM recording")
    suspend fun deleteAll()

    @Query("UPDATE recording SET inserted = :inserted WHERE id = :id")
    suspend fun setInserted(id: String, inserted: Boolean)

    /** Process-death sweep (CONTRACT 6): rows left mid-flight become failed. */
    @Query("UPDATE recording SET status = 'FAILED', error = :error WHERE status IN ('RECORDING', 'TRANSCRIBING') AND id != :excludeId")
    suspend fun sweepInterrupted(error: String, excludeId: String): Int

    @Query("SELECT * FROM recording WHERE created_at < :cutoff")
    suspend fun olderThan(cutoff: Long): List<Recording>

    @Query("SELECT * FROM recording WHERE audio_path IS NOT NULL")
    suspend fun withAudio(): List<Recording>

    @Query("UPDATE recording SET audio_path = NULL WHERE audio_path IS NOT NULL")
    suspend fun clearAudioPaths()
}

@Database(entities = [Recording::class], version = 1, exportSchema = true)
abstract class AppDatabase : RoomDatabase() {
    abstract fun recordings(): RecordingDao
}
