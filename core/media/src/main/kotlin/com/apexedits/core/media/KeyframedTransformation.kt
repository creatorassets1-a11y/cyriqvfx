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
        val values = transformValuesAt(clip, presentationTimeUs, halfWidth, halfHeight, aspect)

        matrix.reset()
        matrix.postScale(values.scaleX, values.scaleY)
        if (values.rotationDegrees != 0f) {
            // Square up, rotate, un-square, so the picture turns instead of shearing.
            matrix.postScale(1f, 1f / aspect)
            matrix.postRotate(values.rotationDegrees)
            matrix.postScale(1f, aspect)
        }
        matrix.postTranslate(values.translateX, values.translateY)
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

/**
 * The values [KeyframedTransformation] feeds into its matrix, as plain numbers.
 *
 * Extracted from the matrix call so the arithmetic that is easy to get wrong —
 * the pixel-to-NDC conversion and the Y inversion — can be asserted on the JVM.
 * `android.graphics.Matrix` needs a device; this does not.
 */
data class TransformValues(
    val translateX: Float,
    val translateY: Float,
    val scaleX: Float,
    val scaleY: Float,
    val rotationDegrees: Float,
)

/**
 * Resolves [clip]'s transform at [presentationTimeUs] into normalised device
 * coordinates.
 *
 * Media3 draws into x ∈ [-1, 1], y ∈ [-1, 1] with the origin at the centre, so
 * position keyframes — authored in pixels against the project frame — are divided
 * by half the frame size. Y is negated because NDC points up while the on-screen
 * values the user drags point down.
 *
 * Flips fold into scale as a negative factor, which costs nothing extra in the
 * matrix and avoids a second pass over the frame.
 */
fun transformValuesAt(
    clip: Clip,
    presentationTimeUs: Long,
    halfWidth: Float,
    halfHeight: Float,
    aspect: Float,
): TransformValues {
    val time = clip.timelineStart + Ticks.ofMicros(presentationTimeUs.coerceAtLeast(0L))
    return TransformValues(
        translateX = clip.valueAt(AnimatableProperty.POSITION_X, time) / halfWidth,
        translateY = -clip.valueAt(AnimatableProperty.POSITION_Y, time) / halfHeight,
        scaleX = clip.valueAt(AnimatableProperty.SCALE_X, time) *
            if (clip.transform.flipHorizontal) -1f else 1f,
        scaleY = clip.valueAt(AnimatableProperty.SCALE_Y, time) *
            if (clip.transform.flipVertical) -1f else 1f,
        rotationDegrees = clip.valueAt(AnimatableProperty.ROTATION, time),
    )
}
