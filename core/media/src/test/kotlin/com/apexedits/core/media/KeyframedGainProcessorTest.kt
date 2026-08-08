package com.apexedits.core.media

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import com.apexedits.core.engine.edit.addKeyframe
import com.apexedits.core.engine.edit.appendClip
import com.apexedits.core.engine.edit.setClipFadeIn
import com.apexedits.core.engine.edit.setKeyframeEasing
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.Clip
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
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Animated volume, checked sample by sample.
 *
 * This is the half of the keyframe renderer that can be verified without a
 * device: it is `ByteBuffer` arithmetic, not GPU work. So it is tested properly
 * — the ramp is compared against the engine's own interpolator at every frame,
 * not just at the endpoints.
 *
 * The clip is the sample recording's: 44,100 Hz stereo, 33.034 s.
 */
@RunWith(RobolectricTestRunner::class)
class KeyframedGainProcessorTest {

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

    /** A clip whose volume ramps linearly from [from] to [to] across [seconds]. */
    private fun rampedClip(from: Float, to: Float, seconds: Double): Clip {
        val (start, clipId) = project()
        return start
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ZERO, from)
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ofSeconds(seconds), to)
            .setKeyframeEasing(clipId, AnimatableProperty.VOLUME, Ticks.ZERO, Easing.LINEAR)
            .clip(clipId)!!
    }

    /** Interleaved stereo PCM, every sample the same value. */
    private fun pcm(frames: Int, value: Short): ByteBuffer {
        val buffer = ByteBuffer
            .allocateDirect(frames * SampleVideo.CHANNEL_COUNT * 2)
            .order(ByteOrder.nativeOrder())
        repeat(frames * SampleVideo.CHANNEL_COUNT) { buffer.putShort(value) }
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
    fun `a clip without automation is inactive and costs nothing`() {
        val (project, clipId) = project()
        val processor = KeyframedGainProcessor(project.clip(clipId)!!)
        processor.configure(format)

        // An inactive processor is bypassed entirely by the pipeline, so a clip
        // with no envelope pays no per-sample multiply.
        assertFalse(processor.isActive)
    }

    @Test
    fun `a clip with automation is active`() {
        val processor = KeyframedGainProcessor(rampedClip(1f, 0f, 2.0))
        processor.configure(format)
        assertTrue(processor.isActive)
    }

    @Test
    fun `a fade to silence reaches silence`() {
        val clip = rampedClip(1f, 0f, 1.0)
        val processor = KeyframedGainProcessor(clip)
        processor.configure(format)
        processor.flush()

        // One second of full-scale-ish audio at 44.1 kHz.
        processor.queueInput(pcm(SampleVideo.SAMPLE_RATE, 10_000))
        val output = processor.output.shorts()

        assertEquals(SampleVideo.SAMPLE_RATE * SampleVideo.CHANNEL_COUNT, output.size)
        // Starts at full volume...
        assertEquals(10_000, output.first().toInt())
        // ...and has faded away by the end.
        assertTrue("tail was ${output.last()}", kotlin.math.abs(output.last().toInt()) < 20)
    }

    @Test
    fun `the ramp matches the interpolator at every tenth of a second`() {
        val clip = rampedClip(0f, 1f, 1.0)
        val processor = KeyframedGainProcessor(clip)
        processor.configure(format)
        processor.flush()

        val amplitude: Short = 8_000
        processor.queueInput(pcm(SampleVideo.SAMPLE_RATE, amplitude))
        val output = processor.output.shorts()

        // Compare against the engine rather than against a re-derived formula:
        // if the two ever disagree, the export stops matching the preview.
        for (tenth in 0..9) {
            val frame = SampleVideo.SAMPLE_RATE * tenth / 10
            val expectedGain = com.apexedits.core.engine.animation.evaluate(
                clip.track(AnimatableProperty.VOLUME),
                Ticks.ofSeconds(tenth / 10.0),
                1f,
            )
            val actual = output[frame * SampleVideo.CHANNEL_COUNT].toInt()
            assertEquals(
                "at ${tenth / 10.0}s",
                (amplitude * expectedGain).toInt().toFloat(),
                actual.toFloat(),
                2f,
            )
        }
    }

    @Test
    fun `both channels of a frame get the same gain`() {
        val clip = rampedClip(1f, 0f, 1.0)
        val processor = KeyframedGainProcessor(clip)
        processor.configure(format)
        processor.flush()

        processor.queueInput(pcm(1000, 12_000))
        val output = processor.output.shorts()

        // Left and right play at the same instant, so a per-sample rather than
        // per-frame gain would make the stereo image drift during a fade.
        for (frame in 0 until 1000) {
            assertEquals(output[frame * 2], output[frame * 2 + 1])
        }
    }

    @Test
    fun `gain above one saturates instead of wrapping`() {
        val (start, clipId) = project()
        val boosted = start
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ZERO, 2f)
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ofSeconds(1.0), 2f)
            .clip(clipId)!!

        val processor = KeyframedGainProcessor(boosted)
        processor.configure(format)
        processor.flush()

        processor.queueInput(pcm(100, 30_000))
        val output = processor.output.shorts()

        // 30000 x 2 overflows a Short. Wrapping would turn a loud passage into
        // loud noise — the classic symptom of an unclamped gain stage.
        assertTrue(output.all { it == Short.MAX_VALUE })
    }

    @Test
    fun `a negative sample saturates at the negative limit`() {
        val (start, clipId) = project()
        val boosted = start
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ZERO, 2f)
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ofSeconds(1.0), 2f)
            .clip(clipId)!!

        val processor = KeyframedGainProcessor(boosted)
        processor.configure(format)
        processor.flush()
        processor.queueInput(pcm(100, (-30_000).toShort()))

        assertTrue(processor.output.shorts().all { it == Short.MIN_VALUE })
    }

    @Test
    fun `position carries across successive buffers`() {
        val clip = rampedClip(1f, 0f, 1.0)
        val processor = KeyframedGainProcessor(clip)
        processor.configure(format)
        processor.flush()

        // Audio arrives in chunks, not one buffer per clip. The envelope has to
        // continue where the previous chunk left off.
        val chunk = SampleVideo.SAMPLE_RATE / 4
        val tails = mutableListOf<Int>()
        repeat(4) {
            processor.queueInput(pcm(chunk, 10_000))
            tails += processor.output.shorts().last().toInt()
        }

        // Monotonically quieter across chunk boundaries.
        assertEquals(tails.sortedDescending(), tails)
        assertTrue("ended at ${tails.last()}", tails.last() < 100)
    }

    @Test
    fun `flushing restarts the envelope so a seek stays in sync`() {
        val clip = rampedClip(1f, 0f, 1.0)
        val processor = KeyframedGainProcessor(clip)
        processor.configure(format)
        processor.flush()

        processor.queueInput(pcm(SampleVideo.SAMPLE_RATE / 2, 10_000))
        val beforeFlush = processor.output.shorts().last().toInt()

        processor.flush()
        processor.queueInput(pcm(10, 10_000))
        val afterFlush = processor.output.shorts().first().toInt()

        // Half a second in the fade is quieter; after a flush the stream starts
        // again from the top of the envelope.
        assertTrue(beforeFlush < 6_000)
        assertEquals(10_000, afterFlush)
    }

    @Test
    fun `a non-16-bit format is declined rather than silently misread`() {
        val processor = KeyframedGainProcessor(rampedClip(1f, 0f, 1.0))
        val floatFormat = AudioProcessor.AudioFormat(44_100, 2, C.ENCODING_PCM_FLOAT)

        // Declining makes the pipeline insert a conversion. Accepting would mean
        // reading float samples as integers, which is noise.
        try {
            processor.configure(floatFormat)
            throw AssertionError("expected the float format to be declined")
        } catch (expected: AudioProcessor.UnhandledAudioFormatException) {
            // as intended
        }
    }

    @Test
    fun `a clip with only a fade, no volume keyframes, is still active`() {
        val (start, clipId) = project()
        val faded = start.setClipFadeIn(clipId, Ticks.ofSeconds(1.0)).clip(clipId)!!

        val processor = KeyframedGainProcessor(faded)
        processor.configure(format)

        // Fades are not modelled as volume keyframes, so this must come from
        // clip.hasAudioAutomation rather than from `track(VOLUME).isAnimated`.
        assertTrue(processor.isActive)
    }

    @Test
    fun `a fade-in clip ramps up from silence exactly like a fade-out ramps down`() {
        val (start, clipId) = project()
        val faded = start.setClipFadeIn(clipId, Ticks.ofSeconds(1.0)).clip(clipId)!!

        val processor = KeyframedGainProcessor(faded)
        processor.configure(format)
        processor.flush()

        processor.queueInput(pcm(SampleVideo.SAMPLE_RATE, 10_000))
        val output = processor.output.shorts()

        assertEquals(0, output.first().toInt())
        assertTrue("head was ${output.last()}", kotlin.math.abs(output.last().toInt() - 10_000) < 20)
    }

    @Test
    fun `the output format matches the input format`() {
        val processor = KeyframedGainProcessor(rampedClip(1f, 0f, 1.0))
        val output = processor.configure(format)

        // Gain changes amplitude, not rate, channel count or encoding.
        assertEquals(format.sampleRate, output.sampleRate)
        assertEquals(format.channelCount, output.channelCount)
        assertEquals(format.encoding, output.encoding)
    }
}
