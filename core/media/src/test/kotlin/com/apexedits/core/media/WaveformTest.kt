package com.apexedits.core.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure arithmetic, no Android dependency and no Robolectric needed — unlike
 * [WaveformExtractor] itself, which decodes real audio and cannot be
 * exercised on this host.
 */
class WaveformTest {

    @Test
    fun `an empty buffer produces no peaks`() {
        assertEquals(0, computeWaveformPeaks(ShortArray(0), 10).size)
    }

    @Test
    fun `a non-positive bucket count produces no peaks`() {
        assertEquals(0, computeWaveformPeaks(shortArrayOf(1, 2, 3), 0).size)
        assertEquals(0, computeWaveformPeaks(shortArrayOf(1, 2, 3), -5).size)
    }

    @Test
    fun `silence produces zero peaks`() {
        val silence = ShortArray(1000)
        val peaks = computeWaveformPeaks(silence, 10)
        assertEquals(10, peaks.size)
        assertTrue(peaks.all { it == 0f })
    }

    @Test
    fun `full-scale samples produce a peak at the top of the range`() {
        // Short.MAX_VALUE (32767) is one below the 32768 the normalisation
        // divides by, so this lands just under 1.0 rather than exactly at it.
        val loud = ShortArray(1000) { Short.MAX_VALUE }
        val peaks = computeWaveformPeaks(loud, 10)
        assertTrue(peaks.all { it in 0.999f..1f })
    }

    @Test
    fun `the minimum short value does not overflow the peak`() {
        // Short.MIN_VALUE's magnitude (32768) is one past Short.MAX_VALUE
        // (32767) — an unguarded abs() on a Short can overflow back to
        // negative. This must still normalise to exactly 1.0.
        val loudest = ShortArray(100) { Short.MIN_VALUE }
        val peaks = computeWaveformPeaks(loudest, 5)
        assertTrue(peaks.all { it == 1f })
    }

    @Test
    fun `a single loud sample in an otherwise silent bucket is not lost`() {
        // This is exactly why peak, not average, is used: an averaging
        // downsample would flatten a single transient toward zero.
        val samples = ShortArray(100)
        samples[50] = Short.MAX_VALUE
        val peaks = computeWaveformPeaks(samples, 10)
        // The spike falls in the sixth bucket (samples 50..59).
        assertEquals(1f, peaks[5], 0.001f)
        assertTrue("other buckets should stay silent", peaks.filterIndexed { i, _ -> i != 5 }.all { it == 0f })
    }

    @Test
    fun `bucket count matches the request regardless of sample count`() {
        assertEquals(7, computeWaveformPeaks(ShortArray(3), 7).size)
        assertEquals(7, computeWaveformPeaks(ShortArray(10_000), 7).size)
    }

    @Test
    fun `every sample is covered by exactly one bucket`() {
        // A sample count that does not divide evenly into the bucket count is
        // the common case, not an edge one — this must not drop a trailing
        // sample's contribution to the last bucket.
        val samples = ShortArray(97) { (it * 300).toShort() }
        val peaks = computeWaveformPeaks(samples, 10)
        val expectedLastPeak = (samples.takeLast(97 - (9 * 97 / 10)).maxOf { kotlin.math.abs(it.toInt()) }) / 32_768f
        assertEquals(expectedLastPeak, peaks.last(), 0.01f)
    }

    @Test
    fun `all peaks stay within 0 and 1`() {
        val samples = ShortArray(5_000) { ((it * 12_345) % 65536 - 32768).toShort() }
        val peaks = computeWaveformPeaks(samples, 50)
        assertTrue(peaks.all { it in 0f..1f })
    }
}
