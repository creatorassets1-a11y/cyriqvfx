package com.apexedit.editor.core

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.roundToLong

/**
 * Frame-accurate time.
 *
 * Editorial maths runs on an integer tick base, never on floats or on
 * microseconds. 705_600_000 ticks per second is chosen so one frame at every
 * supported rate — including the NTSC /1001 rates — and one sample at both
 * 44.1 and 48 kHz land on exact integers:
 *
 *   705600000 / 24            = 29_400_000
 *   705600000 / 25            = 28_224_000
 *   705600000 / 30            = 23_520_000
 *   705600000 / 60            = 11_760_000
 *   705600000 / (30000/1001)  = 23_543_520
 *   705600000 / 48000         = 14_700
 *
 * Media3 speaks microseconds, so [ticksToUs] and [usToTicks] convert at that
 * boundary and nowhere else. Doing editorial arithmetic in microseconds is how
 * cuts end up a frame off at 29.97.
 */
object Time {
    const val TICKS_PER_SECOND: Long = 705_600_000L
    const val US_PER_SECOND: Long = 1_000_000L

    /**
     * 705_600_000 / 1_000_000 is 705.6, so the conversion is scaled by ten to
     * stay in integer arithmetic. At three hours this peaks around 7.6e13 —
     * comfortably inside Long.
     */
    fun ticksToUs(ticks: Long): Long = (ticks * 10L) / 7056L

    fun usToTicks(us: Long): Long = (us * 7056L) / 10L

    fun ticksToMs(ticks: Long): Long = ticksToUs(ticks) / 1000L

    fun msToTicks(ms: Long): Long = usToTicks(ms * 1000L)

    fun secondsToTicks(seconds: Double): Long = (seconds * TICKS_PER_SECOND).roundToLong()

    fun ticksToSeconds(ticks: Long): Double = ticks.toDouble() / TICKS_PER_SECOND
}

/** A frame rate expressed exactly, as a rational. */
data class FrameRate(
    val num: Int,
    val den: Int,
    /** Only meaningful for the /1001 rates; ignored otherwise. */
    val dropFrame: Boolean = false,
) {
    val fps: Double get() = num.toDouble() / den

    /** Exact ticks in one frame. */
    val ticksPerFrame: Long
        get() {
            val exact = Time.TICKS_PER_SECOND * den / num
            require(Time.TICKS_PER_SECOND * den % num == 0L) {
                "Frame rate $num/$den does not divide the tick base exactly"
            }
            return exact
        }

    /** Nominal integer rate used for timecode counting: 30 for 29.97. */
    val nominal: Int get() = Math.round(fps).toInt()

    companion object {
        val FPS_23_976 = FrameRate(24000, 1001)
        val FPS_24 = FrameRate(24, 1)
        val FPS_25 = FrameRate(25, 1)
        val FPS_29_97 = FrameRate(30000, 1001, dropFrame = true)
        val FPS_30 = FrameRate(30, 1)
        val FPS_50 = FrameRate(50, 1)
        val FPS_59_94 = FrameRate(60000, 1001, dropFrame = true)
        val FPS_60 = FrameRate(60, 1)

        val ALL = listOf(
            FPS_23_976, FPS_24, FPS_25, FPS_29_97, FPS_30, FPS_50, FPS_59_94, FPS_60,
        )

        /** Closest supported rate to a measured one, for imported media. */
        fun nearest(fps: Float): FrameRate =
            ALL.minByOrNull { abs(it.fps - fps) } ?: FPS_30
    }
}

fun Long.framesToTicks(rate: FrameRate): Long = this * rate.ticksPerFrame

fun Long.ticksToFrames(rate: FrameRate): Long = floorDiv(rate.ticksPerFrame)

/** Snap down to the frame boundary containing this position. */
fun Long.floorToFrame(rate: FrameRate): Long {
    val tpf = rate.ticksPerFrame
    return floorDiv(tpf) * tpf
}

/** Snap to the nearest frame boundary. */
fun Long.roundToFrame(rate: FrameRate): Long {
    val tpf = rate.ticksPerFrame
    return ((this + tpf / 2).floorDiv(tpf)) * tpf
}

