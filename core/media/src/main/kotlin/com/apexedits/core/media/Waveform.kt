package com.apexedits.core.media

import kotlin.math.abs

/**
 * Downsamples mono 16-bit PCM to one peak amplitude per bucket, for drawing a
 * waveform strip.
 *
 * Peak rather than average: audio wiggles far faster than any zoom level can
 * draw individual samples, and averaging a loud, fast passage would flatten
 * it toward zero — a waveform is supposed to show *how loud it gets*, and a
 * peak is what answers that.
 *
 * Pure arithmetic on a [ShortArray], with no Android dependency, so it is
 * fully verifiable on the JVM even though nothing can decode real audio into
 * that array on this host.
 */
fun computeWaveformPeaks(samples: ShortArray, bucketCount: Int): FloatArray {
    if (bucketCount <= 0 || samples.isEmpty()) return FloatArray(0)

    val peaks = FloatArray(bucketCount)
    val samplesPerBucket = samples.size.toDouble() / bucketCount

    for (bucket in 0 until bucketCount) {
        val start = (bucket * samplesPerBucket).toInt()
        val end = (((bucket + 1) * samplesPerBucket).toInt())
            .coerceAtMost(samples.size)
            .coerceAtLeast(start + 1)

        var peak = 0
        for (i in start until end.coerceAtMost(samples.size)) {
            val magnitude = abs(samples[i].toInt())
            if (magnitude > peak) peak = magnitude
        }
        peaks[bucket] = (peak / 32_768f).coerceIn(0f, 1f)
    }

    return peaks
}
