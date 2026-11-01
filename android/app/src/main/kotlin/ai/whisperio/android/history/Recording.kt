package ai.whisperio.android.history

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Upsert
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
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
    /** CONTRACT-1.2 F3: a seed id ("work"...), a custom id ("c_" + UUID) or null = none. Written only via [RecordingDao.setCategory]. */
    val category: String? = null,
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

    /** CONTRACT-1.2 F3: a dedicated UPDATE, never `copy` + upsert (the controller writes whole rows). */
    @Query("UPDATE recording SET category = :category WHERE id = :id")
    suspend fun setCategory(id: String, category: String?)

    /** Deleting a custom category: every row carrying it goes back to none. */
    @Query("UPDATE recording SET category = NULL WHERE category = :categoryId")
    suspend fun clearCategory(categoryId: String): Int

    /**
     * Targeted write of the columns the dictation pipeline owns. Never touches category / inserted / created_at / source,
     * and a row deleted meanwhile stays deleted (0 rows updated), unlike `copy` + upsert.
     */
    @Query(
        "UPDATE recording SET status = :status, duration_ms = :durationMs, provider = :provider, model = :model, " +
            "transcript = :transcript, error = :error, audio_path = :audioPath WHERE id = :id",
    )
    suspend fun updateOutcome(
        id: String,
        status: RecordingStatus,
        durationMs: Long,
        provider: String,
        model: String,
        transcript: String?,
        error: String?,
        audioPath: String?,
    ): Int

    @Query("UPDATE recording SET audio_path = NULL WHERE audio_path IS NOT NULL")
    suspend fun clearAudioPaths()
}

@Database(entities = [Recording::class], version = 2, exportSchema = true)
abstract class AppDatabase : RoomDatabase() {
    abstract fun recordings(): RecordingDao
}

/** v1 -> v2 (CONTRACT-1.2 F3): nullable `category`, no default; existing rows read null. No destructive fallback. */
val MIGRATION_1_2: Migration = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE recording ADD COLUMN category TEXT")
    }
}
