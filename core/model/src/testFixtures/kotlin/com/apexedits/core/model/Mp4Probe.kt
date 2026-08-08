package com.apexedits.core.model

import java.io.File
import java.io.RandomAccessFile

/**
 * A minimal MP4 box reader, for tests only.
 *
 * This exists for one job: to check that [SampleVideo]'s constants still describe
 * the file they were taken from. Without it those numbers are a claim nobody can
 * verify — and a fixture that has quietly drifted from reality is worse than no
 * fixture, because every test built on it keeps passing while testing the wrong
 * thing.
 *
 * It is deliberately not production code. The app reads media through
 * `MediaMetadataRetriever`, which is the platform's own parser; duplicating that
 * for real would be a liability. This reads only the handful of boxes the
 * assertions need and gives up on anything unusual.
 */
object Mp4Probe {

    data class Info(
        val sizeBytes: Long,
        val movieTimescale: Int,
        val movieDurationUnits: Long,
        val tracks: List<TrackInfo>,
    ) {
        val durationMs: Long get() = movieDurationUnits * 1000 / movieTimescale

        val video: TrackInfo? get() = tracks.firstOrNull { it.handler == "vide" }
        val audio: TrackInfo? get() = tracks.firstOrNull { it.handler == "soun" }
    }

    data class TrackInfo(
        val handler: String,
        val timescale: Int,
        val durationUnits: Long,
        val width: Int,
        val height: Int,
        /** Total decoded samples: frames for video, PCM frames for audio. */
        val sampleCount: Long,
        /** Sum of `stts` deltas — the track's length in its own timescale. */
        val sampleDurationUnits: Long,
    ) {
        val durationMs: Long get() = durationUnits * 1000 / timescale

        /** Frames per second, from the samples actually present. */
        val frameRate: Double
            get() = if (sampleDurationUnits == 0L) 0.0
            else sampleCount.toDouble() * timescale / sampleDurationUnits
    }

    fun read(file: File): Info = RandomAccessFile(file, "r").use { raf ->
        val bytes = ByteArray(raf.length().toInt().coerceAtMost(MAX_HEADER_BYTES))
        raf.readFully(bytes)
        parse(bytes, file.length())
    }

    private fun parse(data: ByteArray, fileSize: Long): Info {
        var movieTimescale = 1000
        var movieDuration = 0L
        val tracks = mutableListOf<TrackInfo>()

        // Per-track state, reset at each `trak`.
        var handler = ""
        var timescale = 0
        var duration = 0L
        var width = 0
        var height = 0
        var sampleCount = 0L
        var sampleDuration = 0L
        var inTrack = false

        fun flushTrack() {
            if (inTrack) {
                tracks += TrackInfo(handler, timescale, duration, width, height, sampleCount, sampleDuration)
            }
            handler = ""; timescale = 0; duration = 0; width = 0; height = 0
            sampleCount = 0; sampleDuration = 0
        }

        fun walk(start: Int, end: Int) {
            var offset = start
            while (offset + 8 <= end) {
                val size = data.int(offset)
                val type = String(data, offset + 4, 4, Charsets.ISO_8859_1)
                var header = 8
                val boxSize = when {
                    size == 1L -> { header = 16; data.long(offset + 8) }
                    size == 0L -> (end - offset).toLong()
                    else -> size
                }
                if (boxSize < 8) return
                val boxEnd = (offset + boxSize).toInt().coerceAtMost(end)

                when (type) {
                    "moov", "mdia", "minf", "stbl" -> walk(offset + header, boxEnd)

                    "trak" -> {
                        flushTrack()
                        inTrack = true
                        walk(offset + header, boxEnd)
                    }

                    "mvhd" -> {
                        val version = data[offset + 8].toInt()
                        if (version == 0) {
                            movieTimescale = data.int(offset + 20).toInt()
                            movieDuration = data.int(offset + 24)
                        } else {
                            movieTimescale = data.int(offset + 28).toInt()
                            movieDuration = data.long(offset + 32)
                        }
                    }

                    "tkhd" -> {
                        val version = data[offset + 8].toInt()
                        // Fixed-point 16.16 width and height sit at the end of the box.
                        width = (data.int(boxEnd - 8) shr 16).toInt()
                        height = (data.int(boxEnd - 4) shr 16).toInt()
                        if (version == 0) Unit else Unit
                    }

                    "mdhd" -> {
                        val version = data[offset + 8].toInt()
                        if (version == 0) {
                            timescale = data.int(offset + 20).toInt()
                            duration = data.int(offset + 24)
                        } else {
                            timescale = data.int(offset + 28).toInt()
                            duration = data.long(offset + 32)
                        }
                    }

                    "hdlr" -> handler = String(data, offset + 16, 4, Charsets.ISO_8859_1)

                    "stts" -> {
                        val entries = data.int(offset + 12).toInt()
                        for (i in 0 until entries) {
                            val base = offset + 16 + i * 8
                            if (base + 8 > boxEnd) break
                            val count = data.int(base)
                            val delta = data.int(base + 4)
                            sampleCount += count
                            sampleDuration += count * delta
                        }
                    }
                }
                offset = boxEnd
                if (boxSize <= 0) return
            }
        }

        walk(0, data.size)
        flushTrack()

        return Info(fileSize, movieTimescale, movieDuration, tracks)
    }

    private fun ByteArray.int(at: Int): Long =
        ((this[at].toLong() and 0xFF) shl 24) or
            ((this[at + 1].toLong() and 0xFF) shl 16) or
            ((this[at + 2].toLong() and 0xFF) shl 8) or
            (this[at + 3].toLong() and 0xFF)

    private fun ByteArray.long(at: Int): Long = (int(at) shl 32) or int(at + 4)

    /**
     * How much of the file to read. `moov` sits at the front of a
     * progressive-download MP4, which every camera and encoder produces; a file
     * with it at the end simply yields no tracks and the assertions skip.
     */
    private const val MAX_HEADER_BYTES = 2 * 1024 * 1024
}
