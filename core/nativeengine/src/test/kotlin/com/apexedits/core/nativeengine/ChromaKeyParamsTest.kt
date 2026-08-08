package com.apexedits.core.nativeengine

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The packing contract.
 *
 * `pack()` and the native `params_from()` in `apex_jni.cpp` agree on field order
 * by convention, not by a shared type — that is the cost of a flat array boundary
 * (see `NativeEngine` for why it is a flat array at all). Nothing in the compiler
 * catches the two drifting apart, so the ordering is pinned here by index. A
 * reordering on either side without updating the other fails this test rather
 * than silently keying the wrong channel on a device.
 */
class ChromaKeyParamsTest {

    @Test
    fun `the packed array is exactly PACKED_SIZE long`() {
        assertEquals(ChromaKeyParams.PACKED_SIZE, ChromaKeyParams().pack().size)
    }

    @Test
    fun `field order matches apex_jni's params_from, index by index`() {
        val params = ChromaKeyParams(
            screenCb = 0.1f,
            screenCr = 0.2f,
            channel = ScreenChannel.BLUE,
            tolerance = 0.3f,
            softness = 0.4f,
            blackPoint = 0.5f,
            whitePoint = 0.6f,
            spillStrength = 0.7f,
            lumaLow = 0.8f,
            lumaHigh = 0.9f,
        )
        val packed = params.pack()

        // This ordering is duplicated in apex_jni.cpp's params_from(). Changing
        // either side alone is the bug this test exists to catch.
        assertEquals(0.1f, packed[0])            // screen.cb
        assertEquals(0.2f, packed[1])            // screen.cr
        assertEquals(1f, packed[2])              // channel — ScreenChannel.BLUE.ordinal
        assertEquals(0.3f, packed[3])            // tolerance
        assertEquals(0.4f, packed[4])            // softness
        assertEquals(0.5f, packed[5])            // black_point
        assertEquals(0.6f, packed[6])            // white_point
        assertEquals(0.7f, packed[7])            // spill_strength
        assertEquals(0.8f, packed[8])            // luma_low
        assertEquals(0.9f, packed[9])             // luma_high
        assertEquals(0f, packed[10])             // reserved
    }

    @Test
    fun `channel ordinals match the native ScreenChannel enum order`() {
        // apex::matte::ScreenChannel is `enum class ScreenChannel : uint8_t {
        // Green, Blue, Red }`. The Kotlin enum has to declare its constants in
        // the identical order, since only the ordinal crosses the boundary.
        assertEquals(0, ScreenChannel.GREEN.ordinal)
        assertEquals(1, ScreenChannel.BLUE.ordinal)
        assertEquals(2, ScreenChannel.RED.ordinal)
    }

    @Test
    fun `defaults match the C++ struct's in-class initialisers`() {
        // ChromaKeyParams{} on the C++ side defaults to pure green in the
        // luma-normalised chroma space — rgb_to_chroma(0, 255, 0). Keeping the
        // Kotlin default numerically equal means a caller who never touches the
        // picker gets the same key on both sides of the boundary.
        val defaults = ChromaKeyParams()
        assertEquals(-0.5389f, defaults.screenCb, 1e-6f)
        assertEquals(-0.6350f, defaults.screenCr, 1e-6f)
        assertEquals(0.15f, defaults.tolerance, 1e-6f)
        assertEquals(0.10f, defaults.softness, 1e-6f)
        assertEquals(ScreenChannel.GREEN, defaults.channel)
    }
}
