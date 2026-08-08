package com.apexedits.feature.export

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.apexedits.core.data.ProjectStore
import com.apexedits.core.media.CompositionBuilder
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Rendering the timeline to a file.
 *
 * A `CoroutineWorker` with a foreground notification, rather than a coroutine in
 * the editor's scope, because the PRD requires export to survive the app being
 * backgrounded. A four-minute 1080p render is long enough that the user will
 * switch away, and Android will kill a background process that is only holding a
 * coroutine.
 *
 * The output is written to a private file first and only published to the
 * gallery when the render succeeds. Writing directly into `MediaStore` would
 * leave a truncated, unplayable video in the user's camera roll every time an
 * export was cancelled or failed.
 */
@UnstableApi
class ExportWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val projectId = inputData.getString(KEY_PROJECT_ID) ?: return Result.failure()
        val settings = inputData.toSettings() ?: return Result.failure()

        setForeground(foregroundInfo(0))

        val database = com.apexedits.core.data.ProjectDatabase.get(applicationContext)
        val store = ProjectStore(applicationContext, database.projectDao())
        val project = store.load(projectId)?.project
            ?: return Result.failure(workDataOf(KEY_ERROR to "This project could not be opened."))

        val composition = CompositionBuilder.build(project)
            ?: return Result.failure(
                workDataOf(KEY_ERROR to "There is nothing on the timeline to export yet."),
            )

        val temporary = File(applicationContext.cacheDir, "export-$projectId-${System.currentTimeMillis()}.mp4")

        return try {
            val result = render(composition, settings, temporary)
            val uri = publishToGallery(temporary, project.name)
            temporary.delete()
            Result.success(
                workDataOf(
                    KEY_OUTPUT_URI to uri,
                    KEY_OUTPUT_SIZE to result.fileSizeBytes,
                ),
            )
        } catch (error: ExportException) {
            temporary.delete()
            Result.failure(workDataOf(KEY_ERROR to error.explain()))
        } catch (error: Exception) {
            temporary.delete()
            // A cancelled worker lands here too; WorkManager distinguishes the
            // two, so no partial file is ever left behind either way.
            Result.failure(workDataOf(KEY_ERROR to (error.message ?: "The export could not be completed.")))
        }
    }

    /**
     * Runs the Transformer and reports progress until it finishes.
     *
     * Transformer must be created, started and cancelled on a thread with a
     * Looper, so all three happen on the main dispatcher. Progress is polled
     * rather than pushed — Transformer exposes it through a holder, and a
     * one-second poll costs far less than a per-frame callback would.
     */
    private suspend fun render(
        composition: Composition,
        settings: ExportSettings,
        output: File,
    ): ExportResult = coroutineScope {
        val completion = CompletableDeferred<ExportResult>()

        val transformer = withContext(Dispatchers.Main) {
            Transformer.Builder(applicationContext)
                .setVideoMimeType(
                    when (settings.codec) {
                        VideoCodec.H264 -> MimeTypes.VIDEO_H264
                        VideoCodec.H265 -> MimeTypes.VIDEO_H265
                    },
                )
                .setAudioMimeType(MimeTypes.AUDIO_AAC)
                .addListener(
                    object : Transformer.Listener {
                        override fun onCompleted(composition: Composition, result: ExportResult) {
                            completion.complete(result)
                        }

                        override fun onError(
                            composition: Composition,
                            result: ExportResult,
                            exception: ExportException,
                        ) {
                            completion.completeExceptionally(exception)
                        }
                    },
                )
                .build()
                .also { it.start(composition, output.absolutePath) }
        }

        val poller = launch {
            val holder = ProgressHolder()
            while (isActive && !completion.isCompleted) {
                val state = withContext(Dispatchers.Main) { transformer.getProgress(holder) }
                if (state != Transformer.PROGRESS_STATE_NOT_STARTED) {
                    setForeground(foregroundInfo(holder.progress))
                    setProgress(workDataOf(KEY_PROGRESS to holder.progress))
                }
                delay(PROGRESS_POLL_MS)
            }
        }

        try {
            completion.await()
        } finally {
            poller.cancel()
            // Cancelling a Transformer that already finished is a no-op, so this
            // is safe on the success path as well as when the user cancels.
            withContext(NonCancellable + Dispatchers.Main) { runCatching { transformer.cancel() } }
        }
    }

    /**
     * Publishes the finished file to the gallery.
     *
     * `MediaStore` rather than a raw path: it needs no storage permission on any
     * supported API level, and it puts the video where the user's gallery app
     * will actually find it.
     */
    private fun publishToGallery(source: File, projectName: String): String {
        val resolver = applicationContext.contentResolver
        val safeName = projectName.replace(Regex("[^A-Za-z0-9 _-]"), "").trim().ifBlank { "ApexEdits" }
        val values = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, "$safeName-${System.currentTimeMillis()}.mp4")
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Video.Media.RELATIVE_PATH, "Movies/ApexEdits")
                // Hidden from the gallery until the copy finishes, so a
                // half-written file never appears in the user's camera roll.
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
        }

        val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
            ?: error("The video could not be saved to your gallery.")

        resolver.openOutputStream(uri)?.use { out -> source.inputStream().use { it.copyTo(out) } }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            resolver.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null)
        }
        return uri.toString()
    }

    private fun foregroundInfo(percent: Int): ForegroundInfo {
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Video export", NotificationManager.IMPORTANCE_LOW)
                    .apply { description = "Shows progress while ApexEdits saves your finished video." },
            )
        }

        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setContentTitle("Exporting your video")
            .setContentText(if (percent > 0) "$percent% complete" else "Preparing…")
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setProgress(100, percent.coerceIn(0, 100), percent <= 0)
            .setOngoing(true)
            .setSilent(true)
            .build()

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(
                NOTIFICATION_ID,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        const val KEY_PROJECT_ID = "project_id"
        const val KEY_WIDTH = "width"
        const val KEY_HEIGHT = "height"
        const val KEY_BITRATE = "bitrate"
        const val KEY_CODEC = "codec"
        const val KEY_FPS_NUM = "fps_num"
        const val KEY_FPS_DEN = "fps_den"
        const val KEY_PROGRESS = "progress"
        const val KEY_ERROR = "error"
        const val KEY_OUTPUT_URI = "output_uri"
        const val KEY_OUTPUT_SIZE = "output_size"

        const val WORK_NAME_PREFIX = "apexedits-export-"

        private const val CHANNEL_ID = "apexedits-export"
        private const val NOTIFICATION_ID = 1001
        private const val PROGRESS_POLL_MS = 1_000L

        fun inputData(projectId: String, settings: ExportSettings) = workDataOf(
            KEY_PROJECT_ID to projectId,
            KEY_WIDTH to settings.width,
            KEY_HEIGHT to settings.height,
            KEY_BITRATE to settings.videoBitrate,
            KEY_CODEC to settings.codec.name,
            KEY_FPS_NUM to settings.frameRate.numerator,
            KEY_FPS_DEN to settings.frameRate.denominator,
        )
    }
}

