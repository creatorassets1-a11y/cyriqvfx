package com.apexedits.core.media

import com.apexedits.core.model.ColorAdjustment
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure matrix arithmetic — no Android dependency, so unlike the GLSL shaders
 * this drives, it is fully verifiable on the JVM. The matrix layout itself
 * (column-major, translation in the last column) was confirmed by
 * decompiling Media3's own shipped Contrast and RgbAdjustment effects, not
 * assumed; see KeyframedColorMatrix's class doc.
 */
class ColorMatrixTest {

    /** Applies a column-major 4x4 matrix to a homogeneous (r, g, b, 1) vector. */
    private fun FloatArray.apply(r: Float, g: Float, b: Float): Triple<Float, Float, Float> {
        val v = floatArrayOf(r, g, b, 1f)
        val out = FloatArray(4)
        for (row in 0 until 4) {
            var sum = 0f
            for (col in 0 until 4) sum += this[col * 4 + row] * v[col]
            out[row] = sum
        }
        return Triple(out[0], out[1], out[2])
    }

    @Test
    fun `identity4x4 is the identity`() {
        val m = identity4x4()
        val (r, g, b) = m.apply(0.3f, 0.5f, 0.8f)
        assertEquals(0.3f, r, 0.0001f)
        assertEquals(0.5f, g, 0.0001f)
        assertEquals(0.8f, b, 0.0001f)
    }

    @Test
    fun `multiply4x4 composes two matrices left after right`() {
        // Two independent scales composed should equal one combined scale.
        val double = FloatArray(16).also { it[0] = 2f; it[5] = 2f; it[10] = 2f; it[15] = 1f }
        val triple = FloatArray(16).also { it[0] = 3f; it[5] = 3f; it[10] = 3f; it[15] = 1f }
        val combined = multiply4x4(double, triple)

        val (r, g, b) = combined.apply(1f, 1f, 1f)
        assertEquals(6f, r, 0.0001f)
        assertEquals(6f, g, 0.0001f)
        assertEquals(6f, b, 0.0001f)
    }

    @Test
    fun `default adjustment is approximately the identity`() {
        // Contrast's own formula lands a hair short of exact identity at c=0
        // (the 1.0001 denominator that avoids a divide-by-zero at c=1), so
        // this is a tolerance check, not an exact one.
        val (r, g, b) = colorMatrix(ColorAdjustment()).apply(0.3f, 0.5f, 0.8f)
        assertEquals(0.3f, r, 0.001f)
        assertEquals(0.5f, g, 0.001f)
        assertEquals(0.8f, b, 0.001f)
    }

    @Test
    fun `exposure doubles every channel at plus one stop`() {
        val (r, g, b) = exposureMatrix(1f).apply(0.2f, 0.3f, 0.4f)
        assertEquals(0.4f, r, 0.0001f)
        assertEquals(0.6f, g, 0.0001f)
        assertEquals(0.8f, b, 0.0001f)
    }

    @Test
    fun `exposure halves every channel at minus one stop`() {
        val (r, _, _) = exposureMatrix(-1f).apply(0.4f, 0.4f, 0.4f)
        assertEquals(0.2f, r, 0.0001f)
    }

    @Test
    fun `zero exposure is a no-op`() {
        val (r, g, b) = exposureMatrix(0f).apply(0.1f, 0.6f, 0.9f)
        assertEquals(0.1f, r, 0.0001f)
        assertEquals(0.6f, g, 0.0001f)
        assertEquals(0.9f, b, 0.0001f)
    }

    @Test
    fun `contrast pivots around mid-grey rather than shifting brightness`() {
        // Mid-grey should be (approximately) unchanged by any contrast value,
        // since the whole point of a pivot is that it does not move.
        for (c in listOf(-0.5f, 0.5f, 0.9f)) {
            val (r, _, _) = contrastMatrix(c).apply(0.5f, 0.5f, 0.5f)
            assertEquals("contrast $c moved mid-grey", 0.5f, r, 0.001f)
        }
    }

