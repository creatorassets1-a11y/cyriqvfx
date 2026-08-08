package com.apexedits.core.model

import kotlinx.serialization.Serializable
import kotlin.math.roundToLong

/**
 * The timebase.
 *
 * Every position and duration in an ApexEdits document is an integer count of
 * ticks at 705,600,000 per second. The base is chosen so that a single frame at
 * every rate the PRD supports is a whole number of ticks:
 *
 *     24 fps        → 29,400,000        25 fps → 28,224,000
 *     30 fps        → 23,520,000        50 fps → 14,112,000
 *     60 fps        → 11,760,000
 *     24000/1001    → 29,429,400        30000/1001 → 23,543,520
 *     60000/1001    → 11,771,760
 *
 * and so is one audio sample at both common rates (44,100 Hz → 16,000 ticks;
 * 48,000 Hz → 14,700 ticks).
 *
 * The consequence is that frame accuracy is a property of the representation
 * rather than something the editing code has to defend. Rounding never
 * accumulates across a split, a retime and a trim, because there is nothing to
 * round: the arithmetic is exact.
 */
const val TICKS_PER_SECOND: Long = 705_600_000L

/**
 * A point in time, or a length of time, measured in [TICKS_PER_SECOND] ticks.
 *
 * A value class, so the whole document pays no boxing cost for using a distinct
 * type instead of a bare `Long`.
 */
@JvmInline
@Serializable
value class Ticks(val raw: Long) : Comparable<Ticks> {

    operator fun plus(other: Ticks) = Ticks(raw + other.raw)

    operator fun minus(other: Ticks) = Ticks(raw - other.raw)

    operator fun times(scalar: Long) = Ticks(raw * scalar)

    operator fun unaryMinus() = Ticks(-raw)

    override fun compareTo(other: Ticks): Int = raw.compareTo(other.raw)

    val isPositive: Boolean get() = raw > 0

    val isZero: Boolean get() = raw == 0L

    fun coerceIn(min: Ticks, max: Ticks) = Ticks(raw.coerceIn(min.raw, max.raw))

    fun coerceAtLeast(min: Ticks) = Ticks(raw.coerceAtLeast(min.raw))

    fun coerceAtMost(max: Ticks) = Ticks(raw.coerceAtMost(max.raw))

    fun toSeconds(): Double = raw.toDouble() / TICKS_PER_SECOND

    fun toMillis(): Long = raw / (TICKS_PER_SECOND / 1000)

    /**
     * Microseconds, the unit Media3 speaks.
     *
     * There are 705.6 ticks in a microsecond, which is *not* a whole number, so
     * the conversion has to go through the exact fraction 3528/5. Dividing by an
     * integer 705 instead loses 0.085% — twenty-eight milliseconds across a
     * thirty-second clip, nearly a frame — and it compounds, because this is the
     * conversion every animated property goes through on every frame.
     */
    fun toMicros(): Long = raw * MICRO_DENOMINATOR / MICRO_NUMERATOR

    companion object {
        /**
         * TICKS_PER_SECOND / 1,000,000 = 705.6, held exactly as 3528/5.
         *
         * Multiplying before dividing keeps it exact and still leaves headroom
         * for timelines far longer than anyone will edit on a phone.
         */
        private const val MICRO_NUMERATOR = 3528L
        private const val MICRO_DENOMINATOR = 5L

        val ZERO = Ticks(0)
        val MAX = Ticks(Long.MAX_VALUE / 4)

        fun ofSeconds(seconds: Double) = Ticks((seconds * TICKS_PER_SECOND).roundToLong())

        fun ofMillis(millis: Long) = Ticks(millis * (TICKS_PER_SECOND / 1000))

        /** See [toMicros]: 705.6 ticks per microsecond, as 3528/5. */
        fun ofMicros(micros: Long) = Ticks(micros * MICRO_NUMERATOR / MICRO_DENOMINATOR)
    }
}

/**
 * A frame rate as an exact rational, so the NTSC rates stay exact instead of
 * becoming 29.97 and drifting a frame every thousand.
 */
@Serializable
data class FrameRate(val numerator: Int, val denominator: Int = 1) {

    init {
        require(numerator > 0 && denominator > 0) {
            "Frame rate must be positive, got $numerator/$denominator"
        }
    }

    /** Ticks in one frame. Exact for every rate in [ALL]. */
    val ticksPerFrame: Ticks
        get() = Ticks(TICKS_PER_SECOND * denominator / numerator)

    val approximateFps: Double get() = numerator.toDouble() / denominator

    /** The frame index containing [time], counting from zero. */
    fun frameAt(time: Ticks): Long = time.raw / ticksPerFrame.raw

    /** The start of frame [index]. */
    fun timeOfFrame(index: Long): Ticks = Ticks(index * ticksPerFrame.raw)

    /** [time] snapped down to the start of the frame that contains it. */
    fun snapToFrame(time: Ticks): Ticks = timeOfFrame(frameAt(time))

    /** [time] snapped to the nearest frame boundary in either direction. */
    fun roundToFrame(time: Ticks): Ticks {
        val per = ticksPerFrame.raw
        return Ticks((time.raw + per / 2) / per * per)
    }

    val label: String
        get() = if (denominator == 1) "$numerator fps"
        else String.format("%.2f fps", approximateFps)

    companion object {
        val FPS_24 = FrameRate(24)
        val FPS_25 = FrameRate(25)
        val FPS_30 = FrameRate(30)
        val FPS_50 = FrameRate(50)
        val FPS_60 = FrameRate(60)
        val FPS_23_976 = FrameRate(24_000, 1001)
        val FPS_29_97 = FrameRate(30_000, 1001)
        val FPS_59_94 = FrameRate(60_000, 1001)

        /** Offered in the New Project dialog, in this order. */
        val ALL = listOf(FPS_24, FPS_25, FPS_30, FPS_50, FPS_60, FPS_23_976, FPS_29_97, FPS_59_94)
    }
}

/** Formats [time] as `H:MM:SS:FF`, or `MM:SS:FF` under an hour. */
fun formatTimecode(time: Ticks, rate: FrameRate): String {
    val negative = time.raw < 0
    val abs = Ticks(kotlin.math.abs(time.raw))
    val totalFrames = rate.frameAt(abs)
    val framesPerSecond = kotlin.math.ceil(rate.approximateFps).toLong()
    val frames = totalFrames % framesPerSecond
    val totalSeconds = totalFrames / framesPerSecond
    val seconds = totalSeconds % 60
    val minutes = (totalSeconds / 60) % 60
    val hours = totalSeconds / 3600
    val sign = if (negative) "-" else ""
    return if (hours > 0) {
        String.format("%s%d:%02d:%02d:%02d", sign, hours, minutes, seconds, frames)
    } else {
        String.format("%s%02d:%02d:%02d", sign, minutes, seconds, frames)
    }
}
