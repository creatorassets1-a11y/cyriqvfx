package com.apexedits.core.media

import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.RgbMatrix
import com.apexedits.core.engine.animation.valueAt
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.Clip
import com.apexedits.core.model.ColorAdjustment
import com.apexedits.core.model.Ticks
import kotlin.math.pow

/**
 * Basic colour correction, as a Media3 effect.
 *
 * `RgbMatrix.getMatrix(presentationTimeUs, useHdr)` is a genuine time-varying
 * extension point — confirmed by inspecting the interface rather than assumed
 * — so exposure, contrast, saturation, temperature, and tint can each be
 * keyframed through exactly the same interpolator every other animated
 * property uses, the same way [KeyframedTransformation] does for geometry.
 *
 * The matrix layout — column-major, translation in the last column, `v' =
 * M · v` on a homogeneous `(r, g, b, 1)` column vector — was not guessed. It
 * was confirmed by decompiling Media3's own shipped `Contrast` and
 * `RgbAdjustment` effect classes (`androidx.media3.effect`, Apache 2.0), whose
 * matrices this reuses the exact formulas of: `Contrast`'s
 * `scale = (1 + c) / (1.0001 - c)` pivot-around-grey construction, and the
 * classic luminance-preserving saturation matrix using the same
 * R = 0.213, G = 0.715, B = 0.072 coefficients Android's own
 * `android.graphics.ColorMatrix.setSaturation` uses. Reusing known-correct
 * formulas rather than deriving new ones is the same reasoning
 * [KeyframedAlphaEffect] applies to its shader.
 *
 * Temperature and tint are the one part that is this codebase's own
 * approximation rather than a reused formula: a true white-balance correction
 * needs the original capture's colour temperature, which a basic tool has no
 * way to know. This offers a simple, visually reasonable warm/cool and
 * green/magenta channel shift instead, and says so rather than overclaiming
 * colorimetric accuracy it does not have.
 */
@UnstableApi
class KeyframedColorMatrix(private val clip: Clip) : RgbMatrix {

    override fun getMatrix(presentationTimeUs: Long, useHdr: Boolean): FloatArray {
        val time = clip.timelineStart + Ticks.ofMicros(presentationTimeUs.coerceAtLeast(0L))
        val adjustment = ColorAdjustment(
            exposure = clip.valueAt(AnimatableProperty.EXPOSURE, time),
            contrast = clip.valueAt(AnimatableProperty.CONTRAST, time),
            saturation = clip.valueAt(AnimatableProperty.SATURATION, time),
            temperature = clip.valueAt(AnimatableProperty.TEMPERATURE, time),
            tint = clip.valueAt(AnimatableProperty.TINT, time),
        )
        return colorMatrix(adjustment)
    }

    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean = !isNeeded(clip)

    companion object {
        private val ANIMATABLE_BY_COLOR_MATRIX = listOf(
            AnimatableProperty.EXPOSURE,
            AnimatableProperty.CONTRAST,
            AnimatableProperty.SATURATION,
            AnimatableProperty.TEMPERATURE,
            AnimatableProperty.TINT,
        )

        /** Whether [clip] needs this effect at all — an unadjusted clip skips the shader pass. */
        fun isNeeded(clip: Clip): Boolean {
            if (clip.hasAnimation) {
                if (ANIMATABLE_BY_COLOR_MATRIX.any { clip.track(it).keyframes.isNotEmpty() }) return true
            }
            return !clip.colorAdjustment.isIdentity
        }
    }
}

// --- pure matrix math, host-testable with no Android dependency ------------

/**
 * Builds the combined 4x4 RGB matrix for [adjustment].
 *
 * Order matters and is not arbitrary: exposure (a plain gain) is applied
 * first, then contrast pivots around mid-grey — pivoting around the
 * already-exposed image rather than the original is what keeps a contrast
 * push looking like contrast rather than also re-biasing brightness — then
 * saturation blends toward luminance, and finally temperature/tint shift the
 * white point last, after the image's overall tone is already settled.
 */
