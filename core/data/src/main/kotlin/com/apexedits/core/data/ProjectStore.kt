package com.apexedits.core.data

import android.content.Context
import com.apexedits.core.model.AspectRatio
import com.apexedits.core.model.FrameRate
import com.apexedits.core.model.Project
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.File

/**
 * Reading and writing projects.
 *
 * A project is a folder, not a row:
 *
 *     projects/<id>/
 *       project.json       the document
 *       project.autosave   the in-progress document, promoted on clean close
 *       media/             imported copies, where the source was not persistable
 *       proxies/           generated low-resolution stand-ins
 *       thumbs/            timeline thumbnail and waveform cache
 *
 * Self-contained folders are what make "export project package" a zip of a
 * directory rather than a bespoke serialiser, and they mean a corrupt index row
 * loses a project's *listing*, not the project.
 */
class ProjectStore(
    private val context: Context,
    private val dao: ProjectDao,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {

    private val json = Json {
        // A document written by a newer build must not hard-fail an older one:
        // unknown fields are skipped so a downgrade degrades rather than dies.
        ignoreUnknownKeys = true
        encodeDefaults = true
        prettyPrint = false
    }

    private val root: File get() = File(context.filesDir, "projects")

    fun folderFor(projectId: String) = File(root, projectId)

    fun documentFile(projectId: String) = File(folderFor(projectId), "project.json")

    fun autosaveFile(projectId: String) = File(folderFor(projectId), "project.autosave")

    fun mediaDir(projectId: String) = File(folderFor(projectId), "media")

    fun proxyDir(projectId: String) = File(folderFor(projectId), "proxies")

    fun thumbnailDir(projectId: String) = File(folderFor(projectId), "thumbs")

    fun observeProjects(): Flow<List<ProjectEntity>> = dao.observeAll()

    /** Creates the folder structure and indexes the project. */
    suspend fun create(project: Project): Unit = withContext(io) {
        listOf(folderFor(project.id), mediaDir(project.id), proxyDir(project.id), thumbnailDir(project.id))
            .forEach { it.mkdirs() }
        writeDocument(project, documentFile(project.id))
        dao.insert(project.toEntity(folderFor(project.id).absolutePath))
    }

    /**
     * Loads a project, preferring a newer autosave.
     *
     * Returns the autosave alongside a flag rather than silently choosing, so
     * the editor can ask "Restore last session?" — the PRD's crash-recovery
     * prompt. Silently taking the newer file would discard whatever the user
     * last deliberately saved without telling them.
     */
    suspend fun load(projectId: String): LoadResult? = withContext(io) {
        val document = documentFile(projectId)
        val autosave = autosaveFile(projectId)

        val saved = document.takeIf { it.exists() }?.let { readDocument(it) }
        val recovered = autosave.takeIf { it.exists() }?.let { readDocument(it) }

        when {
            saved == null && recovered == null -> null
            saved == null -> LoadResult(recovered!!, hasRecovery = true, recovered = recovered)
            recovered == null -> LoadResult(saved, hasRecovery = false, recovered = null)
            recovered.revision > saved.revision ->
                LoadResult(saved, hasRecovery = true, recovered = recovered)
            else -> LoadResult(saved, hasRecovery = false, recovered = null)
        }
    }

    data class LoadResult(
        /** What to open by default: the last deliberate save. */
        val project: Project,
        /** True when an unpromoted autosave is newer, so the editor should offer it. */
        val hasRecovery: Boolean,
        val recovered: Project?,
    )

    /** Writes the autosave file. Cheap enough to call on a debounce. */
    suspend fun autosave(project: Project): Unit = withContext(io) {
        writeDocument(project, autosaveFile(project.id))
    }

    /**
     * Promotes the autosave to the saved document and updates the index.
     *
     * Called when the editor closes cleanly, and after an accepted recovery.
     */
    suspend fun commit(project: Project): Unit = withContext(io) {
        writeDocument(project, documentFile(project.id))
        autosaveFile(project.id).delete()
        val existing = dao.byId(project.id)
        val entity = project.toEntity(folderFor(project.id).absolutePath)
            .copy(
                createdAt = existing?.createdAt ?: project.createdAtEpochMs,
                thumbnailPath = existing?.thumbnailPath,
                openFlag = false,
            )
        dao.update(entity)
    }

    suspend fun markOpen(projectId: String, open: Boolean): Unit = withContext(io) {
        dao.setOpen(projectId, open)
    }

    /**
     * A project left flagged open at launch means the last session ended
     * without a clean close — a crash, or the system reclaiming the process.
     */
    suspend fun findInterruptedSession(): ProjectEntity? = withContext(io) { dao.lastOpen() }

    suspend fun delete(projectId: String): Unit = withContext(io) {
        folderFor(projectId).deleteRecursively()
        dao.delete(projectId)
    }

    suspend fun rename(projectId: String, name: String): Unit = withContext(io) {
        val entity = dao.byId(projectId) ?: return@withContext
        dao.update(entity.copy(name = name, modifiedAt = System.currentTimeMillis()))
        val loaded = load(projectId)?.project ?: return@withContext
        writeDocument(loaded.copy(name = name), documentFile(projectId))
    }

    /** Total bytes under a project folder, for the storage screen. */
    suspend fun folderSizeBytes(projectId: String): Long = withContext(io) {
        folderFor(projectId).walkBottomUp().filter { it.isFile }.sumOf { it.length() }
    }

    /** Clears generated caches. Proxies and thumbnails rebuild on demand. */
    suspend fun clearCaches(projectId: String): Unit = withContext(io) {
        proxyDir(projectId).deleteRecursively()
        thumbnailDir(projectId).deleteRecursively()
        proxyDir(projectId).mkdirs()
        thumbnailDir(projectId).mkdirs()
    }

    /**
     * A breakdown of on-device storage, for the Settings screen.
     *
     * The PRD asks for "Storage management (clear cache, proxies)" as its own
     * settings section, which means the user needs to see where space is going
     * before deciding what to clear — a single combined total does not answer
     * "is it my footage or the app's caches".
     */
    data class StorageBreakdown(
        val documentsBytes: Long,
        val mediaBytes: Long,
        val proxyBytes: Long,
        val thumbnailBytes: Long,
    ) {
        val totalBytes: Long get() = documentsBytes + mediaBytes + proxyBytes + thumbnailBytes
    }

    suspend fun storageBreakdown(): StorageBreakdown = withContext(io) {
        var documents = 0L
        var media = 0L
        var proxies = 0L
        var thumbnails = 0L

        root.listFiles()?.forEach { projectDir ->
            if (!projectDir.isDirectory) return@forEach
            documents += (File(projectDir, "project.json").length() + File(projectDir, "project.autosave").length())
            media += File(projectDir, "media").sizeRecursively()
            proxies += File(projectDir, "proxies").sizeRecursively()
            thumbnails += File(projectDir, "thumbs").sizeRecursively()
        }
        StorageBreakdown(documents, media, proxies, thumbnails)
    }

    /** Clears generated caches across every project. The Settings "Clear cache" action. */
    suspend fun clearAllCaches(): Unit = withContext(io) {
        root.listFiles()?.forEach { projectDir ->
            if (!projectDir.isDirectory) return@forEach
            clearCaches(projectDir.name)
        }
    }

    private fun File.sizeRecursively(): Long =
        if (isDirectory) walkBottomUp().filter { it.isFile }.sumOf { it.length() } else 0L

    // --- serialisation -------------------------------------------------------

    private fun readDocument(file: File): Project? = runCatching {
        json.decodeFromString(Project.serializer(), file.readText())
    }.getOrNull()

    /**
     * Writes through a temporary file and renames.
     *
     * A phone can lose power or be killed by the system mid-write. Writing in
     * place would leave a half-written `project.json` and no way back; the
     * rename is atomic on the same filesystem, so the reader sees either the old
     * document or the new one and never a truncated one.
     */
    private fun writeDocument(project: Project, target: File) {
        target.parentFile?.mkdirs()
        val temp = File(target.parentFile, "${target.name}.tmp")
        temp.writeText(json.encodeToString(Project.serializer(), project))
        if (!temp.renameTo(target)) {
            // Rename can fail if the target exists on some filesystems.
            target.delete()
            temp.renameTo(target)
        }
    }
}

private fun Project.toEntity(folderPath: String) = ProjectEntity(
    id = id,
    name = name,
    folderPath = folderPath,
    width = format.width,
    height = format.height,
    frameRateNumerator = format.frameRate.numerator,
    frameRateDenominator = format.frameRate.denominator,
    aspect = format.aspect.name,
    durationTicks = duration.raw,
    clipCount = tracks.sumOf { it.clips.size },
    thumbnailPath = null,
    createdAt = createdAtEpochMs,
    modifiedAt = modifiedAtEpochMs,
)

/** Rebuilds the display format from index columns, for the projects list. */
fun ProjectEntity.frameRate(): FrameRate = FrameRate(frameRateNumerator, frameRateDenominator)

fun ProjectEntity.aspectRatio(): AspectRatio =
    runCatching { AspectRatio.valueOf(aspect) }.getOrDefault(AspectRatio.VERTICAL_9_16)
