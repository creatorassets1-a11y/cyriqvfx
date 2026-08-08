package com.apexedits.core.engine

import com.apexedits.core.engine.animation.evaluate
import com.apexedits.core.engine.animation.solveBezier
import com.apexedits.core.engine.animation.transformAt
import com.apexedits.core.engine.animation.valueAt
import com.apexedits.core.engine.compose.composeFrame
import com.apexedits.core.engine.edit.addKeyframe
import com.apexedits.core.engine.edit.appendClip
import com.apexedits.core.engine.edit.clearKeyframes
import com.apexedits.core.engine.edit.keyframeTimelineTimes
import com.apexedits.core.engine.edit.moveClip
import com.apexedits.core.engine.edit.moveKeyframe
import com.apexedits.core.engine.edit.removeKeyframe
import com.apexedits.core.engine.edit.setKeyframeEasing
import com.apexedits.core.engine.edit.setPropertyValue
import com.apexedits.core.engine.edit.setTrackLocked
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.AspectRatio
import com.apexedits.core.model.BezierHandles
import com.apexedits.core.model.CountingIdSource
import com.apexedits.core.model.Easing
import com.apexedits.core.model.FrameRate
import com.apexedits.core.model.Keyframe
import com.apexedits.core.model.MediaKind
import com.apexedits.core.model.MediaRef
import com.apexedits.core.model.Project
import com.apexedits.core.model.ProjectFormat
import com.apexedits.core.model.PropertyTrack
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.createClip
import com.apexedits.core.model.createProject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

private fun seconds(value: Double) = Ticks.ofSeconds(value)

private fun media() = MediaRef(
    id = "media-1",
    uri = "file:///test/media-1.mp4",
    displayName = "media-1.mp4",
    kind = MediaKind.VIDEO,
    duration = seconds(10.0),
    width = 1920,
    height = 1080,
    hasAudio = true,
)

private fun projectWithClip(): Pair<Project, String> {
    val ids = CountingIdSource()
    val m = media()
    var project = createProject(
        ids = ids,
        name = "Keyframes",
        format = ProjectFormat.of(AspectRatio.LANDSCAPE_16_9, 1080, FrameRate.FPS_30),
    ).copy(media = listOf(m))
    project = project.appendClip(project.videoTracks.first().id, createClip(ids, m))
    return project to project.videoTracks.first().clips.single().id
}

class InterpolationTest {

    private fun track(vararg points: Pair<Double, Float>, easing: Easing = Easing.LINEAR) =
        PropertyTrack(points.map { (t, v) -> Keyframe(seconds(t), v, easing) })

    @Test
    fun `no keyframes falls back to the static value`() {
        assertEquals(0.5f, evaluate(PropertyTrack.EMPTY, seconds(1.0), 0.5f), 0.0001f)
    }

    @Test
    fun `a single keyframe holds its value everywhere`() {
        val single = track(2.0 to 7f)
        assertEquals(7f, evaluate(single, Ticks.ZERO, 0f), 0.0001f)
        assertEquals(7f, evaluate(single, seconds(2.0), 0f), 0.0001f)
        assertEquals(7f, evaluate(single, seconds(100.0), 0f), 0.0001f)
    }

    @Test
    fun `linear interpolation is exactly linear`() {
        val ramp = track(0.0 to 0f, 4.0 to 100f)
        assertEquals(0f, evaluate(ramp, seconds(0.0), 0f), 0.001f)
        assertEquals(25f, evaluate(ramp, seconds(1.0), 0f), 0.001f)
        assertEquals(50f, evaluate(ramp, seconds(2.0), 0f), 0.001f)
        assertEquals(100f, evaluate(ramp, seconds(4.0), 0f), 0.001f)
    }

    @Test
    fun `the value holds outside the keyframed range rather than extrapolating`() {
        // Extrapolation would send a scale animation off to infinity over a long
        // clip. Every NLE holds instead, and so does this.
        val ramp = track(2.0 to 10f, 4.0 to 20f)
        assertEquals(10f, evaluate(ramp, Ticks.ZERO, 0f), 0.001f)
        assertEquals(20f, evaluate(ramp, seconds(60.0), 0f), 0.001f)
    }

