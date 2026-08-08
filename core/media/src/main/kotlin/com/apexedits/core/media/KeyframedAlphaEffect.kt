package com.apexedits.core.media

import android.content.Context
import android.opengl.GLES20
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import com.apexedits.core.engine.animation.valueAt
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.Clip
import com.apexedits.core.model.Ticks

/**
 * Animated opacity.
 *
 * A matrix expresses geometry, so [KeyframedTransformation] can carry position,
 * scale and rotation but not alpha. Opacity needs the fragment shader to know the
 * value for the frame it is drawing, which is what this provides: the same
 * interpolator, evaluated in `drawFrame` where the presentation time is available.
 *
 * The shader itself is deliberately unoriginal. Media3 ships
 * `fragment_shader_alpha_scale_es2.glsl`, whose body is exactly
 * `gl_FragColor = vec4(src.rgb, src.a * uAlphaScale)`; that is adopted verbatim
 * (Apache 2.0 — attributed in `docs/LICENSES.md`). The only difference from
 * Media3's own `AlphaScale` effect is *when* the uniform is set: once at
 * construction there, per frame here.
 *
 * Keeping the GLSL identical to a shader that already ships and works is the
 * point. Hand-written GLSL is the part of this codebase least amenable to
 * testing without a GPU, so the way to be confident about it is to not write
 * anything novel.
 */
@UnstableApi
class KeyframedAlphaEffect(private val clip: Clip) : GlEffect {

    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
        KeyframedAlphaShaderProgram(clip, useHdr)

    /**
     * Skips the shader pass entirely for a clip that is fully opaque and not
     * animated. On a low-tier device an avoided pass over every frame is the
     * difference between a preview that keeps up and one that does not.
     */
    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean = !isNeeded(clip)

    companion object {
        fun isNeeded(clip: Clip): Boolean =
            clip.track(AnimatableProperty.OPACITY).isAnimated || clip.transform.opacity < 1f
    }
}

@UnstableApi
private class KeyframedAlphaShaderProgram(
    private val clip: Clip,
    useHdr: Boolean,
) : BaseGlShaderProgram(/* useHighPrecisionColorComponents= */ useHdr, /* texturePoolCapacity= */ 1) {

    private val program: GlProgram = try {
        GlProgram(VERTEX_SHADER, FRAGMENT_SHADER)
    } catch (error: GlUtil.GlException) {
        throw VideoFrameProcessingException(error)
    }

    init {
        // A full-screen quad in normalised device coordinates. The same geometry
        // Media3's own passthrough programs use.
        program.setBufferAttribute(
            "aFramePosition",
            GlUtil.getNormalizedCoordinateBounds(),
            GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE,
        )
    }

    override fun configure(inputWidth: Int, inputHeight: Int): Size = Size(inputWidth, inputHeight)

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        try {
            program.use()
            program.setSamplerTexIdUniform("uTexSampler", inputTexId, /* texUnitIndex= */ 0)

            // Media3 reports time relative to this item's own media, and the
            // engine stores keyframes relative to the clip. They coincide because
            // CompositionBuilder emits one EditedMediaItem per clip.
            val time = clip.timelineStart + Ticks.ofMicros(presentationTimeUs.coerceAtLeast(0L))
            val alpha = clip.valueAt(AnimatableProperty.OPACITY, time).coerceIn(0f, 1f)
            program.setFloatUniform("uAlphaScale", alpha)

            program.bindAttributesAndUniforms()
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, /* first= */ 0, /* count= */ 4)
            GlUtil.checkGlError()
        } catch (error: GlUtil.GlException) {
            throw VideoFrameProcessingException(error, presentationTimeUs)
        }
    }

    override fun release() {
        super.release()
        try {
            program.delete()
        } catch (error: GlUtil.GlException) {
            throw VideoFrameProcessingException(error)
        }
    }

    private companion object {
        /** Pass-through: no geometry change, so the quad is drawn as given. */
        const val VERTEX_SHADER = """#version 100
attribute vec4 aFramePosition;
varying vec2 vTexSamplingCoord;
void main() {
  gl_Position = aFramePosition;
  vTexSamplingCoord = vec2(aFramePosition.x * 0.5 + 0.5, aFramePosition.y * 0.5 + 0.5);
}
"""

        /**
         * Media3's `fragment_shader_alpha_scale_es2.glsl`, adopted unchanged.
         * Copyright 2023 The Android Open Source Project, Apache License 2.0.
         */
        const val FRAGMENT_SHADER = """#version 100
precision mediump float;
uniform sampler2D uTexSampler;
uniform float uAlphaScale;
varying vec2 vTexSamplingCoord;
void main() {
  vec4 src = texture2D(uTexSampler, vTexSamplingCoord);
  gl_FragColor = vec4(src.rgb, src.a * uAlphaScale);
}
"""
    }
}
