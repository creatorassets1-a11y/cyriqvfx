package com.apexedits.core.model

import kotlinx.serialization.Serializable

/**
 * Keyframe animation.
 *
 * The PRD wants almost every parameter animatable — transform, opacity, volume,
 * effect intensity, colour, mask shape. That is a lot of properties, and the
 * costly mistake would be to give each one its own animation mechanism.
 *
 * So animation is modelled *beside* the properties rather than inside them: a
 * clip keeps its plain static [Transform], and separately a map from
 * [AnimatableProperty] to a [PropertyTrack] of keyframes. A property with no
 * track reads its static value; a property with a track is evaluated at the
 * playhead.
 *
 * Two things fall out of that shape:
 *
 *  - Adding an animatable property in a later phase means adding an enum
 *    constant, not changing [Clip] or its serialised form.
 *  - "Which properties are animated?" is a map lookup rather than a scan of
 *    every field, which is what the timeline needs to draw keyframe diamonds
 *    without walking the whole document per frame.
 */

/**
 * A property that can be animated.
 *
 * Each carries its own display copy and range, so a panel can render a control
 * for any property without a `when` block that has to be extended in lockstep —
 * and so the self-explanatory labelling rule is satisfied from the model rather
 * than retyped per screen.
 */
@Serializable
enum class AnimatableProperty(
    val displayName: String,
    val explanation: String,
    val defaultValue: Float,
    val minValue: Float,
    val maxValue: Float,
    val unit: String = "",
) {
    POSITION_X(
        "Horizontal position",
        "Move the picture left or right within the frame.",
        0f, -2000f, 2000f, "px",
    ),
    POSITION_Y(
        "Vertical position",
        "Move the picture up or down within the frame.",
        0f, -2000f, 2000f, "px",
    ),
    SCALE_X(
        "Width",
        "Stretch or shrink the picture horizontally. 100% is its normal width.",
        1f, 0.05f, 10f, "×",
    ),
    SCALE_Y(
        "Height",
        "Stretch or shrink the picture vertically. 100% is its normal height.",
        1f, 0.05f, 10f, "×",
    ),
    ROTATION(
        "Rotation",
        "Turn the picture clockwise or anticlockwise.",
        0f, -360f, 360f, "°",
    ),
    OPACITY(
        "Opacity",
        "How solid the picture is. Lower values let the layer underneath show through.",
        1f, 0f, 1f, "",
    ),
    VOLUME(
        "Volume",
        "How loud this clip's sound is. Zero is silent.",
        1f, 0f, 2f, "",
    );

    fun clamp(value: Float): Float = value.coerceIn(minValue, maxValue)
}

/**
 * How a value travels from one keyframe to the next.
 *
 * The easing belongs to the keyframe the segment *starts* from, which is the
 * convention every desktop NLE uses: dragging a keyframe carries its outgoing
 * curve with it.
 */
@Serializable
enum class Easing(val displayName: String, val explanation: String) {
    LINEAR(
        "Linear",
        "Changes at a constant speed the whole way. Good for mechanical movement.",
    ),
    EASE_IN(
        "Ease In",
        "Starts slowly and speeds up. Good for something beginning to move.",
    ),
    EASE_OUT(
        "Ease Out",
        "Starts fast and slows down at the end. Good for something coming to rest.",
    ),
    EASE_IN_OUT(
        "Ease In and Out",
        "Starts slowly, speeds up, then slows down again. The most natural-looking option.",
    ),
    HOLD(
        "Hold",
        "Stays on this value with no movement, then jumps to the next keyframe.",
    ),
    BEZIER(
        "Custom curve",
        "Uses the curve shape you drew in the animation graph.",
    );

    /** The control points this easing is equivalent to, for the graph editor. */
    val handles: BezierHandles?
        get() = when (this) {
            LINEAR -> BezierHandles(0f, 0f, 1f, 1f)
            EASE_IN -> BezierHandles(0.42f, 0f, 1f, 1f)
            EASE_OUT -> BezierHandles(0f, 0f, 0.58f, 1f)
            EASE_IN_OUT -> BezierHandles(0.42f, 0f, 0.58f, 1f)
            HOLD -> null
            BEZIER -> null
        }
}

