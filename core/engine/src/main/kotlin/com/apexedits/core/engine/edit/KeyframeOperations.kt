package com.apexedits.core.engine.edit

import com.apexedits.core.engine.animation.timeInClip
import com.apexedits.core.engine.animation.valueAt
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.BezierHandles
import com.apexedits.core.model.Clip
import com.apexedits.core.model.Easing
import com.apexedits.core.model.Keyframe
import com.apexedits.core.model.Project
import com.apexedits.core.model.PropertyTrack
import com.apexedits.core.model.Ticks

/**
 * Keyframe editing.
 *
 * Same contract as the rest of the engine: everything clamps, nothing throws. A
 * keyframe placed outside the clip is clamped into it; removing one that is not
 * there returns the document unchanged.
 */

private fun Project.updateClip(clipId: String, transform: (Clip) -> Clip): Project {
    val track = trackOf(clipId)?.takeIf { !it.locked } ?: return this
    val index = track.clips.indexOfFirst { it.id == clipId }
    if (index < 0) return this

    val updated = transform(track.clips[index])
    if (updated == track.clips[index]) return this

    val clips = track.clips.toMutableList().also { it[index] = updated }
    val trackIndex = tracks.indexOfFirst { it.id == track.id }
    return copy(
        tracks = tracks.toMutableList().also { it[trackIndex] = track.copy(clips = clips) },
        revision = revision + 1,
    )
}

private fun Clip.withTrack(property: AnimatableProperty, track: PropertyTrack): Clip =
    if (track.isEmpty) {
        // An emptied track is removed rather than left as an empty entry, so
        // `hasAnimation` and the timeline's diamond rendering stay truthful.
        copy(animations = animations - property)
    } else {
        copy(animations = animations + (property to track))
    }

/**
 * Adds a keyframe for [property] at timeline position [at].
 *
 * When [value] is null the *current* value at that point is captured — which is
 * what the diamond button next to a slider does. That matters for the second
 * keyframe onward: capturing the evaluated value means adding a keyframe in the
 * middle of an existing animation pins the curve where it already was, instead
 * of yanking it to the static value and visibly changing the animation the user
 * was in the middle of refining.
 */
fun Project.addKeyframe(
    clipId: String,
    property: AnimatableProperty,
    at: Ticks,
    value: Float? = null,
): Project = updateClip(clipId) { clip ->
    val captured = value ?: clip.valueAt(property, at)
    val time = clip.timeInClip(at).coerceAtMost(clip.timelineDuration)
    val existing = clip.track(property)

    // The first keyframe on a property adopts the static value's meaning: the
    // property becomes animated from here, and the static value stays as the
    // fallback outside the keyframed range.
    clip.withTrack(
        property,
        existing.put(
            Keyframe(
                time = time,
                value = property.clamp(captured),
                easing = Easing.EASE_IN_OUT,
            ),
        ),
    )
}

/** Removes the keyframe at timeline position [at], if there is one exactly there. */
fun Project.removeKeyframe(clipId: String, property: AnimatableProperty, at: Ticks): Project =
    updateClip(clipId) { clip ->
        clip.withTrack(property, clip.track(property).removeAt(clip.timeInClip(at)))
    }

/** Removes every keyframe on a property, returning it to its static value. */
fun Project.clearKeyframes(clipId: String, property: AnimatableProperty): Project =
    updateClip(clipId) { clip -> clip.copy(animations = clip.animations - property) }

/** Removes all animation from a clip. */
fun Project.clearAllKeyframes(clipId: String): Project =
    updateClip(clipId) { clip -> clip.copy(animations = emptyMap()) }

/**
 * Drags a keyframe along the timeline.
 *
 * Clamped to the clip: a keyframe dragged past the end would stop affecting
 * anything while still appearing in the graph editor, which reads as a bug.
 */
fun Project.moveKeyframe(
    clipId: String,
    property: AnimatableProperty,
    from: Ticks,
    to: Ticks,
): Project = updateClip(clipId) { clip ->
    val target = clip.timeInClip(to).coerceIn(Ticks.ZERO, clip.timelineDuration)
    clip.withTrack(property, clip.track(property).move(clip.timeInClip(from), target))
}

/** Changes the value of an existing keyframe, leaving its time and easing alone. */
fun Project.setKeyframeValue(
    clipId: String,
    property: AnimatableProperty,
    at: Ticks,
    value: Float,
): Project = updateClip(clipId) { clip ->
    val track = clip.track(property)
    val existing = track.keyframeAt(clip.timeInClip(at)) ?: return@updateClip clip
    clip.withTrack(property, track.put(existing.copy(value = property.clamp(value))))
}

fun Project.setKeyframeEasing(
    clipId: String,
    property: AnimatableProperty,
    at: Ticks,
    easing: Easing,
    bezier: BezierHandles? = null,
): Project = updateClip(clipId) { clip ->
    clip.withTrack(property, clip.track(property).withEasing(clip.timeInClip(at), easing, bezier))
}

/**
 * Sets a property's value at [at].
 *
 * The single entry point a slider should call, because it does the thing users
 * expect without them having to think about modes: if the property is animated,
 * the drag writes a keyframe at the playhead; if it is not, it changes the
 * static value. Getting this wrong in either direction is a classic NLE
 * complaint — either a slider silently destroys an animation, or it silently
 * creates one nobody asked for.
 */
fun Project.setPropertyValue(
    clipId: String,
    property: AnimatableProperty,
    at: Ticks,
    value: Float,
): Project {
    val clip = clip(clipId) ?: return this
    return if (clip.track(property).isEmpty) {
        updateClip(clipId) { it.withStaticValue(property, value) }
    } else {
        updateClip(clipId) { c ->
            val time = c.timeInClip(at).coerceAtMost(c.timelineDuration)
            c.withTrack(
                property,
                c.track(property).put(
                    // Reuse the easing already at this time if a keyframe exists,
                    // so dragging a slider on an existing keyframe does not
                    // silently reset a curve the user shaped.
                    c.track(property).keyframeAt(time)?.copy(value = property.clamp(value))
                        ?: Keyframe(time, property.clamp(value)),
                ),
            )
        }
    }
}

/** Every keyframe time on a clip, in timeline coordinates, for drawing diamonds. */
fun Clip.keyframeTimelineTimes(): List<Ticks> =
    animations.values
        .flatMap { track -> track.keyframes.map { timelineStart + it.time } }
        .distinct()
        .sortedBy { it.raw }
