package com.apexedits.core.data

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import com.apexedits.core.model.MediaKind
import com.apexedits.core.model.MediaRef
import com.apexedits.core.model.Ticks
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Importing media from device storage.
 *
 * Import takes a persistable read grant and stores the URI — it does not copy
 * the file. A 4K clip is gigabytes, and copying every import would fill the
 * device to satisfy a model that keeps the original around anyway. The cost is
 * that a URI can go stale when the user deletes or moves the file, which is
 * exactly what [refreshAvailability] detects and the relink flow repairs.
 */
class MediaImporter(
    private val context: Context,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {

    /**
     * The picker intent.
     *
     * `ACTION_OPEN_DOCUMENT` rather than `ACTION_GET_CONTENT` because only the
     * former can grant persistable permission. Without that the URI works for
     * this session and fails on the next launch, which would turn every reopened
     * project into a wall of missing media.
     */
    fun pickIntent(kinds: Set<MediaKind> = setOf(MediaKind.VIDEO, MediaKind.AUDIO, MediaKind.IMAGE)): Intent =
        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            putExtra(Intent.EXTRA_MIME_TYPES, kinds.flatMap { it.mimePrefixes() }.toTypedArray())
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

    /**
     * Reads a picked URI into a [MediaRef].
     *
     * Returns null when the file cannot be read or carries no usable media, so a
     * corrupt file in a multi-select is skipped and the rest still import — the
     * PRD's "skip with message and continue".
     */
    suspend fun import(uri: Uri, id: String): MediaRef? = withContext(io) {
        takePersistablePermission(uri)

        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(context, uri)

            val durationMs = retriever.extract(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
            val width = retriever.extract(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
            val height = retriever.extract(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
            val rotation = retriever.extract(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
            val hasVideo = retriever.extract(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO) == "yes"
            val hasAudio = retriever.extract(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes"
            val frameRate = retriever.extract(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE)
                ?.toFloatOrNull() ?: 0f
            // Not every provider reports a type — a document picked from some
            // file managers comes back null — so fall back to what the container
            // declares about itself. Without this, a perfectly readable image
            // fails to import for want of a MIME string.
            val mimeType = context.contentResolver.getType(uri)
                ?: retriever.extract(MediaMetadataRetriever.METADATA_KEY_MIMETYPE)
                ?: ""

            val kind = when {
                mimeType.startsWith("image/") -> MediaKind.IMAGE
                hasVideo -> MediaKind.VIDEO
                hasAudio -> MediaKind.AUDIO
                else -> return@withContext null
            }

            val duration = when (kind) {
                // A still has no duration of its own. Five seconds is the
                // conventional default; the user trims it like any other clip.
                MediaKind.IMAGE -> DEFAULT_IMAGE_DURATION
                else -> durationMs?.let { Ticks.ofMillis(it) } ?: return@withContext null
            }
            if (kind != MediaKind.IMAGE && !duration.isPositive) return@withContext null

            // Portrait video is often stored landscape with a rotation flag. The
            // timeline needs the displayed shape, not the stored one, or every
            // phone-shot vertical clip lays out sideways.
            val rotated = rotation == 90 || rotation == 270
            val displayWidth = if (rotated) height else width
            val displayHeight = if (rotated) width else height

            MediaRef(
                id = id,
                uri = uri.toString(),
                displayName = displayName(uri),
                kind = kind,
                duration = duration,
                width = displayWidth,
                height = displayHeight,
                rotationDegrees = rotation,
                frameRate = frameRate,
                hasAudio = hasAudio,
                sizeBytes = sizeOf(uri),
                available = true,
            )
        } catch (error: Exception) {
            // Unreadable or unsupported: report nothing rather than a broken ref.
            null
        } finally {
            runCatching { retriever.release() }
        }
    }

    /**
     * Rechecks whether each reference still resolves.
     *
     * Run when a project opens. A file the user deleted between sessions comes
     * back `available = false`, which keeps it on the timeline as a gap the
     * relink flow can repair rather than dropping the clip.
     */
    suspend fun refreshAvailability(refs: List<MediaRef>): List<MediaRef> = withContext(io) {
        refs.map { ref ->
            val available = runCatching {
                context.contentResolver.openInputStream(Uri.parse(ref.uri))?.use { true } ?: false
            }.getOrDefault(false)
            if (available == ref.available) ref else ref.copy(available = available)
        }
    }

    /**
     * Prepares a URI picked to relink a missing clip, and returns it as a string
     * ready for [com.apexedits.core.engine.edit.relinkMedia].
     *
     * Deliberately does not re-run full metadata extraction: relinking assumes
     * the picked file *is* the original — moved or renamed, not replaced with
     * different content — so the clip's stored duration and dimensions still
     * describe it. Only the read grant needs renewing, since the new URI has
     * never been persisted before.
     */
    fun preparePersistableUri(uri: Uri): String {
        takePersistablePermission(uri)
        return uri.toString()
    }

    private fun takePersistablePermission(uri: Uri) {
        runCatching {
            context.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        }
        // Failure is survivable: the URI still works for this session, and the
        // project reopens with the clip flagged for relink instead of crashing.
    }

    private fun displayName(uri: Uri): String {
        if (uri.scheme == ContentResolver.SCHEME_FILE) return uri.lastPathSegment.orEmpty()
        return runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                }
        }.getOrNull() ?: uri.lastPathSegment ?: "Media"
    }

    private fun sizeOf(uri: Uri): Long = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
            ?.use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }
    }.getOrNull() ?: 0L

    private fun MediaMetadataRetriever.extract(key: Int): String? =
        runCatching { extractMetadata(key) }.getOrNull()

    companion object {
        val DEFAULT_IMAGE_DURATION: Ticks = Ticks.ofSeconds(5.0)
    }
}

private fun MediaKind.mimePrefixes(): List<String> = when (this) {
    MediaKind.VIDEO -> listOf("video/*")
    MediaKind.AUDIO -> listOf("audio/*")
    MediaKind.IMAGE -> listOf("image/*")
}