/**
 * Cubic bezier control points, in the CSS timing-function convention: the curve
 * runs from (0,0) to (1,1), and these are the two handles between them.
 *
 * X is clamped to 0..1 because a handle outside that range makes the curve
 * non-monotonic in time — the animation would run backwards mid-segment, which
 * no user ever means. Y is deliberately unclamped, since overshoot past the
 * target value is exactly how a bounce or an anticipation is built.
 */
@Serializable
data class BezierHandles(val x1: Float, val y1: Float, val x2: Float, val y2: Float) {
    init {
        require(x1 in 0f..1f && x2 in 0f..1f) {
            "Bezier x handles must be within 0..1, got x1=$x1 x2=$x2"
        }
    }
}

/**
 * One animation point: a value at a time, and how to leave it.
 *
 * [time] is measured from the **start of the clip**, not from the start of the
 * timeline. Anchoring to the clip means moving a clip along the timeline, or
 * rippling everything after an edit, carries its animation along without
 * touching a single keyframe.
 */
@Serializable
data class Keyframe(
    val time: Ticks,
    val value: Float,
    val easing: Easing = Easing.EASE_IN_OUT,
    /** Only consulted when [easing] is [Easing.BEZIER]. */
    val bezier: BezierHandles? = null,
) {
    /** The curve this keyframe leaves by, resolved from easing or custom handles. */
    val effectiveHandles: BezierHandles?
        get() = if (easing == Easing.BEZIER) bezier else easing.handles
}

/**
 * The keyframes for one property, kept sorted by time.
 *
 * The sort is an invariant maintained on every mutation rather than at read
 * time, because evaluation happens per frame while edits happen per gesture:
 * paying for the sort on the rare path keeps the hot path a binary search.
 */
@Serializable
data class PropertyTrack(val keyframes: List<Keyframe> = emptyList()) {

    val isEmpty: Boolean get() = keyframes.isEmpty()

    /** A single keyframe holds a constant; two or more actually animate. */
    val isAnimated: Boolean get() = keyframes.size >= 2

    val firstTime: Ticks? get() = keyframes.firstOrNull()?.time
    val lastTime: Ticks? get() = keyframes.lastOrNull()?.time

    /** Inserts or replaces the keyframe at [keyframe]'s time, keeping order. */
    fun put(keyframe: Keyframe): PropertyTrack {
        val without = keyframes.filterNot { it.time == keyframe.time }
        return PropertyTrack((without + keyframe).sortedBy { it.time.raw })
    }

    fun removeAt(time: Ticks): PropertyTrack =
        PropertyTrack(keyframes.filterNot { it.time == time })

    /** Moves a keyframe in time. A collision replaces the keyframe already there. */
    fun move(from: Ticks, to: Ticks): PropertyTrack {
        val moving = keyframes.firstOrNull { it.time == from } ?: return this
        return removeAt(from).put(moving.copy(time = to))
    }

    fun withEasing(time: Ticks, easing: Easing, bezier: BezierHandles? = null): PropertyTrack {
        val target = keyframes.firstOrNull { it.time == time } ?: return this
        return put(target.copy(easing = easing, bezier = bezier))
    }

    fun keyframeAt(time: Ticks): Keyframe? = keyframes.firstOrNull { it.time == time }

    /** The nearest keyframe within [tolerance], for hit-testing a tap on a diamond. */
    fun nearest(time: Ticks, tolerance: Ticks): Keyframe? =
        keyframes.minByOrNull { kotlin.math.abs(it.time.raw - time.raw) }
            ?.takeIf { kotlin.math.abs(it.time.raw - time.raw) <= tolerance.raw }

    companion object {
        val EMPTY = PropertyTrack()
    }
}
