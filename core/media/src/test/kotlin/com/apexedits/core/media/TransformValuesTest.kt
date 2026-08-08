package com.apexedits.core.media

import com.apexedits.core.engine.edit.addKeyframe
import com.apexedits.core.engine.edit.appendClip
import com.apexedits.core.engine.edit.setKeyframeEasing
import com.apexedits.core.engine.edit.setPropertyValue
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.CountingIdSource
import com.apexedits.core.model.Easing
import com.apexedits.core.model.Project
import com.apexedits.core.model.SampleVideo
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.createClip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The transform arithmetic, without a GPU.
 *
 * `getMatrix` needs `android.graphics.Matrix`, but the part that is easy to get
 * wrong is not the matrix — it is the conversion into normalised device
 * coordinates, where a forgotten division or a sign error puts the picture
 * somewhere off-screen and the mistake is invisible until someone runs the app.
 *
 * That arithmetic is a pure function, so it is tested here at the sample clip's
 * real 576×640 frame.
 */
class TransformValuesTest {

    private val halfWidth = SampleVideo.WIDTH / 2f     // 288
    private val halfHeight = SampleVideo.HEIGHT / 2f   // 320
    private val aspect = SampleVideo.WIDTH.toFloat() / SampleVideo.HEIGHT // 0.9

    private fun project(): Pair<Project, String> {
        val ids = CountingIdSource()
        val base = SampleVideo.project(ids)
        val trackId = base.videoTracks.first().id
        val withClip = base.appendClip(trackId, createClip(ids, SampleVideo.mediaRef()))
        return withClip to withClip.track(trackId)!!.clips.single().id
    }

    private fun valuesAt(project: Project, clipId: String, micros: Long) =
        transformValuesAt(project.clip(clipId)!!, micros, halfWidth, halfHeight, aspect)

    @Test
    fun `an untouched clip is the identity`() {
        val (project, clipId) = project()
        val values = valuesAt(project, clipId, 0)

        assertEquals(0f, values.translateX, 0.0001f)
        assertEquals(0f, values.translateY, 0.0001f)
        assertEquals(1f, values.scaleX, 0.0001f)
        assertEquals(1f, values.scaleY, 0.0001f)
        assertEquals(0f, values.rotationDegrees, 0.0001f)
    }

    @Test
    fun `a pixel offset becomes a fraction of half the frame`() {
        val (start, clipId) = project()
        // Half the frame width to the right: 288 px on a 576 px frame.
        val moved = start.setPropertyValue(clipId, AnimatableProperty.POSITION_X, Ticks.ZERO, 288f)

        // NDC spans -1..1, so half the frame is exactly 1.0. Feeding the raw
        // pixel value instead would put the picture 288 frames off-screen.
        assertEquals(1f, valuesAt(moved, clipId, 0).translateX, 0.0001f)
    }

    @Test
    fun `the vertical axis is inverted`() {
        val (start, clipId) = project()
        // Positive Y means "down" to the user dragging it.
        val moved = start.setPropertyValue(clipId, AnimatableProperty.POSITION_Y, Ticks.ZERO, 320f)

        // NDC points up, so down has to become negative or every vertical move
        // goes the wrong way.
        assertEquals(-1f, valuesAt(moved, clipId, 0).translateY, 0.0001f)
    }

    @Test
    fun `horizontal and vertical use their own half-dimensions`() {
        val (start, clipId) = project()
        val moved = start
            .setPropertyValue(clipId, AnimatableProperty.POSITION_X, Ticks.ZERO, 144f)
            .setPropertyValue(clipId, AnimatableProperty.POSITION_Y, Ticks.ZERO, 144f)

        val values = valuesAt(moved, clipId, 0)
        // The frame is not square: 144 px is a quarter of the width but only
        // 0.225 of the height. Using one divisor for both would skew every move.
        assertEquals(0.5f, values.translateX, 0.0001f)
        assertEquals(-0.45f, values.translateY, 0.0001f)
    }

    @Test
    fun `a flip is a negative scale`() {
        val (start, clipId) = project()
        val clip = start.clip(clipId)!!
        val flipped = clip.copy(transform = clip.transform.copy(flipHorizontal = true))

        val values = transformValuesAt(flipped, 0, halfWidth, halfHeight, aspect)
        assertEquals(-1f, values.scaleX, 0.0001f)
        assertEquals(1f, values.scaleY, 0.0001f)
    }

    @Test
    fun `animated values are resolved at the presentation time`() {
        val (start, clipId) = project()
        val animated = start
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, Ticks.ofSeconds(2.0), 3f)
            .setKeyframeEasing(clipId, AnimatableProperty.SCALE_X, Ticks.ZERO, Easing.LINEAR)

        // Media3 hands the effect a microsecond timestamp; halfway through the
        // ramp must give halfway through the values.
        assertEquals(1f, valuesAt(animated, clipId, 0).scaleX, 0.001f)
        assertEquals(2f, valuesAt(animated, clipId, 1_000_000).scaleX, 0.001f)
        assertEquals(3f, valuesAt(animated, clipId, 2_000_000).scaleX, 0.001f)
    }

    @Test
    fun `a negative presentation time is clamped rather than extrapolated`() {
        val (start, clipId) = project()
        val animated = start
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, Ticks.ofSeconds(2.0), 3f)

        assertEquals(1f, valuesAt(animated, clipId, -500_000).scaleX, 0.001f)
    }

    @Test
    fun `the effect is skipped for a clip that does not need it`() {
        val (project, clipId) = project()
        // No transform, no animation: no shader pass, which matters on a
        // low-tier device where every avoided pass is frame budget.
        assertFalse(KeyframedTransformation.isNeeded(project.clip(clipId)!!))

        val moved = project.setPropertyValue(clipId, AnimatableProperty.POSITION_X, Ticks.ZERO, 10f)
        assertTrue(KeyframedTransformation.isNeeded(moved.clip(clipId)!!))
    }

    @Test
    fun `an opacity keyframe alone does not pull in the matrix effect`() {
        val (start, clipId) = project()
        val faded = start
            .addKeyframe(clipId, AnimatableProperty.OPACITY, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.OPACITY, Ticks.ofSeconds(1.0), 0f)

        // Alpha is not a geometric transform. It gets the alpha effect instead;
        // adding a matrix pass for it would cost a frame copy for nothing.
        assertFalse(KeyframedTransformation.isNeeded(faded.clip(clipId)!!))
        assertTrue(KeyframedAlphaEffect.isNeeded(faded.clip(clipId)!!))
    }

    @Test
    fun `an opaque clip needs no alpha pass`() {
        val (project, clipId) = project()
        assertFalse(KeyframedAlphaEffect.isNeeded(project.clip(clipId)!!))

        val faded = project.setPropertyValue(clipId, AnimatableProperty.OPACITY, Ticks.ZERO, 0.5f)
        assertTrue(KeyframedAlphaEffect.isNeeded(faded.clip(clipId)!!))
    }
}
