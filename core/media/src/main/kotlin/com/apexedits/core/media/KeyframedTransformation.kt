package com.apexedits.core.media

import android.graphics.Matrix
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.MatrixTransformation
import com.apexedits.core.engine.animation.valueAt
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.Clip
import com.apexedits.core.model.Ticks

/**
 * An animated transform, as a Media3 effect.
 *
 * This is the piece that keeps ADR 0004 true once keyframes exist. Media3's
 * `ScaleAndRotateTransformation` takes fixed numbers, so a keyframed transform
 * cannot be expressed with it; the naive fix is to animate the preview in the
 * app's own compositor and bake the animation separately at export, which
 * immediately gives two implementations of the same animation and a class of
 * "the export doesn't match what I saw" bugs that is miserable to diagnose.
 *
 * `MatrixTransformation` avoids that entirely. It is a function from
 * presentation time to a matrix, evaluated by the same effect pipeline that both
 * `CompositionPlayer` and `Transformer` run — so preview and export get the
 * animation from one place, evaluated by the engine's own interpolator.
 *
 * ### The coordinate system
 *
 * Media3 hands the matrix a frame in **normalised device coordinates**: the
 * visible area is x ∈ [-1, 1], y ∈ [-1, 1] with the origin at the centre. It is
 * not pixels, and it is not top-left origin. Two things follow.
 *
 * Position keyframes are authored in pixels against the project's frame, so they
 * are divided by half the frame size to land in NDC. Without that a 100 px nudge
 * would throw the picture fifty frames off-screen.
 *
 * Rotation is applied about (0, 0) — already the centre of the frame in NDC —
 * so no translate-rotate-translate sandwich is needed.
 *
 * ### Aspect correction
 *
 * NDC is square while the frame usually is not, so a rotation applied naively
 * shears the picture: a 45° rotation on a 16:9 frame comes out visibly skewed.
 * The fix is to scale into a square space, rotate, and scale back, which is what
 * [aspect] is for.
 */
@UnstableApi
class KeyframedTransformation(
    private val clip: Clip,
    frameWidth: Int,
    frameHeight: Int,
) : MatrixTransformation {

    private val halfWidth = (frameWidth / 2f).coerceAtLeast(1f)
    private val halfHeight = (frameHeight / 2f).coerceAtLeast(1f)
    private val aspect = frameWidth.toFloat() / frameHeight.toFloat()

    /** Reused across frames. `getMatrix` is called per frame; allocating here would churn. */
    private val matrix = Matrix()

    override fun getMatrix(presentationTimeUs: Long): Matrix {
        // Media3 reports time relative to the start of this item's own media,
        // and the engine stores keyframes relative to the start of the clip.
        // Those coincide because one EditedMediaItem is built per clip, clipped
        // to its source window — see CompositionBuilder.
        val timeInClip = Ticks.ofMicros(presentationTimeUs.coerceAtLeast(0L))
        val time = clip.timelineStart + timeInClip

        val translateX = clip.valueAt(AnimatableProperty.POSITION_X, time) / halfWidth
        val translateY = clip.valueAt(AnimatableProperty.POSITION_Y, time) / halfHeight
        val scaleX = clip.valueAt(AnimatableProperty.SCALE_X, time)
        val scaleY = clip.valueAt(AnimatableProperty.SCALE_Y, time)
        val rotation = clip.valueAt(AnimatableProperty.ROTATION, time)

        matrix.reset()

        // Applied in the order the reader expects: translate last so a moving
        // clip moves in frame space rather than in its own rotated space.
        matrix.postScale(
            scaleX * if (clip.transform.flipHorizontal) -1f else 1f,
            scaleY * if (clip.transform.flipVertical) -1f else 1f,
        )

        if (rotation != 0f) {
            // Square up, rotate, un-square, so the picture turns instead of shearing.
            matrix.postScale(1f, 1f / aspect)
            matrix.postRotate(rotation)
            matrix.postScale(1f, aspect)
        }

        // Y is inverted because NDC points up while screen coordinates — and
        // therefore the position values the user drags — point down.
        matrix.postTranslate(translateX, -translateY)

        return matrix
    }

    companion object {
        /**
         * Whether [clip] needs this effect at all.
         *
         * A clip with an identity transform and no animation gets no effect, so
         * the frame skips a shader pass entirely. On a low-tier device that is
         * the difference between a preview that keeps up and one that does not.
         */
        fun isNeeded(clip: Clip): Boolean {
            if (clip.hasAnimation) {
                return ANIMATABLE_BY_MATRIX.any { clip.track(it).keyframes.isNotEmpty() }
            }
            val t = clip.transform
            return t.positionX != 0f || t.positionY != 0f ||
                t.scaleX != 1f || t.scaleY != 1f ||
                t.rotationDegrees != 0f ||
                t.flipHorizontal || t.flipVertical
        }

        /**
         * The properties a matrix can express.
         *
         * Opacity is deliberately absent: alpha is not a geometric transform, so
         * animating it needs a shader program rather than a matrix. It is
         * modelled, evaluated and stored — `composeFrame` resolves it correctly —
         * but the renderer does not yet apply an animated value. See
         * `docs/02-feature-coverage.md`.
         */
        private val ANIMATABLE_BY_MATRIX = listOf(
            AnimatableProperty.POSITION_X,
            AnimatableProperty.POSITION_Y,
            AnimatableProperty.SCALE_X,
            AnimatableProperty.SCALE_Y,
            AnimatableProperty.ROTATION,
        )
    }
}
