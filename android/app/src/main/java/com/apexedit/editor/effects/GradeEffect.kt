package com.apexedit.editor.effects

import android.content.Context
import android.opengl.GLES20
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import com.apexedit.editor.core.Grade

/**
 * The colour-grading pass.
 *
 * Everything Media3's built-in effects cannot express goes through this single
 * shader rather than a chain of passes: exposure, white balance, tone regions,
 * vibrance, fade, vignette and grain. One pass over the frame instead of six
 * matters a great deal on a mid-range phone at 1080p.
 *
 * Grading happens in linear light — exposure and white balance are physically
 * multiplicative and produce muddy results if applied to the display-encoded
 * signal — while tone regions and fade operate after re-encoding, which is
 * where their control points are meaningful to someone dragging a slider.
 */
@UnstableApi
class GradeEffect(private val grade: Grade) : GlEffect {

    override fun toGlShaderProgram(context: Context, useHdr: Boolean): BaseGlShaderProgram =
        GradeShaderProgram(context, useHdr, grade)

    /** Lets Media3 skip the pass entirely when there is nothing to do. */
    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean = grade.isNeutral

    private class GradeShaderProgram(
        context: Context,
        useHdr: Boolean,
        private val grade: Grade,
    ) : BaseGlShaderProgram(useHdr, 1) {

        private val program: GlProgram = try {
            GlProgram(VERTEX_SHADER, FRAGMENT_SHADER)
        } catch (e: GlUtil.GlException) {
            throw VideoFrameProcessingException(e)
        } catch (e: java.io.IOException) {
            throw VideoFrameProcessingException(e)
        }

        override fun configure(inputWidth: Int, inputHeight: Int): Size = Size(inputWidth, inputHeight)

        override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
            try {
                program.use()
                program.setSamplerTexIdUniform("uTexSampler", inputTexId, 0)
                program.setFloatsUniform("uTexTransform", GlUtil.create4x4IdentityMatrix())

                program.setFloatUniform("uExposure", grade.exposure)
                program.setFloatUniform("uTemperature", grade.temperature)
                program.setFloatUniform("uTint", grade.tint)
                program.setFloatUniform("uHighlights", grade.highlights)
                program.setFloatUniform("uShadows", grade.shadows)
                program.setFloatUniform("uVibrance", grade.vibrance)
                program.setFloatUniform("uVignette", grade.vignette)
                program.setFloatUniform("uGrain", grade.grain)
                program.setFloatUniform("uFade", grade.fade)
                // Grain must move, or it reads as a dirty lens rather than film.
                program.setFloatUniform("uTime", (presentationTimeUs % 1_000_000L) / 1_000_000f)

                program.bindAttributesAndUniforms()
                GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
                GlUtil.checkGlError()
            } catch (e: GlUtil.GlException) {
                throw VideoFrameProcessingException(e, presentationTimeUs)
            }
        }

        override fun release() {
            super.release()
            try {
                program.delete()
            } catch (e: GlUtil.GlException) {
                throw VideoFrameProcessingException(e)
            }
        }
    }

    private companion object {
        const val VERTEX_SHADER = """
            #version 100
            attribute vec4 aFramePosition;
            uniform mat4 uTexTransform;
            varying vec2 vTexCoord;
            void main() {
              gl_Position = aFramePosition;
              vTexCoord = (uTexTransform * vec4(aFramePosition.xy * 0.5 + 0.5, 0.0, 1.0)).xy;
            }
        """

        const val FRAGMENT_SHADER = """
            #version 100
            precision mediump float;
            uniform sampler2D uTexSampler;
            varying vec2 vTexCoord;

            uniform float uExposure;
            uniform float uTemperature;
            uniform float uTint;
            uniform float uHighlights;
            uniform float uShadows;
            uniform float uVibrance;
            uniform float uVignette;
            uniform float uGrain;
            uniform float uFade;
            uniform float uTime;

            const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

            vec3 toLinear(vec3 c) {
              return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
            }

            vec3 toDisplay(vec3 c) {
              c = max(c, 0.0);
              return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
            }

            float hash(vec2 p) {
              return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }

            void main() {
              vec4 texel = texture2D(uTexSampler, vTexCoord);
              vec3 c = texel.rgb;

              // --- linear-light section ---
              vec3 lin = toLinear(c);
              lin *= pow(2.0, uExposure);

              // Warm/cool pushes red against blue; tint pushes green against magenta.
              float t = uTemperature * 0.35;
              float g = uTint * 0.35;
              lin.r *= 1.0 + t;
              lin.b *= 1.0 - t;
              lin.g *= 1.0 + g;

              c = toDisplay(lin);

              // --- display-encoded section ---
              float l = dot(c, LUMA);
              // Smooth region weights so adjustments blend instead of banding.
              float shadowW = 1.0 - smoothstep(0.0, 0.5, l);
              float highlightW = smoothstep(0.5, 1.0, l);
              c += uShadows * 0.5 * shadowW;
              c += uHighlights * 0.5 * highlightW;

              if (abs(uVibrance) > 0.001) {
                // Weighted towards already-dull pixels, which is what keeps skin
                // tones from being the first thing to blow out.
                float mx = max(c.r, max(c.g, c.b));
                float mn = min(c.r, min(c.g, c.b));
                float weight = 1.0 - smoothstep(0.0, 0.8, mx - mn);
                c = mix(vec3(dot(c, LUMA)), c, 1.0 + uVibrance * weight);
              }

              if (uFade > 0.001) {
                // Lifts the black point for the washed film look.
                c = c * (1.0 - uFade) + uFade * 0.35;
              }

              if (uVignette > 0.001) {
                float d = distance(vTexCoord, vec2(0.5)) * 1.41421;
                c *= 1.0 - uVignette * smoothstep(0.35, 1.0, d);
              }

              if (uGrain > 0.001) {
                float n = hash(vTexCoord * 1024.0 + uTime * 60.0) - 0.5;
                c += n * uGrain * 0.25;
              }

              gl_FragColor = vec4(clamp(c, 0.0, 1.0), texel.a);
            }
        """
    }
}