    @Test
    fun `hold keeps the value flat then jumps`() {
        val held = track(0.0 to 0f, 2.0 to 100f, easing = Easing.HOLD)
        assertEquals(0f, evaluate(held, seconds(0.5), 0f), 0.001f)
        assertEquals(0f, evaluate(held, seconds(1.999), 0f), 0.001f)
        assertEquals(100f, evaluate(held, seconds(2.0), 0f), 0.001f)
    }

    @Test
    fun `eased curves stay inside their endpoints and stay monotonic`() {
        for (easing in listOf(Easing.EASE_IN, Easing.EASE_OUT, Easing.EASE_IN_OUT, Easing.LINEAR)) {
            val curve = track(0.0 to 0f, 1.0 to 100f, easing = easing)
            var previous = -1f
            for (step in 0..100) {
                val value = evaluate(curve, seconds(step / 100.0), 0f)
                assertTrue("$easing produced $value outside 0..100", value in -0.01f..100.01f)
                assertTrue("$easing went backwards at step $step", value >= previous - 0.01f)
                previous = value
            }
        }
    }

    @Test
    fun `ease in starts slower than linear and ease out starts faster`() {
        val easeIn = track(0.0 to 0f, 1.0 to 100f, easing = Easing.EASE_IN)
        val linear = track(0.0 to 0f, 1.0 to 100f, easing = Easing.LINEAR)
        val easeOut = track(0.0 to 0f, 1.0 to 100f, easing = Easing.EASE_OUT)

        val quarter = seconds(0.25)
        assertTrue(evaluate(easeIn, quarter, 0f) < evaluate(linear, quarter, 0f))
        assertTrue(evaluate(easeOut, quarter, 0f) > evaluate(linear, quarter, 0f))
    }

    @Test
    fun `ease in out is symmetric about its midpoint`() {
        val curve = track(0.0 to 0f, 1.0 to 100f, easing = Easing.EASE_IN_OUT)
        assertEquals(50f, evaluate(curve, seconds(0.5), 0f), 0.5f)
        // f(x) + f(1-x) = 100 for a symmetric curve.
        for (x in listOf(0.1, 0.25, 0.4)) {
            val a = evaluate(curve, seconds(x), 0f)
            val b = evaluate(curve, seconds(1.0 - x), 0f)
            assertEquals(100f, a + b, 0.5f)
        }
    }

    @Test
    fun `the bezier solver hits its endpoints exactly`() {
        val handles = BezierHandles(0.42f, 0f, 0.58f, 1f)
        assertEquals(0.0, solveBezier(handles, 0.0), 1e-9)
        assertEquals(1.0, solveBezier(handles, 1.0), 1e-9)
    }

    @Test
    fun `the bezier solver converges for handles at the extremes`() {
        // Handles at 0 or 1 flatten the derivative, which is where a pure
        // Newton solve stalls or diverges. These are the values the ease presets
        // actually use, so the bisection fallback has to work.
        val flat = listOf(
            BezierHandles(0f, 0f, 1f, 1f),
            BezierHandles(1f, 0f, 0f, 1f),
            BezierHandles(0f, 1f, 1f, 0f),
            BezierHandles(1f, 1f, 0f, 0f),
        )
        for (handles in flat) {
            for (step in 1..99) {
                val x = step / 100.0
                val y = solveBezier(handles, x)
                assertTrue("$handles at $x produced $y", y.isFinite())
            }
        }
    }

    @Test
    fun `a linear bezier is the identity`() {
        val linear = BezierHandles(1f / 3f, 1f / 3f, 2f / 3f, 2f / 3f)
        for (step in 0..20) {
            val x = step / 20.0
            assertEquals(x, solveBezier(linear, x), 1e-4)
        }
    }