    @Test
    fun `positive contrast pushes a light value lighter`() {
        val (r, _, _) = contrastMatrix(0.8f).apply(0.7f, 0.7f, 0.7f)
        assertTrue("expected $r > 0.7", r > 0.7f)
    }

    @Test
    fun `negative contrast pulls a light value toward grey`() {
        val (r, _, _) = contrastMatrix(-0.8f).apply(0.7f, 0.7f, 0.7f)
        assertTrue("expected $r < 0.7", r < 0.7f)
    }

    @Test
    fun `saturation zero produces equal rgb from any input`() {
        val (r, g, b) = saturationMatrix(0f).apply(0.9f, 0.2f, 0.5f)
        assertEquals(r, g, 0.0001f)
        assertEquals(g, b, 0.0001f)
    }

    @Test
    fun `saturation one is a no-op`() {
        val (r, g, b) = saturationMatrix(1f).apply(0.9f, 0.2f, 0.5f)
        assertEquals(0.9f, r, 0.0001f)
        assertEquals(0.2f, g, 0.0001f)
        assertEquals(0.5f, b, 0.0001f)
    }

    @Test
    fun `saturation preserves a neutral grey`() {
        for (s in listOf(0f, 0.5f, 1.5f, 2f)) {
            val (r, g, b) = saturationMatrix(s).apply(0.4f, 0.4f, 0.4f)
            assertEquals("saturation $s red", 0.4f, r, 0.001f)
            assertEquals("saturation $s green", 0.4f, g, 0.001f)
            assertEquals("saturation $s blue", 0.4f, b, 0.001f)
        }
    }

    @Test
    fun `zero temperature and tint is a no-op`() {
        val (r, g, b) = temperatureTintMatrix(0f, 0f).apply(0.3f, 0.6f, 0.9f)
        assertEquals(0.3f, r, 0.0001f)
        assertEquals(0.6f, g, 0.0001f)
        assertEquals(0.9f, b, 0.0001f)
    }

    @Test
    fun `positive temperature warms the image, boosting red over blue`() {
        val (r, _, b) = temperatureTintMatrix(1f, 0f).apply(0.5f, 0.5f, 0.5f)
        assertTrue("expected red $r > blue $b when warmer", r > b)
    }

    @Test
    fun `negative temperature cools the image, boosting blue over red`() {
        val (r, _, b) = temperatureTintMatrix(-1f, 0f).apply(0.5f, 0.5f, 0.5f)
        assertTrue("expected blue $b > red $r when cooler", b > r)
    }

    @Test
    fun `positive tint shifts toward magenta, reducing green relative to red and blue`() {
        val (r, g, b) = temperatureTintMatrix(0f, 1f).apply(0.5f, 0.5f, 0.5f)
        assertTrue(g < r)
        assertTrue(g < b)
    }

    @Test
    fun `channel scales never go negative`() {
        // Extreme combined values must clamp rather than flip a channel's sign.
        val (r, g, b) = temperatureTintMatrix(-1f, -1f).apply(1f, 1f, 1f)
        assertTrue(r >= 0f)
        assertTrue(g >= 0f)
        assertTrue(b >= 0f)
    }

    @Test
    fun `colorMatrix composes all five adjustments in one pass`() {
        val adjustment = ColorAdjustment(
            exposure = 1f,
            contrast = 0.5f,
            saturation = 0f,
            temperature = 0f,
            tint = 0f,
        )
        // Exposure doubles 0.3 to 0.6, contrast then pivots it around 0.5,
        // saturation then greys it out - composed in one matrix rather than
        // three separate passes over the frame.
        val expected = contrastMatrix(0.5f).apply(0.6f, 0.6f, 0.6f)
        val actual = colorMatrix(adjustment).apply(0.3f, 0.3f, 0.3f)
        assertEquals(expected.first, actual.first, 0.001f)
    }
}
