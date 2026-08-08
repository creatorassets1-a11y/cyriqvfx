package com.apexedits.core.engine.animation

import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.BezierHandles
import com.apexedits.core.model.Clip
import com.apexedits.core.model.Easing
import com.apexedits.core.model.PropertyTrack
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.Transform
import kotlin.math.abs

/**
 * Evaluating keyframes.
 *
 * This runs once per animated property per rendered frame, so it is the one part
 * of the engine where constant factors matter. Two consequences shape the code:
 * the keyframe list is kept sorted so lookup is a binary search rather than a
 * scan, and the bezier solve is a bounded Newton–Raphson with a bisection
 * fallback instead of an unbounded loop.
 */

/**
 * The value of [track] at [timeInClip], measured from the start of the clip.
 *
 * Outside the keyframed range the value **holds** at the nearest keyframe rather
 * than extrapolating. Extrapolation past the last keyframe is never what an
 * editor means — it would send a scale animation off to infinity over a long
 * clip — and every NLE holds instead.
 */
fun evaluate(track: PropertyTrack, timeInClip: Ticks, fallback: Float): Float {
    val keyframes = track.keyframes
    if (keyframes.isEmpty()) return fallback
    if (keyframes.size == 1) return keyframes[0].value

    val first = keyframes.first()
    val last = keyframes.last()
    if (timeInClip <= first.time) return first.value
    if (timeInClip >= last.time) return last.value

    // Binary search for the segment containing timeInClip. `index` lands on the
    // first keyframe strictly after the time, so the segment is [index-1, index].
    var low = 0
    var high = keyframes.size - 1
    while (low < high) {
        val mid = (low + high) / 2
        if (keyframes[mid].time <= timeInClip) low = mid + 1 else high = mid
    }
    val from = keyframes[low - 1]
    val to = keyframes[low]

    // Hold leaves the value flat until the next keyframe, then jumps. Checked
    // before the span guard so a zero-length hold still behaves.
    if (from.easing == Easing.HOLD) return from.value

    val span = (to.time - from.time).raw
    if (span <= 0L) return to.value

    val linearProgress = (timeInClip - from.time).raw.toDouble() / span
    val eased = from.effectiveHandles
        ?.let { solveBezier(it, linearProgress) }
        ?: linearProgress

    return (from.value + (to.value - from.value) * eased).toFloat()
}

/**
 * The eased progress for a cubic bezier timing curve at linear progress [x].
 *
 * The curve runs (0,0) → (h.x1,h.y1) → (h.x2,h.y2) → (1,1). The catch is that
 * the curve is parameterised by `t`, not by time: we know x and need y, so `t`
 * has to be recovered from x first. That is the same problem CSS timing
 * functions solve, and the same method applies — Newton–Raphson where the
 * derivative is well behaved, bisection where it is not.
 */
internal fun solveBezier(handles: BezierHandles, x: Double): Double {
    if (x <= 0.0) return 0.0
    if (x >= 1.0) return 1.0

    val t = solveForT(handles.x1.toDouble(), handles.x2.toDouble(), x)
    return bezierAxis(handles.y1.toDouble(), handles.y2.toDouble(), t)
}

/** One axis of the curve at parameter [t]. Control points are 0, [p1], [p2], 1. */
private fun bezierAxis(p1: Double, p2: Double, t: Double): Double {
    val inverse = 1.0 - t
    // Expanded cubic Bernstein form with the first and last control points at
    // 0 and 1, so two of the four terms drop out.
    return 3.0 * inverse * inverse * t * p1 +
        3.0 * inverse * t * t * p2 +
        t * t * t
}

/** d(x)/dt, used by the Newton step. */
private fun bezierAxisDerivative(p1: Double, p2: Double, t: Double): Double {
    val inverse = 1.0 - t
    return 3.0 * inverse * inverse * p1 +
        6.0 * inverse * t * (p2 - p1) +
        3.0 * t * t * (1.0 - p2)
}

private fun solveForT(x1: Double, x2: Double, targetX: Double): Double {
    var t = targetX // A good first guess: for a near-linear curve it is the answer.

    repeat(NEWTON_ITERATIONS) {
        val error = bezierAxis(x1, x2, t) - targetX
        if (abs(error) < TOLERANCE) return t
        val slope = bezierAxisDerivative(x1, x2, t)
        // A flat or negative slope means Newton would step the wrong way or
        // divide by almost zero — which happens with handles at 0 or 1, exactly
        // the values the ease presets use. Fall through to bisection.
        if (slope < MINIMUM_SLOPE) return bisect(x1, x2, targetX)
        t -= error / slope
    }

    return if (t in 0.0..1.0) t else bisect(x1, x2, targetX)
}