    @Test
    fun `a custom curve may overshoot its target value`() {
        // Y handles are deliberately unclamped: overshoot is how a bounce or an
        // anticipation is built, so a curve that leaves 0..1 is correct here.
        val overshoot = BezierHandles(0.3f, 1.6f, 0.7f, 1f)
        val peak = (1..99).maxOf { solveBezier(overshoot, it / 100.0) }
        assertTrue("expected overshoot above 1.0, peaked at $peak", peak > 1.0)
    }

    @Test
    fun `evaluation is correct with many keyframes`() {
        // Exercises the binary search rather than the two-keyframe fast path.
        val many = PropertyTrack(
            (0..100).map { Keyframe(seconds(it.toDouble()), it.toFloat(), Easing.LINEAR) },
        )
        assertEquals(50f, evaluate(many, seconds(50.0), 0f), 0.001f)
        assertEquals(50.5f, evaluate(many, seconds(50.5), 0f), 0.001f)
        assertEquals(0f, evaluate(many, seconds(0.0), 0f), 0.001f)
        assertEquals(100f, evaluate(many, seconds(100.0), 0f), 0.001f)
    }
}

class KeyframeOperationsTest {

    @Test
    fun `adding a keyframe captures the current value when none is given`() {
        val (start, clipId) = projectWithClip()
        val positioned = start.setPropertyValue(clipId, AnimatableProperty.POSITION_X, Ticks.ZERO, 120f)

        val keyed = positioned.addKeyframe(clipId, AnimatableProperty.POSITION_X, seconds(1.0))
        val track = keyed.clip(clipId)!!.track(AnimatableProperty.POSITION_X)

        assertEquals(1, track.keyframes.size)
        assertEquals(120f, track.keyframes.single().value, 0.001f)
    }

    @Test
    fun `keyframe times are stored relative to the clip so moving it carries the animation`() {
        val (start, clipId) = projectWithClip()
        val keyed = start
            .addKeyframe(clipId, AnimatableProperty.OPACITY, Ticks.ZERO, 0f)
            .addKeyframe(clipId, AnimatableProperty.OPACITY, seconds(2.0), 1f)

        // Halfway through the fade, opacity is halfway.
        assertEquals(0.5f, keyed.clip(clipId)!!.valueAt(AnimatableProperty.OPACITY, seconds(1.0)), 0.01f)

        val moved = keyed.moveClip(clipId, seconds(5.0))
        // The fade moved with the clip: same relative position, new absolute time.
        assertEquals(0.5f, moved.clip(clipId)!!.valueAt(AnimatableProperty.OPACITY, seconds(6.0)), 0.01f)
        // And is no longer happening where it used to be.
        assertEquals(0f, moved.clip(clipId)!!.valueAt(AnimatableProperty.OPACITY, seconds(1.0)), 0.01f)
    }

    @Test
    fun `a slider writes a keyframe when the property is animated and the static value when it is not`() {
        val (start, clipId) = projectWithClip()

        // Not animated: the static value changes and no keyframes appear.
        val staticEdit = start.setPropertyValue(clipId, AnimatableProperty.SCALE_X, seconds(1.0), 1.5f)
        assertTrue(staticEdit.clip(clipId)!!.track(AnimatableProperty.SCALE_X).isEmpty)
        assertEquals(1.5f, staticEdit.clip(clipId)!!.transform.scaleX, 0.001f)

        // Animated: the same gesture writes a keyframe at the playhead instead.
        val animated = staticEdit.addKeyframe(clipId, AnimatableProperty.SCALE_X, Ticks.ZERO, 1f)
        val edited = animated.setPropertyValue(clipId, AnimatableProperty.SCALE_X, seconds(3.0), 2f)

        val track = edited.clip(clipId)!!.track(AnimatableProperty.SCALE_X)
        assertEquals(2, track.keyframes.size)
        assertEquals(2f, edited.clip(clipId)!!.valueAt(AnimatableProperty.SCALE_X, seconds(3.0)), 0.001f)
    }

