package com.apexedits.core.media

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import com.apexedits.core.engine.edit.appendClip
import com.apexedits.core.engine.edit.setClipPan
import com.apexedits.core.model.Clip
import com.apexedits.core.model.CountingIdSource
import com.apexedits.core.model.Project
import com.apexedits.core.model.SampleVideo
import com.apexedits.core.model.createClip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Stereo balance, checked sample by sample.
 *
 * Like [KeyframedGainProcessorTest], this is `ByteBuffer` arithmetic rather
 * than GPU work, so it is fully verifiable without a device.
 */
@RunWith(RobolectricTestRunner::class)
class PanProcessorTest {

    private val format = AudioProcessor.AudioFormat(
        SampleVideo.SAMPLE_RATE,
        SampleVideo.CHANNEL_COUNT,
        C.ENCODING_PCM_16BIT,
    )

    private fun project(): Pair<Project, String> {
        val ids = CountingIdSource()
        val base = SampleVideo.project(ids)
        val trackId = base.videoTracks.first().id
        val withClip = base.appendClip(trackId, createClip(ids, SampleVideo.mediaRef()))
        return withClip to withClip.track(trackId)!!.clips.single().id
    }

    private fun pannedClip(pan: Float): Clip {
        val (start, clipId) = project()
        return start.setClipPan(clipId, pan).clip(clipId)!!
    }

    /** Interleaved stereo PCM: every left sample is [left], every right is [right]. */
    private fun stereoPcm(frames: Int, left: Short, right: Short): ByteBuffer {
        val buffer = ByteBuffer.allocateDirect(frames * 2 * 2).order(ByteOrder.nativeOrder())
        repeat(frames) {
            buffer.putShort(left)
            buffer.putShort(right)
        }
        buffer.flip()
        return buffer
    }

    private fun ByteBuffer.shorts(): List<Short> {
        val out = mutableListOf<Short>()
        val copy = duplicate().order(ByteOrder.nativeOrder())
        while (copy.remaining() >= 2) out += copy.getShort()
        return out
    }

    @Test
    fun `a centred clip is inactive and costs nothing`() {
        val processor = PanProcessor(pannedClip(0f))
        processor.configure(format)
        assertFalse(processor.isActive)
    }

    @Test
    fun `an off-centre clip is active`() {
        val processor = PanProcessor(pannedClip(-0.5f))
        processor.configure(format)
        assertTrue(processor.isActive)
    }

    @Test
    fun `full left silences the right channel and leaves the left untouched`() {
        val processor = PanProcessor(pannedClip(-1f))
        processor.configure(format)
        processor.queueInput(stereoPcm(10, 10_000, 10_000))

        val output = processor.output.shorts()
        for (frame in 0 until 10) {
            assertEquals(10_000, output[frame * 2].toInt())
            assertEquals(0, output[frame * 2 + 1].toInt())
        }
    }

    @Test
    fun `full right silences the left channel and leaves the right untouched`() {
        val processor = PanProcessor(pannedClip(1f))
        processor.configure(format)
        processor.queueInput(stereoPcm(10, 10_000, 10_000))

        val output = processor.output.shorts()
        for (frame in 0 until 10) {
            assertEquals(0, output[frame * 2].toInt())
            assertEquals(10_000, output[frame * 2 + 1].toInt())
        }
    }

    @Test
    fun `a partial pan attenuates the far channel proportionally`() {
        val processor = PanProcessor(pannedClip(-0.5f))
        processor.configure(format)
        processor.queueInput(stereoPcm(1, 10_000, 10_000))

        val output = processor.output.shorts()
        assertEquals(10_000, output[0].toInt())
        assertEquals(5_000, output[1].toInt())
    }

    @Test
    fun `mono audio is left alone regardless of pan`() {
        val processor = PanProcessor(pannedClip(1f))
        val monoFormat = AudioProcessor.AudioFormat(SampleVideo.SAMPLE_RATE, 1, C.ENCODING_PCM_16BIT)
        processor.configure(monoFormat)

        assertFalse(processor.isActive)
    }

    @Test
    fun `the output format matches the input format`() {
        val processor = PanProcessor(pannedClip(-0.5f))
        val output = processor.configure(format)

        assertEquals(format.sampleRate, output.sampleRate)
        assertEquals(format.channelCount, output.channelCount)
        assertEquals(format.encoding, output.encoding)
    }

    @Test
    fun `a non-16-bit format is declined rather than silently misread`() {
        val processor = PanProcessor(pannedClip(-0.5f))
        val floatFormat = AudioProcessor.AudioFormat(44_100, 2, C.ENCODING_PCM_FLOAT)

        try {
            processor.configure(floatFormat)
            throw AssertionError("expected the float format to be declined")
        } catch (expected: AudioProcessor.UnhandledAudioFormatException) {
            // as intended
        }
    }
}
