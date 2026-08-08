package com.apexedits.core.media

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import com.apexedits.core.model.Clip
import java.nio.ByteBuffer
import kotlin.math.roundToInt

/**
 * Stereo balance.
 *
 * [Clip.pan] is a static value, not a keyframed [com.apexedits.core.model.AnimatableProperty] —
 * the PRD's notion of pan is a per-clip balance control, not something an
 * editor animates mid-clip, so there is no interpolator involved here the way
 * [KeyframedGainProcessor] needs one for volume.
 *
 * This is a *balance* control rather than true equal-power panning: at
 * pan = -1 the right channel is silent and the left is untouched, and vice
 * versa. That is deliberate — a stereo source panned this way never gets
 * louder than its original level in either channel, so it cannot clip. A
 * mono source has no left/right to balance between and is left alone.
 */
@UnstableApi
class PanProcessor(private val clip: Clip) : BaseAudioProcessor() {

    /**
     * Tracked separately from the protected `inputAudioFormat`, which
     * [BaseAudioProcessor] only populates on [flush] — after [isActive] needs
     * to already have the right answer, since the pipeline calls it straight
     * after [configure].
     */
    private var channelCount = 0

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        channelCount = inputAudioFormat.channelCount
        return inputAudioFormat
    }

    /** Only stereo has a balance to adjust, and only when pan is off-centre. */
    override fun isActive(): Boolean = super.isActive() && clip.pan != 0f && channelCount == 2

    override fun queueInput(inputBuffer: ByteBuffer) {
        val position = inputBuffer.position()
        val limit = inputBuffer.limit()
        val bytes = limit - position
        if (bytes <= 0) return

        val (leftGain, rightGain) = gainsFor(clip.pan)
        val output = replaceOutputBuffer(bytes)
        var offset = position

        // Stereo, 16-bit: left sample, right sample, repeat.
        while (offset + FRAME_BYTES <= limit) {
            val left = inputBuffer.getShort(offset)
            val right = inputBuffer.getShort(offset + BYTES_PER_SAMPLE)
            output.putShort(scale(left, leftGain))
            output.putShort(scale(right, rightGain))
            offset += FRAME_BYTES
        }

        while (offset < limit) {
            output.put(inputBuffer.get(offset))
            offset++
        }

        inputBuffer.position(limit)
        output.flip()
    }

    private companion object {
        const val BYTES_PER_SAMPLE = 2
        const val FRAME_BYTES = BYTES_PER_SAMPLE * 2

        /**
         * Balance gains for [pan] in -1..1: the channel pan points away from is
         * attenuated, the channel it points toward stays at unity.
         */
        fun gainsFor(pan: Float): Pair<Float, Float> {
            val left = 1f - pan.coerceIn(0f, 1f)
            val right = 1f + pan.coerceIn(-1f, 0f)
            return left to right
        }

        fun scale(sample: Short, gain: Float): Short {
            if (gain == 1f) return sample
            val scaled = (sample * gain).roundToInt()
            return scaled.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
    }
}