fun Long.ceilToFrame(rate: FrameRate): Long {
    val tpf = rate.ticksPerFrame
    return ((this + tpf - 1).floorDiv(tpf)) * tpf
}

fun Long.isOnFrame(rate: FrameRate): Boolean = this % rate.ticksPerFrame == 0L

data class TimecodeParts(
    val hours: Int,
    val minutes: Int,
    val seconds: Int,
    val frames: Int,
    val negative: Boolean,
)

/**
 * SMPTE timecode with real drop-frame counting: the first two frame numbers of
 * every minute are skipped except on minutes divisible by ten, which is what
 * keeps a 29.97 timeline aligned with wall time.
 */
fun Long.toTimecodeParts(rate: FrameRate): TimecodeParts {
    val negative = this < 0
    val frameIndex = abs(this).ticksToFrames(rate)
    val nominal = rate.nominal

    if (rate.dropFrame && rate.den == 1001) {
        val dropPerMinute = when (nominal) {
            30 -> 2
            60 -> 4
            else -> 0
        }
        if (dropPerMinute > 0) {
            val framesPer10Min = nominal * 60L * 10L - dropPerMinute * 9L
            val framesPerMin = nominal * 60L - dropPerMinute

            val tenMinBlocks = frameIndex / framesPer10Min
            var rem = frameIndex % framesPer10Min

            // The first minute of each ten-minute block drops nothing.
            var minutesInBlock = 0L
            if (rem >= nominal * 60L) {
                rem -= nominal * 60L
                minutesInBlock = 1 + rem / framesPerMin
                rem %= framesPerMin
                rem += dropPerMinute // re-add the skipped frame numbers
            }

            val totalMinutes = tenMinBlocks * 10 + minutesInBlock
            return TimecodeParts(
                hours = (totalMinutes / 60).toInt(),
                minutes = (totalMinutes % 60).toInt(),
                seconds = (rem / nominal).toInt(),
                frames = (rem % nominal).toInt(),
                negative = negative,
            )
        }
    }

    return TimecodeParts(
        hours = (frameIndex / (nominal * 3600L)).toInt(),
        minutes = ((frameIndex / (nominal * 60L)) % 60).toInt(),
        seconds = ((frameIndex / nominal) % 60).toInt(),
        frames = (frameIndex % nominal).toInt(),
        negative = negative,
    )
}

private fun pad2(n: Int) = n.toString().padStart(2, '0')

/** `01:23:45:12`, or `01:23:45;12` for drop-frame. */
fun Long.formatTimecode(rate: FrameRate): String {
    val p = toTimecodeParts(rate)
    val sep = if (rate.dropFrame && rate.den == 1001) ';' else ':'
    val sign = if (p.negative) "-" else ""
    return "$sign${pad2(p.hours)}:${pad2(p.minutes)}:${pad2(p.seconds)}$sep${pad2(p.frames)}"
}

/** Compact `1:23.4` for the timeline ruler, where SMPTE is too dense to read. */
fun Long.formatDuration(tenths: Boolean = false): String {
    val total = Time.ticksToSeconds(this).coerceAtLeast(0.0)
    val h = floor(total / 3600).toInt()
    val m = floor(total / 60).toInt() % 60
    val s = floor(total).toInt() % 60
    val base = if (h > 0) "$h:${pad2(m)}:${pad2(s)}" else "$m:${pad2(s)}"
    return if (tenths) "$base.${floor((total % 1) * 10).toInt()}" else base
}

/** Half-open interval `[start, start + duration)`. */
data class TimeRange(val start: Long, val duration: Long) {
    val end: Long get() = start + duration

    fun contains(t: Long): Boolean = t in start until end

    fun overlaps(other: TimeRange): Boolean = start < other.end && other.start < end

    fun intersect(other: TimeRange): TimeRange? {
        val s = maxOf(start, other.start)
        val e = minOf(end, other.end)
        return if (e > s) TimeRange(s, e - s) else null
    }
}
