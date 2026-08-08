package com.apexedits.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The timebase claim is that a frame at every supported rate, and a sample at
 * both audio rates, is a whole number of ticks. If that stops being true the
 * whole frame-accuracy argument collapses, so it is asserted rather than
 * asserted-in-a-comment.
 */
class TimeTest {

    @Test
    fun `every supported frame rate divides the tick base exactly`() {
        for (rate in FrameRate.ALL) {
            val remainder = TICKS_PER_SECOND * rate.denominator % rate.numerator
            assertEquals("${rate.label} does not divide the tick base", 0L, remainder)
        }
    }

    @Test
    fun `both audio sample rates divide the tick base exactly`() {
        assertEquals(0L, TICKS_PER_SECOND % 44_100)
        assertEquals(0L, TICKS_PER_SECOND % 48_000)
    }

    @Test
    fun `ntsc rates are exact rather than approximated`() {
        assertEquals(23_543_520L, FrameRate.FPS_29_97.ticksPerFrame.raw)
        assertEquals(29_429_400L, FrameRate.FPS_23_976.ticksPerFrame.raw)
        // 30000/1001 fps really is slightly slower than 30 fps.
        assertTrue(FrameRate.FPS_29_97.ticksPerFrame > FrameRate.FPS_30.ticksPerFrame)
    }

    @Test
    fun `one second holds exactly the nominal number of frames`() {
        val second = Ticks(TICKS_PER_SECOND)
        assertEquals(24L, FrameRate.FPS_24.frameAt(second))
        assertEquals(30L, FrameRate.FPS_30.frameAt(second))
        assertEquals(60L, FrameRate.FPS_60.frameAt(second))
    }

    @Test
    fun `frame arithmetic does not drift over an hour`() {
        // The failure this guards against is the classic one: a float seconds
        // representation accumulating error until an hour-long timeline is off
        // by a frame or two at the end.
        val rate = FrameRate.FPS_29_97
        val oneHourOfFrames = 107_892L // 29.97 fps × 3600 s
        val end = rate.timeOfFrame(oneHourOfFrames)
        assertEquals(oneHourOfFrames, rate.frameAt(end))
        assertEquals(end, rate.snapToFrame(end))
    }

    @Test
    fun `snapping moves down and rounding moves to the nearer boundary`() {
        val rate = FrameRate.FPS_30
        val justPastFrameFive = rate.timeOfFrame(5) + Ticks(1000)
        assertEquals(rate.timeOfFrame(5), rate.snapToFrame(justPastFrameFive))

        val nearlyFrameSix = rate.timeOfFrame(6) - Ticks(1000)
        assertEquals(rate.timeOfFrame(6), rate.roundToFrame(nearlyFrameSix))
    }

    @Test
    fun `timecode formats as hours minutes seconds frames`() {
        val rate = FrameRate.FPS_30
        val t = Ticks.ofSeconds(3661.0) + rate.ticksPerFrame * 7
        assertEquals("1:01:01:07", formatTimecode(t, rate))
        assertEquals("00:00:00", formatTimecode(Ticks.ZERO, rate))
    }

    @Test
    fun `aspect ratios produce even widths for codec friendliness`() {
        for (aspect in AspectRatio.entries) {
            assertEquals("${aspect.displayName} width is odd", 0, aspect.widthFor(1080) % 2)
        }
    }

    @Test
    fun `every aspect ratio carries plain language guidance`() {
        // The New Project dialog is required to explain each option rather than
        // just showing a ratio, so the copy has to exist on the value itself.
        for (aspect in AspectRatio.entries) {
            assertTrue(aspect.displayName.isNotBlank())
            assertTrue("${aspect.name} guidance too short", aspect.guidance.length > 20)
        }
    }
}
