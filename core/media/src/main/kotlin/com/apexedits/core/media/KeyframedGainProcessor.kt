package com.apexedits.core.media

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import com.apexedits.core.engine.animation.valueAt
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.Clip
import com.apexedits.core.model.Ticks
import java.nio.ByteBuffer
import kotlin.math.roundToInt

/**
 * Animated volume.
 *
 * The counterpart to [KeyframedTransformation] for sound: it applies the gain the
 * engine's interpolator produces, sample by sample, so a volume envelope drawn on
 * the timeline is what comes out of the export.
 *
 * ### Knowing where we are
 *
 * `queueInput` receives a buffer and **no timestamp**, which is the one awkward
 * part of the `AudioProcessor` contract for automation. Position is therefore
 * derived by counting: the sample rate is known from [onConfigure], so the frame
 * counter divided by that rate is the elapsed time, and every buffer advances it
 * by its own frame count.
 *
 * That counter is only correct if it is reset whenever playback jumps, which is
 * exactly what `flush` signals. [onFlush] takes the position offset Media3
 * supplies where it has one, so seeking mid-clip resumes at the right point in
 * the envelope rather than replaying it from the start.
 *
 * ### Why 16-bit only
 *
 * Media3's audio pipeline delivers `ENCODING_PCM_16BIT` by default, and declining
 * anything else through `UnhandledAudioFormatException` makes the pipeline insert
 * a conversion rather than silently handing this processor float samples it would
 * misread as integers.
 */
@UnstableApi
class KeyframedGainProcessor(
    private val clip: Clip,
) : BaseAudioProcessor() {

    /** Frames consumed since the last flush. One frame is one sample per channel. */
    private var framesProcessed: Long = 0

    /** Where in the clip this stream started, from the last flush. */
    private var startOffsetUs: Long = 0

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        // Gain does not change rate, channel count or encoding.
        return inputAudioFormat
    }

    /**
     * Active only when there is automation to apply.
     *
     * An inactive processor is bypassed entirely by the pipeline, so a clip
     * without a volume envelope costs nothing — no per-sample multiply, no extra
     * buffer copy. The static case is already handled by the clip's own volume.
     */
    override fun isActive(): Boolean =
        super.isActive() && clip.track(AnimatableProperty.VOLUME).isAnimated

    override fun queueInput(inputBuffer: ByteBuffer) {
        val position = inputBuffer.position()
        val limit = inputBuffer.limit()
        val bytes = limit - position
        if (bytes <= 0) return

        val channelCount = inputAudioFormat.channelCount
        val sampleRate = inputAudioFormat.sampleRate
        val bytesPerFrame = channelCount * BYTES_PER_SAMPLE

        val output = replaceOutputBuffer(bytes)
        var frame = framesProcessed
        var offset = position

        while (offset + bytesPerFrame <= limit) {
            // One gain value per frame rather than per sample: every channel of a
            // frame plays at the same instant, so computing it per sample would
            // do the interpolation work N times for an identical answer.
            val timeInClip = Ticks.ofMicros(
                startOffsetUs + frame * MICROS_PER_SECOND / sampleRate,
            )
            val gain = clip.valueAt(AnimatableProperty.VOLUME, clip.timelineStart + timeInClip)

            for (channel in 0 until channelCount) {
                val sample = inputBuffer.getShort(offset)
                output.putShort(scale(sample, gain))
                offset += BYTES_PER_SAMPLE
            }
            frame++
        }

        // A partial trailing frame would be a malformed buffer, but copying the
        // remainder verbatim is cheaper than failing on one.
        while (offset < limit) {
            output.put(inputBuffer.get(offset))
            offset++
        }

        framesProcessed = frame
        inputBuffer.position(limit)
        output.flip()
    }

    override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
        // A flush means playback jumped. Resuming the envelope from wherever the
        // stream now starts is what keeps a mid-clip seek in sync; restarting the
        // count from zero would replay the fade from the beginning.
        startOffsetUs = streamMetadata.positionOffsetUs
        framesProcessed = 0
    }

    override fun onFlush() {
        startOffsetUs = 0
        framesProcessed = 0
    }

    override fun onReset() {
        startOffsetUs = 0
        framesProcessed = 0
    }

    private companion object {
        const val BYTES_PER_SAMPLE = 2
        const val MICROS_PER_SECOND = 1_000_000L

        /**
         * Applies gain with saturation.
         *
         * The clamp matters: the volume property allows up to 2×, and a sample
         * near full scale multiplied by two overflows a `Short`. Wrapping would
         * turn a loud passage into loud noise — the classic symptom of an
         * unclamped gain stage — so it saturates instead.
         */
        fun scale(sample: Short, gain: Float): Short {
            if (gain == 1f) return sample
            val scaled = (sample * gain).roundToInt()
            return scaled.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
    }
}
