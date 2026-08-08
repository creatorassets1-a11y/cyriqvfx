package com.apexedits.core.media

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.util.LruCache
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.nio.ByteOrder

/**
 * Waveform peaks for the timeline's audio clips.
 *
 * Mirrors [ThumbnailCache]'s shape for the same reasons: a small LRU cache
 * keyed by source and requested resolution, and a semaphore bounding
 * concurrent decodes, because a `MediaCodec` instance is exactly as scarce a
 * hardware resource as a `MediaMetadataRetriever`'s.
 *
 * Unlike a thumbnail, the whole clip is decoded once per (uri, resolution)
 * pair rather than per visible bucket — an audio decode is a single linear
 * pass regardless of how much of it is asked for, so there is nothing to gain
 * from quantising the request the way [ThumbnailCache] quantises seeks.
 */
class WaveformExtractor(
    private val context: Context,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {

    private val cache = object : LruCache<String, FloatArray>(MAX_CACHED_WAVEFORMS) {}

    /** One decode at a time: a MediaCodec instance is a scarce hardware resource. */
    private val decoderPermits = Semaphore(MAX_CONCURRENT_DECODES)

    /**
     * Peak amplitudes for [uri]'s audio track, downsampled to [bucketCount] bars.
     *
     * Returns null rather than throwing when the source has no audio track or
     * cannot be decoded: a clip with a flat, blank waveform is usable; a
     * timeline that crashes because one file is unreadable is not.
     */
    suspend fun peaks(uri: String, bucketCount: Int): FloatArray? {
        if (bucketCount <= 0) return null
        val key = "$uri@$bucketCount"
        cache.get(key)?.let { return it }

        return withContext(io) {
            decoderPermits.withPermit {
                cache.get(key) ?: extract(uri, bucketCount)?.also { cache.put(key, it) }
            }
        }
    }

    private fun extract(uri: String, bucketCount: Int): FloatArray? {
        val extractor = MediaExtractor()
        return try {
            extractor.setDataSource(context, Uri.parse(uri), null)
            val trackIndex = (0 until extractor.trackCount).firstOrNull { index ->
                extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: return null

            val format = extractor.getTrackFormat(trackIndex)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: return null
            extractor.selectTrack(trackIndex)

            val codec = MediaCodec.createDecoderByType(mime)
            codec.configure(format, null, null, 0)
            codec.start()

            val samples = try {
                decodeToMono(extractor, codec)
            } finally {
                runCatching { codec.stop() }
                runCatching { codec.release() }
            }

            if (samples.isEmpty()) null else computeWaveformPeaks(samples, bucketCount)
        } catch (error: Exception) {
            null
        } finally {
            runCatching { extractor.release() }
        }
    }

    /**
     * Drains the codec, keeping only the first channel of every frame.
     *
     * A waveform strip draws a shape, not a stereo image, so a full-fidelity
     * downmix would spend decode time on precision the timeline throws away
     * at render size. [MAX_POLLS_WITHOUT_PROGRESS] guards against a
     * misbehaving codec that stops producing output without ever signalling
     * end-of-stream — this runs against arbitrary user-picked files, and a
     * clip that fails to draw a waveform is far better than one that hangs
     * the import.
     */
    private fun decodeToMono(extractor: MediaExtractor, codec: MediaCodec): ShortArray {
        val output = mutableListOf<Short>()
        val bufferInfo = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        var channelCount = 1
        var pollsWithoutProgress = 0

        while (!outputDone && pollsWithoutProgress < MAX_POLLS_WITHOUT_PROGRESS) {
            if (!inputDone) {
                val inputIndex = codec.dequeueInputBuffer(TIMEOUT_US)
                if (inputIndex >= 0) {
                    val inputBuffer = codec.getInputBuffer(inputIndex)
                    val sampleSize = inputBuffer?.let { extractor.readSampleData(it, 0) } ?: -1
                    if (sampleSize < 0) {
                        codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inputDone = true
                    } else {
                        codec.queueInputBuffer(inputIndex, 0, sampleSize, extractor.sampleTime, 0)
                        extractor.advance()
                    }
                }
            }

            val outputIndex = codec.dequeueOutputBuffer(bufferInfo, TIMEOUT_US)
            if (outputIndex >= 0) {
                pollsWithoutProgress = 0
                val outputFormat = codec.getOutputFormat(outputIndex)
                // The two-argument getInteger(key, default) needs API 29; the
                // single-argument, throwing overload is available since API 16,
                // so a missing key is handled with a catch instead.
                channelCount = runCatching { outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT) }
                    .getOrDefault(1)
                    .coerceAtLeast(1)

                val outputBuffer = codec.getOutputBuffer(outputIndex)
                if (outputBuffer != null && bufferInfo.size > 0) {
                    outputBuffer.order(ByteOrder.LITTLE_ENDIAN)
                    outputBuffer.position(bufferInfo.offset)
                    outputBuffer.limit(bufferInfo.offset + bufferInfo.size)
                    var frame = 0
                    while (outputBuffer.remaining() >= 2) {
                        val sample = outputBuffer.short
                        if (frame % channelCount == 0) output += sample
                        frame++
                    }
                }
                codec.releaseOutputBuffer(outputIndex, false)
                if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                    outputDone = true
                }
            } else {
                pollsWithoutProgress++
            }
        }

        return output.toShortArray()
    }

    /** Called when a project closes, and on trim-memory. */
    fun clear() {
        cache.evictAll()
    }

    private companion object {
        const val MAX_CACHED_WAVEFORMS = 64
        const val MAX_CONCURRENT_DECODES = 1
        const val TIMEOUT_US = 10_000L

        /**
         * ~10 seconds of unproductive polling at [TIMEOUT_US] per poll. Ordinary
         * decodes finish in a handful of polls; this is purely a hang guard.
         */
        const val MAX_POLLS_WITHOUT_PROGRESS = 1_000
    }
}