private fun androidx.work.Data.toSettings(): ExportSettings? {
    val width = getInt(ExportWorker.KEY_WIDTH, 0).takeIf { it > 0 } ?: return null
    val height = getInt(ExportWorker.KEY_HEIGHT, 0).takeIf { it > 0 } ?: return null
    return ExportSettings(
        width = width,
        height = height,
        frameRate = com.apexedits.core.model.FrameRate(
            getInt(ExportWorker.KEY_FPS_NUM, 30),
            getInt(ExportWorker.KEY_FPS_DEN, 1),
        ),
        videoBitrate = getInt(ExportWorker.KEY_BITRATE, 10_000_000),
        codec = runCatching { VideoCodec.valueOf(getString(ExportWorker.KEY_CODEC).orEmpty()) }
            .getOrDefault(VideoCodec.H264),
    )
}

/**
 * Turns a Media3 export failure into something a person can act on.
 *
 * The raw `ExportException` says things like "ERROR_CODE_ENCODING_FORMAT_
 * UNSUPPORTED", which tells the user nothing about what to do next.
 */
@UnstableApi
private fun ExportException.explain(): String = when (errorCode) {
    ExportException.ERROR_CODE_ENCODER_INIT_FAILED,
    ExportException.ERROR_CODE_ENCODING_FORMAT_UNSUPPORTED,
    ->
        "This device cannot record video at the settings you chose. Try a lower resolution, " +
            "or switch the format to H.264."

    ExportException.ERROR_CODE_IO_FILE_NOT_FOUND ->
        "One of the videos in your project could not be found. It may have been moved or deleted."

    ExportException.ERROR_CODE_IO_NO_PERMISSION ->
        "ApexEdits does not have permission to read one of the files in your project."

    ExportException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ->
        "One of the videos in your project is in a format this device cannot read."

    ExportException.ERROR_CODE_MUXING_FAILED ->
        "The finished video could not be written. Check that there is enough free space on the device."

    else -> "The export could not be completed. ${message.orEmpty()}".trim()
}