/** Always converges, just more slowly. The safety net under Newton. */
private fun bisect(x1: Double, x2: Double, targetX: Double): Double {
    var low = 0.0
    var high = 1.0
    var mid = targetX

    repeat(BISECTION_ITERATIONS) {
        mid = (low + high) / 2.0
        val value = bezierAxis(x1, x2, mid)
        if (abs(value - targetX) < TOLERANCE) return mid
        if (value < targetX) low = mid else high = mid
    }
    return mid
}

/**
 * Four Newton steps put the error below the tolerance for every curve the
 * easing presets produce; more would be spent on curves that have already
 * converged.
 */
private const val NEWTON_ITERATIONS = 4

/** Halves the interval 30 times: an interval of 1e-9, well under any frame. */
private const val BISECTION_ITERATIONS = 30

/** Roughly a thousandth of a frame at 60 fps — far below anything visible. */
private const val TOLERANCE = 1e-6

private const val MINIMUM_SLOPE = 1e-3

// --- clip-level evaluation ---------------------------------------------------

/** The value of [property] on this clip at timeline position [time]. */
fun Clip.valueAt(property: AnimatableProperty, time: Ticks): Float {
    val animation = animations[property] ?: return staticValue(property)
    if (animation.isEmpty) return staticValue(property)
    return property.clamp(evaluate(animation, timeInClip(time), staticValue(property)))
}

/**
 * Converts a timeline position into clip-relative time.
 *
 * Keyframes are stored against the clip, so this is the only place the two
 * coordinate systems meet. Note it is **not** speed-adjusted: a keyframe placed
 * two seconds into a clip stays two seconds into the clip when the clip is
 * retimed, so the animation stretches with the picture instead of desynchronising
 * from it.
 */
fun Clip.timeInClip(time: Ticks): Ticks = (time - timelineStart).coerceAtLeast(Ticks.ZERO)

/**
 * The clip's [Transform] with every animated field evaluated at [time].
 *
 * Returns the static transform untouched when nothing is animated, so the common
 * case allocates nothing.
 */
fun Clip.transformAt(time: Ticks): Transform {
    if (!hasAnimation) return transform
    return transform.copy(
        positionX = valueAt(AnimatableProperty.POSITION_X, time),
        positionY = valueAt(AnimatableProperty.POSITION_Y, time),
        scaleX = valueAt(AnimatableProperty.SCALE_X, time),
        scaleY = valueAt(AnimatableProperty.SCALE_Y, time),
        rotationDegrees = valueAt(AnimatableProperty.ROTATION, time),
        opacity = valueAt(AnimatableProperty.OPACITY, time),
    )
}

/**
 * The clip's volume at [time]: the animated-or-static volume property, folded
 * through its fade-in/fade-out envelope.
 *
 * Fades are modelled separately from the keyframe system rather than as
 * implicit volume keyframes, because a fade is relative to the clip's edges —
 * trimming the clip should carry the fade with the new edge, not leave it
 * stranded at a fixed timeline position the way a keyframe would.
 */
fun Clip.volumeAt(time: Ticks): Float {
    val base = valueAt(AnimatableProperty.VOLUME, time)
    val envelope = fadeEnvelope(timeInClip(time), timelineDuration, fadeInDuration, fadeOutDuration)
    return base * envelope
}

/**
 * The linear fade envelope at [timeInClip], as a multiplier in 0..1.
 *
 * When [fadeIn] and [fadeOut] would overlap — a clip trimmed shorter than
 * their combined length — both are scaled down proportionally so they still
 * meet in the middle rather than one silently overriding the other, which is
 * what evaluating them independently would do.
 */
fun fadeEnvelope(timeInClip: Ticks, clipDuration: Ticks, fadeIn: Ticks, fadeOut: Ticks): Float {
    if (clipDuration.raw <= 0L) return 1f
    if (fadeIn.raw <= 0L && fadeOut.raw <= 0L) return 1f

    val total = fadeIn.raw + fadeOut.raw
    val scale = if (total > clipDuration.raw) clipDuration.raw.toDouble() / total else 1.0
    val effectiveIn = fadeIn.raw * scale
    val effectiveOut = fadeOut.raw * scale

    val t = timeInClip.raw.coerceIn(0L, clipDuration.raw).toDouble()
    val fromEnd = clipDuration.raw - t

    val inEnvelope = if (effectiveIn > 0.0) (t / effectiveIn).coerceIn(0.0, 1.0) else 1.0
    val outEnvelope = if (effectiveOut > 0.0) (fromEnd / effectiveOut).coerceIn(0.0, 1.0) else 1.0

    return (inEnvelope * outEnvelope).toFloat()
}

/** True when the clip's audio needs per-sample processing rather than a straight copy. */
val Clip.hasAudioAutomation: Boolean
    get() = track(AnimatableProperty.VOLUME).isAnimated ||
        fadeInDuration.raw > 0L || fadeOutDuration.raw > 0L
