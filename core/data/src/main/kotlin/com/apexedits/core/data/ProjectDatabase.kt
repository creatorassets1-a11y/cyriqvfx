package com.apexedits.core.data

import android.content.Context
import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

/**
 * The project index.
 *
 * Room holds *metadata* — enough to draw the projects screen without opening
 * anything — while the timeline itself lives in `project.json` inside the
 * project folder.
 *
 * That split is deliberate. The alternative, a fully normalised schema with
 * tables for tracks, clips, keyframes and effects, means a migration every time
 * the edit model gains a field, and Phase 2 alone adds keyframes, masks, colour
 * grades and chroma settings. Serialising the document as JSON lets the model
 * evolve behind a version number, while the columns that the projects list
 * actually queries and sorts on stay indexed and typed.
 *
 * It also makes a project folder self-contained and portable, which is what the
 * PRD's "export project package" needs.
 */
@Entity(tableName = "projects")
data class ProjectEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "name") val name: String,
    @ColumnInfo(name = "folder_path") val folderPath: String,
    @ColumnInfo(name = "width") val width: Int,
    @ColumnInfo(name = "height") val height: Int,
    @ColumnInfo(name = "frame_rate_numerator") val frameRateNumerator: Int,
    @ColumnInfo(name = "frame_rate_denominator") val frameRateDenominator: Int,
    @ColumnInfo(name = "aspect") val aspect: String,
    /** Cached so the projects list does not have to parse every document. */
    @ColumnInfo(name = "duration_ticks") val durationTicks: Long,
    @ColumnInfo(name = "clip_count") val clipCount: Int,
    @ColumnInfo(name = "thumbnail_path") val thumbnailPath: String?,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "modified_at") val modifiedAt: Long,
    /**
     * Set while the editor holds the project open. If it is still true at
     * launch, the app exited without a clean close and there is an autosave
     * worth offering to restore.
     */
    @ColumnInfo(name = "open_flag") val openFlag: Boolean = false,
)

@Dao
interface ProjectDao {

    @Query("SELECT * FROM projects ORDER BY modified_at DESC")
    fun observeAll(): Flow<List<ProjectEntity>>

    @Query("SELECT * FROM projects WHERE id = :id")
    suspend fun byId(id: String): ProjectEntity?

    @Query("SELECT * FROM projects WHERE open_flag = 1 ORDER BY modified_at DESC LIMIT 1")
    suspend fun lastOpen(): ProjectEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(project: ProjectEntity)

    @Update
    suspend fun update(project: ProjectEntity)

    @Query("DELETE FROM projects WHERE id = :id")
    suspend fun delete(id: String)

    @Query("UPDATE projects SET open_flag = :open WHERE id = :id")
    suspend fun setOpen(id: String, open: Boolean)

    @Query("UPDATE projects SET open_flag = 0")
    suspend fun clearAllOpenFlags()
}

@Database(
    entities = [ProjectEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class ProjectDatabase : RoomDatabase() {

    abstract fun projectDao(): ProjectDao

    companion object {
        private const val NAME = "apexedits-projects.db"

        @Volatile
        private var instance: ProjectDatabase? = null

        fun get(context: Context): ProjectDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                ProjectDatabase::class.java,
                NAME,
            )
                // No fallbackToDestructiveMigration. A destructive fallback on a
                // free offline editor means someone's project list disappears
                // after an update, with no cloud copy to restore it from. Every
                // schema change gets a real migration.
                .build()
                .also { instance = it }
        }
    }
}
