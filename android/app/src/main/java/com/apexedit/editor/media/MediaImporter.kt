package com.apexedit.editor.media

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import com.apexedit.editor.core.FrameRate
import com.apexedit.editor.core.MediaAsset
import com.apexedit.editor.core.MediaKind
import com.apexedit.editor.core.Time
import com.apexedit.editor.core.newId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Reading media the user picked.
 *
 * Everything here runs off the main thread and everything is defensive:
 * `MediaMetadataRetriever` throws on files it cannot parse, reports nulls for
 * fields that should always exist, and occasionally lies about rotation. A
 * single bad file in a multi-select must not fail the whole import.
 */
object MediaImporter {

    /** Read one URI into an asset, or null if it cannot be used. */
    suspend fun load(context: Context, uri: Uri): MediaAsset? = withContext(Dispatchers.IO) {
        // Persist read access, or the URI stops working after a restart.
        runCatching {
            context.contentResolver.takePersistableUriPermission(
                uri,
                android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        }

        val name = displayName(context, uri) ?: "Clip"
        val mime = context.contentResolver.getType(uri).orEmpty()

        if (mime.startsWith("image/")) {
            return@withContext loadImage(context, uri, name)
        }

        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(context, uri)

            val durationMs = retriever.extract(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
            val hasVideo = retriever.extract(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO) == "yes"
            val hasAudio = retriever.extract(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes"

            if (durationMs == null || durationMs <= 0) return@withContext null

            val width = retriever.extract(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
            val height = retriever.extract(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
            val rotation = retriever.extract(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0

            val fps = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                retriever.extract(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE)?.toFloatOrNull()
            } else {
                null
            }

            MediaAsset(
                id = newId("med"),
                kind = if (hasVideo) MediaKind.VIDEO else MediaKind.AUDIO,
                name = name,
                uri = uri,
                duration = Time.msToTicks(durationMs),
                width = width,
                height = height,
                frameRate = fps?.let { FrameRate.nearest(it) } ?: FrameRate.FPS_30,
                hasAudio = hasAudio,
                rotationDegrees = rotation,
            )
        } catch (e: Exception) {
            // Unreadable file: skipped, never fatal.
            null
        } finally {
            runCatching { retriever.release() }
        }
    }

    private fun loadImage(context: Context, uri: Uri, name: String): MediaAsset? {
        return try {
            val options = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use {
                android.graphics.BitmapFactory.decodeStream(it, null, options)
            } ?: return null

            if (options.outWidth <= 0) return null
            MediaAsset(
                id = newId("med"),
                kind = MediaKind.IMAGE,
                name = name,
                uri = uri,
                // Stills have no intrinsic length; the timeline gives them one.
                duration = null,
                width = options.outWidth,
                height = options.outHeight,
                hasAudio = false,
            )
        } catch (e: Exception) {
            null
        }
    }

    /**
     * A thumbnail at a source position, for the timeline filmstrip.
     *
     * `OPTION_CLOSEST_SYNC` rather than `OPTION_CLOSEST`: filmstrip frames only
     * need to be representative, and decoding to an exact non-keyframe is an
     * order of magnitude slower — which matters when a track needs dozens.
     */
    suspend fun thumbnail(
        context: Context,
        uri: Uri,
        atTicks: Long,
        targetWidth: Int = 128,
    ): Bitmap? = withContext(Dispatchers.IO) {
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(context, uri)
            val us = Time.ticksToUs(atTicks)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                retriever.getScaledFrameAtTime(
                    us,
                    MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
                    targetWidth,
                    targetWidth,
                )
            } else {
                retriever.getFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
            }
        } catch (e: Exception) {
            null
        } finally {
            runCatching { retriever.release() }
        }
    }

    private fun displayName(context: Context, uri: Uri): String? = runCatching {
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) {
                cursor.getString(index)?.substringBeforeLast('.')
            } else {
                null
            }
        }
    }.getOrNull()

    private fun MediaMetadataRetriever.extract(key: Int): String? =
        runCatching { extractMetadata(key) }.getOrNull()
}
