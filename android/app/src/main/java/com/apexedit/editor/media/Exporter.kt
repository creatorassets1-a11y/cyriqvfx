package com.apexedit.editor.media

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import com.apexedit.editor.core.EditDocument
import com.apexedit.editor.core.Time
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Export.
 *
 * Renders the very same [Composition] the preview plays, through Media3's
 * `Transformer` — hardware encoder, correct audio muxing, no frame-by-frame
 * canvas capture. The output lands in the device's Movies folder via
 * MediaStore, so it shows up in the gallery immediately.
 */
@UnstableApi
class Exporter(private val context: Context) {

    data class Preset(
        val id: String,
        val label: String,
        val longEdge: Int,
        val detail: String,
    )

    sealed interface Progress {
        data object Preparing : Progress
        data class Working(val fraction: Float) : Progress
        data class Done(val uri: Uri, val sizeBytes: Long) : Progress
        data class Failed(val message: String) : Progress
    }

    /**
     * Export the document.
     *
     * Suspends until the render finishes. Cancelling the coroutine cancels the
     * underlying Transformer, so backing out of the export screen does not
     * leave an encoder running.
     */
    suspend fun export(
        doc: EditDocument,
        preset: Preset,
        onProgress: (Float) -> Unit,
    ): Progress {
        val composition = CompositionBuilder.build(doc)
            ?: return Progress.Failed("There is nothing on the timeline to export.")

        val outputFile = File(context.cacheDir, "apexedit_${System.currentTimeMillis()}.mp4")

        return try {
            val result = runTransformer(composition, outputFile, doc, onProgress)
            val uri = publishToGallery(outputFile, doc.name)
            outputFile.delete()
            Progress.Done(uri, result.fileSizeBytes.coerceAtLeast(0))
        } catch (e: ExportException) {
            outputFile.delete()
            Progress.Failed(describe(e))
        } catch (e: Exception) {
            outputFile.delete()
            Progress.Failed(e.localizedMessage ?: "Export failed")
        }
    }

    private suspend fun runTransformer(
        composition: Composition,
        outputFile: File,
        doc: EditDocument,
        onProgress: (Float) -> Unit,
    ): ExportResult = suspendCancellableCoroutine { cont ->
        val transformer = Transformer.Builder(context)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, result: ExportResult) {
                    if (cont.isActive) cont.resume(result)
                }

                override fun onError(
                    composition: Composition,
                    result: ExportResult,
                    exception: ExportException,
                ) {
                    if (cont.isActive) cont.resumeWithException(exception)
                }
            })
            .build()

        cont.invokeOnCancellation { transformer.cancel() }

        // Poll progress: Transformer reports it on demand rather than pushing.
        val holder = androidx.media3.transformer.ProgressHolder()
        val ticker = object : Runnable {
            override fun run() {
                if (!cont.isActive) return
                val state = transformer.getProgress(holder)
                if (state != Transformer.PROGRESS_STATE_NOT_STARTED) {
                    onProgress(holder.progress / 100f)
                }
                handler.postDelayed(this, 250)
            }
        }

        transformer.start(composition, outputFile.absolutePath)
        handler.post(ticker)
        cont.invokeOnCancellation { handler.removeCallbacks(ticker) }
    }

    /** Copy into the gallery so the export is visible to other apps. */
    private fun publishToGallery(file: File, projectName: String): Uri {
        val safeName = projectName.replace(Regex("[^A-Za-z0-9 _-]"), "").ifBlank { "ApexEdit" }
        val displayName = "${safeName}_${System.currentTimeMillis()}.mp4"

        val values = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, displayName)
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/ApexEdit")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
        }

        val resolver = context.contentResolver
        val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        } else {
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        }

        val uri = resolver.insert(collection, values)
            ?: throw IllegalStateException("Could not create the output file")

        resolver.openOutputStream(uri)?.use { output ->
            file.inputStream().use { it.copyTo(output) }
        } ?: throw IllegalStateException("Could not write the output file")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.clear()
            values.put(MediaStore.Video.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        }
        return uri
    }

    /**
     * Turn a codec failure into something a person can act on. The raw message
     * is usually a MediaCodec error code, which helps nobody.
     */
    private fun describe(e: ExportException): String = when (e.errorCode) {
        ExportException.ERROR_CODE_ENCODER_INIT_FAILED,
        ExportException.ERROR_CODE_ENCODING_FORMAT_UNSUPPORTED ->
            "This device's encoder cannot handle that resolution. Try exporting at 1080p."
        ExportException.ERROR_CODE_DECODER_INIT_FAILED,
        ExportException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ->
            "One of your clips uses a format this device cannot decode."
        ExportException.ERROR_CODE_IO_FILE_NOT_FOUND ->
            "A clip's media file is missing. It may have been deleted or moved."
        ExportException.ERROR_CODE_IO_NO_PERMISSION ->
            "ApexEdit does not have permission to read one of your clips."
        else -> e.localizedMessage ?: "Export failed"
    }

    private val handler = android.os.Handler(android.os.Looper.getMainLooper())

    companion object {
        /**
         * Presets. Long edge only — the aspect comes from the project, so a
         * 9:16 project exports 1080x1920 and a 16:9 one exports 1920x1080 from
         * the same preset.
         */
        val PRESETS = listOf(
            Preset("720", "720p", 1280, "Smaller file, fastest"),
            Preset("1080", "1080p", 1920, "Recommended for social"),
            Preset("4k", "4K", 3840, "Largest file, slowest"),
        )

        /** Rough size estimate for the pre-export summary, in bytes. */
        fun estimateBytes(doc: EditDocument, preset: Preset): Long {
            val seconds = Time.ticksToSeconds(doc.duration)
            // Bits per pixel per second calibrated at 1080p30 ≈ 12 Mbps H.264.
            val pixels = preset.longEdge.toLong() * (preset.longEdge * 9 / 16)
            val bitrate = (pixels * doc.settings.frameRate.fps * 0.19e-6 * 1e6)
                .coerceIn(2_000_000.0, 80_000_000.0)
            return ((seconds * (bitrate + 256_000)) / 8).toLong()
        }
    }
}
