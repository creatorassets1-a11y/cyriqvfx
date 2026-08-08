package com.apexedits.core.media

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.util.LruCache
import com.apexedits.core.model.Ticks
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext

/**
 * Timeline thumbnails.
 *
 * The timeline draws a strip of frames along each video clip. Extracting those
 * frames is expensive — a `MediaMetadataRetriever` seek costs tens of
 * milliseconds — so three things happen here that are not optional on a phone:
 *
 *  - **Quantised requests.** Frames are fetched at bucket boundaries rather than
 *    at whatever position the strip happens to want, so scrolling reuses cached
 *    entries instead of requesting a slightly different frame each time.
 *  - **Bounded memory.** An `LruCache` sized as a fraction of the app's heap,
 *    not a fixed count: the same number of 1080p bitmaps that is comfortable on
 *    a flagship will trigger an OOM on a 3 GB device.
 *  - **Bounded concurrency.** Retrievers are serialised through a small
 *    semaphore. Each one holds a hardware decoder, and phones have very few;
 *    launching one per visible clip is how a timeline scroll turns into a
 *    decoder-exhaustion crash.
 */
class ThumbnailCache(
    private val context: Context,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {

    private val cache: LruCache<String, Bitmap> = run {
        val maxKb = (Runtime.getRuntime().maxMemory() / 1024).toInt()
        object : LruCache<String, Bitmap>(maxKb / CACHE_FRACTION) {
            override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount / 1024
        }
    }

    /**
     * Two concurrent extractions. Enough to keep the strip filling while the
     * user scrolls, few enough to leave decoders for playback.
     */
    private val decoderPermits = Semaphore(MAX_CONCURRENT_EXTRACTIONS)

    /**
     * A frame from [uri] at or near [time].
     *
     * Returns null rather than throwing when the frame cannot be produced: a
     * timeline with a blank thumbnail is usable; one that crashes on an
     * unreadable clip is not.
     */
    suspend fun frameAt(uri: String, time: Ticks, bucketMs: Long = DEFAULT_BUCKET_MS): Bitmap? {
        val bucket = (time.toMillis() / bucketMs) * bucketMs
        val key = "$uri@$bucket"

        cache.get(key)?.let { return it }

        return withContext(io) {
            decoderPermits.withPermit {
                // Re-check: another request for the same bucket may have
                // completed while this one waited for a permit.
                cache.get(key) ?: extract(uri, bucket)?.also { cache.put(key, it) }
            }
        }
    }

    private fun extract(uri: String, atMs: Long): Bitmap? {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, Uri.parse(uri))
            // OPTION_CLOSEST_SYNC, not OPTION_CLOSEST: a sync frame is already
            // decoded at a keyframe, so it costs a seek instead of a seek plus
            // decoding every frame up to the target. For a thumbnail strip a few
            // frames of imprecision is invisible and the speed difference is not.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                retriever.getScaledFrameAtTime(
                    atMs * 1000L,
                    MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
                    THUMBNAIL_WIDTH,
                    THUMBNAIL_HEIGHT,
                )
            } else {
                // getScaledFrameAtTime needs API 27. Below that, decode the frame
                // at full source resolution and scale it down by hand — slower,
                // but the PRD's minimum API is 24 and a thumbnail strip still has
                // to work there.
                retriever.getFrameAtTime(atMs * 1000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                    ?.let { Bitmap.createScaledBitmap(it, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, true) }
            }
        } catch (error: Exception) {
            null
        } finally {
            runCatching { retriever.release() }
        }
    }

    /** Called when a project closes, and on trim-memory. */
    fun clear() {
        cache.evictAll()
    }

    /** Drops half the cache under memory pressure rather than all of it. */
    fun trim() {
        cache.trimToSize(cache.size() / 2)
    }

    private companion object {
        /**
         * An eighth of the heap. Thumbnails are the largest discretionary
         * allocation in the app, and the timeline must never be the reason an
         * export runs out of memory.
         */
        const val CACHE_FRACTION = 8

        const val MAX_CONCURRENT_EXTRACTIONS = 2

        /** One thumbnail per second of media, quantised so scrolling hits the cache. */
        const val DEFAULT_BUCKET_MS = 1_000L

        const val THUMBNAIL_WIDTH = 160
        const val THUMBNAIL_HEIGHT = 90
    }
}