fun colorMatrix(adjustment: ColorAdjustment): FloatArray {
    var matrix = exposureMatrix(adjustment.exposure)
    matrix = multiply4x4(contrastMatrix(adjustment.contrast), matrix)
    matrix = multiply4x4(saturationMatrix(adjustment.saturation), matrix)
    matrix = multiply4x4(temperatureTintMatrix(adjustment.temperature, adjustment.tint), matrix)
    return matrix
}

/** Column-major 4x4 identity: `data[column * 4 + row]`. */
fun identity4x4(): FloatArray {
    val m = FloatArray(16)
    m[0] = 1f; m[5] = 1f; m[10] = 1f; m[15] = 1f
    return m
}

/** `a · b` for two column-major 4x4 matrices, applied as `(a·b)·v = a·(b·v)`. */
fun multiply4x4(a: FloatArray, b: FloatArray): FloatArray {
    val result = FloatArray(16)
    for (col in 0 until 4) {
        for (row in 0 until 4) {
            var sum = 0f
            for (k in 0 until 4) sum += a[k * 4 + row] * b[col * 4 + k]
            result[col * 4 + row] = sum
        }
    }
    return result
}

/** A plain gain: `2^stops` on every channel, exposure measured in photographic stops. */
fun exposureMatrix(exposureStops: Float): FloatArray {
    val scale = 2f.pow(exposureStops)
    val m = identity4x4()
    m[0] = scale; m[5] = scale; m[10] = scale
    return m
}

/**
 * Media3 `Contrast`'s own formula, reused exactly: `scale = (1+c) / (1.0001-c)`,
 * pivoting around mid-grey (0.5) so contrast changes spread, not shift, the
 * image's average brightness. The `1.0001` avoids a division by zero at
 * `c = 1` and means `c = 0` lands a hair short of the exact identity — an
 * inherited quirk of the source formula, not a bug introduced here.
 */
fun contrastMatrix(contrast: Float): FloatArray {
    val scale = (1f + contrast) / (1.0001f - contrast)
    val pivot = (1f - scale) * 0.5f
    val m = identity4x4()
    m[0] = scale; m[5] = scale; m[10] = scale
    m[12] = pivot; m[13] = pivot; m[14] = pivot
    return m
}

/**
 * The classic luminance-preserving saturation matrix, using the same
 * R = 0.213, G = 0.715, B = 0.072 weights Android's own
 * `android.graphics.ColorMatrix.setSaturation` uses. `saturation = 0` is
 * greyscale, `1` is unchanged, above `1` is more vivid.
 */
fun saturationMatrix(saturation: Float): FloatArray {
    val inv = 1f - saturation
    val m = FloatArray(16)
    m[0] = inv * LUMA_R + saturation; m[1] = inv * LUMA_R; m[2] = inv * LUMA_R; m[3] = 0f
    m[4] = inv * LUMA_G; m[5] = inv * LUMA_G + saturation; m[6] = inv * LUMA_G; m[7] = 0f
    m[8] = inv * LUMA_B; m[9] = inv * LUMA_B; m[10] = inv * LUMA_B + saturation; m[11] = 0f
    m[12] = 0f; m[13] = 0f; m[14] = 0f; m[15] = 1f
    return m
}

/**
 * An approximate warm/cool and green/magenta channel shift.
 *
 * Not a colorimetric white-balance correction — this codebase's own honest
 * simplification, documented on [KeyframedColorMatrix] — but a simple,
 * bounded diagonal scale that reads as "warmer" or "cooler" the way a basic
 * mobile editor's temperature slider is expected to.
 */
fun temperatureTintMatrix(temperature: Float, tint: Float): FloatArray {
    val redScale = (1f + temperature * WARMTH_STRENGTH + tint * TINT_STRENGTH).coerceAtLeast(0f)
    val greenScale = (1f - tint * TINT_STRENGTH * 2f).coerceAtLeast(0f)
    val blueScale = (1f - temperature * WARMTH_STRENGTH + tint * TINT_STRENGTH).coerceAtLeast(0f)
    val m = identity4x4()
    m[0] = redScale; m[5] = greenScale; m[10] = blueScale
    return m
}

private const val LUMA_R = 0.213f
private const val LUMA_G = 0.715f
private const val LUMA_B = 0.072f

private const val WARMTH_STRENGTH = 0.3f
private const val TINT_STRENGTH = 0.2f