    @Test
    fun `dragging a slider on an existing keyframe keeps its easing`() {
        val (start, clipId) = projectWithClip()
        val shaped = start
            .addKeyframe(clipId, AnimatableProperty.ROTATION, Ticks.ZERO, 0f)
            .addKeyframe(clipId, AnimatableProperty.ROTATION, seconds(2.0), 90f)
            .setKeyframeEasing(clipId, AnimatableProperty.ROTATION, Ticks.ZERO, Easing.EASE_OUT)

        val redragged = shaped.setPropertyValue(clipId, AnimatableProperty.ROTATION, Ticks.ZERO, 45f)
        val first = redragged.clip(clipId)!!.track(AnimatableProperty.ROTATION).keyframes.first()

        assertEquals(45f, first.value, 0.001f)
        // The curve the user shaped survived the value change.
        assertEquals(Easing.EASE_OUT, first.easing)
    }

    @Test
    fun `keyframes are kept sorted however they are added`() {
        val (start, clipId) = projectWithClip()
        val scrambled = start
            .addKeyframe(clipId, AnimatableProperty.POSITION_Y, seconds(4.0), 40f)
            .addKeyframe(clipId, AnimatableProperty.POSITION_Y, seconds(1.0), 10f)
            .addKeyframe(clipId, AnimatableProperty.POSITION_Y, seconds(3.0), 30f)
            .addKeyframe(clipId, AnimatableProperty.POSITION_Y, seconds(2.0), 20f)

        val times = scrambled.clip(clipId)!!.track(AnimatableProperty.POSITION_Y).keyframes.map { it.time.raw }
        assertEquals(times.sorted(), times)
    }

    @Test
    fun `adding a keyframe at an existing time replaces it rather than duplicating`() {
        val (start, clipId) = projectWithClip()
        val twice = start
            .addKeyframe(clipId, AnimatableProperty.OPACITY, seconds(1.0), 0.2f)
            .addKeyframe(clipId, AnimatableProperty.OPACITY, seconds(1.0), 0.8f)

        val track = twice.clip(clipId)!!.track(AnimatableProperty.OPACITY)
        assertEquals(1, track.keyframes.size)
        assertEquals(0.8f, track.keyframes.single().value, 0.001f)
    }

    @Test
    fun `removing the last keyframe drops the track so the clip stops reporting animation`() {
        val (start, clipId) = projectWithClip()
        val keyed = start.addKeyframe(clipId, AnimatableProperty.OPACITY, seconds(1.0), 0.5f)
        assertTrue(keyed.clip(clipId)!!.hasAnimation)

        val cleared = keyed.removeKeyframe(clipId, AnimatableProperty.OPACITY, seconds(1.0))
        assertFalse(cleared.clip(clipId)!!.hasAnimation)
        assertTrue(cleared.clip(clipId)!!.animations.isEmpty())
    }

    @Test
    fun `clearing keyframes returns the property to its static value`() {
        val (start, clipId) = projectWithClip()
        val animated = start
            .setPropertyValue(clipId, AnimatableProperty.SCALE_X, Ticks.ZERO, 1.5f)
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, Ticks.ZERO, 3f)
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, seconds(2.0), 5f)

        val cleared = animated.clearKeyframes(clipId, AnimatableProperty.SCALE_X)
        assertEquals(1.5f, cleared.clip(clipId)!!.valueAt(AnimatableProperty.SCALE_X, seconds(1.0)), 0.001f)
    }

    @Test
    fun `a keyframe dragged past the end of the clip is clamped into it`() {
        val (start, clipId) = projectWithClip()
        val keyed = start.addKeyframe(clipId, AnimatableProperty.OPACITY, seconds(1.0), 0.5f)

        val dragged = keyed.moveKeyframe(clipId, AnimatableProperty.OPACITY, seconds(1.0), seconds(500.0))
        val moved = dragged.clip(clipId)!!.track(AnimatableProperty.OPACITY).keyframes.single()

        assertEquals(dragged.clip(clipId)!!.timelineDuration, moved.time)
    }

    @Test
    fun `keyframe operations on a locked track change nothing`() {
        val (start, clipId) = projectWithClip()
        val locked = start.setTrackLocked(start.videoTracks.first().id, true)
        assertSame(locked, locked.addKeyframe(clipId, AnimatableProperty.OPACITY, Ticks.ZERO, 0f))
    }

    @Test
    fun `keyframe operations on a missing clip change nothing`() {
        val (start, _) = projectWithClip()
        assertSame(start, start.addKeyframe("nope", AnimatableProperty.OPACITY, Ticks.ZERO, 0f))
        assertSame(start, start.removeKeyframe("nope", AnimatableProperty.OPACITY, Ticks.ZERO))
        assertSame(start, start.moveKeyframe("nope", AnimatableProperty.OPACITY, Ticks.ZERO, seconds(1.0)))
        assertSame(start, start.clearKeyframes("nope", AnimatableProperty.OPACITY))
    }

    @Test
    fun `values are clamped to the property's own range`() {
        val (start, clipId) = projectWithClip()
        val clamped = start
            .addKeyframe(clipId, AnimatableProperty.OPACITY, Ticks.ZERO, 5f)
            .addKeyframe(clipId, AnimatableProperty.OPACITY, seconds(1.0), -3f)

        val values = clamped.clip(clipId)!!.track(AnimatableProperty.OPACITY).keyframes.map { it.value }
        assertEquals(listOf(1f, 0f), values)
    }

    @Test
    fun `diamond positions are reported in timeline coordinates`() {
        val (start, clipId) = projectWithClip()
        val keyed = start
            .addKeyframe(clipId, AnimatableProperty.OPACITY, seconds(1.0), 0f)
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, seconds(1.0), 2f)
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, seconds(3.0), 1f)
            .moveClip(clipId, seconds(10.0))

        val times = keyed.clip(clipId)!!.keyframeTimelineTimes()
        // Two properties share a keyframe at 1 s, so it is listed once, and all
        // of them have shifted with the clip.
        assertEquals(listOf(seconds(11.0), seconds(13.0)), times)
    }
}

class AnimatedCompositionTest {

    @Test
    fun `an animated transform is resolved by composeFrame`() {
        val (start, clipId) = projectWithClip()
        val animated = start
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, seconds(4.0), 3f)
            .setKeyframeEasing(clipId, AnimatableProperty.SCALE_X, Ticks.ZERO, Easing.LINEAR)

        // The layer leaving composeFrame carries a final value, not a keyframe
        // list: a consumer has nothing left to interpret.
        assertEquals(1f, composeFrame(animated, Ticks.ZERO).layers.single().transform.scaleX, 0.01f)
        assertEquals(2f, composeFrame(animated, seconds(2.0)).layers.single().transform.scaleX, 0.01f)
        assertEquals(3f, composeFrame(animated, seconds(4.0)).layers.single().transform.scaleX, 0.01f)
    }

    @Test
    fun `animated opacity reaches the layer's effective opacity`() {
        val (start, clipId) = projectWithClip()
        val faded = start
            .addKeyframe(clipId, AnimatableProperty.OPACITY, Ticks.ZERO, 0f)
            .addKeyframe(clipId, AnimatableProperty.OPACITY, seconds(2.0), 1f)
            .setKeyframeEasing(clipId, AnimatableProperty.OPACITY, Ticks.ZERO, Easing.LINEAR)

        assertEquals(0.5f, composeFrame(faded, seconds(1.0)).layers.single().effectiveOpacity, 0.01f)
    }

    @Test
    fun `animated volume is multiplied by the track volume`() {
        val (start, clipId) = projectWithClip()
        val ducked = start
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.VOLUME, seconds(2.0), 0f)
            .setKeyframeEasing(clipId, AnimatableProperty.VOLUME, Ticks.ZERO, Easing.LINEAR)

        assertEquals(0.5f, composeFrame(ducked, seconds(1.0)).audio.single().effectiveVolume, 0.01f)
    }

    @Test
    fun `a clip with no animation returns the identical transform instance`() {
        val (start, clipId) = projectWithClip()
        val clip = start.clip(clipId)!!
        // The common case must not allocate a copy per frame.
        assertSame(clip.transform, clip.transformAt(seconds(1.0)))
    }
}
