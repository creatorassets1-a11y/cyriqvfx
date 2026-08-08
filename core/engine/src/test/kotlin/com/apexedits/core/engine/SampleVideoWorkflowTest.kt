package com.apexedits.core.engine

import com.apexedits.core.engine.animation.valueAt
import com.apexedits.core.engine.compose.composeFrame
import com.apexedits.core.engine.compose.compositionBoundaries
import com.apexedits.core.engine.edit.MIN_CLIP_DURATION
import com.apexedits.core.engine.edit.TrimEdge
import com.apexedits.core.engine.edit.addKeyframe
import com.apexedits.core.engine.edit.appendClip
import com.apexedits.core.engine.edit.rippleDeleteClip
import com.apexedits.core.engine.edit.setKeyframeEasing
import com.apexedits.core.engine.edit.splitClip
import com.apexedits.core.engine.edit.trimClip
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.CountingIdSource
import com.apexedits.core.model.Easing
import com.apexedits.core.model.SampleVideo
import com.apexedits.core.model.TICKS_PER_SECOND
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.createClip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The engine, exercised against a real clip's numbers.
 *
 * Everything else in the suite uses tidy synthetic fixtures — ten-second clips
 * starting at zero. Real footage is not tidy: this one is 33.034 seconds, its
 * frame is 576×640, and its audio track ends 24 ms before its video track. These
 * tests run the editorial operations at those numbers to catch the assumptions
 * that only round fixtures let you get away with.
 */
class SampleVideoWorkflowTest {

    private fun openProject() = CountingIdSource().let { ids ->
        val project = SampleVideo.project(ids)
        val trackId = project.videoTracks.first().id
        val withClip = project.appendClip(trackId, createClip(ids, SampleVideo.mediaRef()))
        Triple(withClip, trackId, ids)
    }

    // --- the timebase, against a real file ------------------------------------

    @Test
    fun `the clip's frame rate divides the tick base exactly`() {
        // 30 fps: 705,600,000 / 30 = 23,520,000 ticks, no remainder.
        assertEquals(0L, TICKS_PER_SECOND % 30)
        assertEquals(23_520_000L, SampleVideo.frameRate.ticksPerFrame.raw)
    }

    @Test
    fun `the clip's audio sample rate divides the tick base exactly`() {
        // 44,100 Hz: one sample is 16,000 ticks. The claim in Time.kt, checked
        // against the rate a real recording actually used.
        assertEquals(0L, TICKS_PER_SECOND % SampleVideo.SAMPLE_RATE)
        assertEquals(16_000L, TICKS_PER_SECOND / SampleVideo.SAMPLE_RATE)
    }

    @Test
    fun `the clip holds its full frame count with no rounding loss`() {
        val (project, _, _) = openProject()
        val clip = project.videoTracks.first().clips.single()

        // 33.034 s at 30 fps is 991 whole frames with 4 ms left over — the
        // container duration is slightly longer than the video track. Frame 990
        // must exist and frame 991 must not.
        val frames = SampleVideo.frameRate.frameAt(clip.timelineDuration)
        assertEquals(SampleVideo.FRAME_COUNT, frames)
        assertTrue(clip.contains(SampleVideo.frameRate.timeOfFrame(SampleVideo.FRAME_COUNT - 1)))
    }

    // --- the audio/video mismatch --------------------------------------------

    @Test
    fun `the clip's audio and video tracks really do disagree`() {
        // Guards the fixture itself: if this stops being true the tests below
        // stop testing what they claim to.
        assertEquals(24L, SampleVideo.audioVideoDriftMs)
        assertTrue(SampleVideo.AUDIO_TRACK_DURATION_MS < SampleVideo.VIDEO_TRACK_DURATION_MS)
    }

    @Test
    fun `the clip length comes from the container, not from either track`() {
        val (project, _, _) = openProject()
        val clip = project.videoTracks.first().clips.single()

        // Taking the video track's length would drop 1 ms; taking the audio
        // track's would drop 25 ms and desync everything after it on the
        // timeline. The container's movie duration is the only figure that
        // covers both, and it is what MediaMetadataRetriever reports.
        assertEquals(SampleVideo.duration, clip.timelineDuration)
        assertTrue(clip.timelineDuration.toMillis() >= SampleVideo.VIDEO_TRACK_DURATION_MS)
        assertTrue(clip.timelineDuration.toMillis() >= SampleVideo.AUDIO_TRACK_DURATION_MS)
    }

    @Test
    fun `a second copy starts exactly where the first ends despite the mismatch`() {
        val (start, trackId, ids) = openProject()
        val two = start.appendClip(trackId, createClip(ids, SampleVideo.mediaRef()))
        val clips = two.track(trackId)!!.ordered

        // No accumulated gap or overlap: the join is exact, which is the thing
        // a millisecond-rounded timebase would get wrong on the second clip and
        // visibly wrong by the twentieth.
        assertEquals(clips[0].timelineEnd, clips[1].timelineStart)
        assertEquals(SampleVideo.duration * 2, two.duration)
    }

    // --- editorial operations at real numbers --------------------------------

    @Test
    fun `splitting at frame 495 is frame-exact and loses nothing`() {
        val (start, trackId, ids) = openProject()
        val original = start.track(trackId)!!.clips.single()
        val at = SampleVideo.frameRate.timeOfFrame(495)

        val split = start.splitClip(ids, trackId, at)
        val clips = split.track(trackId)!!.ordered

        assertEquals(2, clips.size)
        assertEquals(at, clips[0].timelineEnd)
        assertEquals(at, clips[1].timelineStart)
        // The cut lands on a frame boundary in the source too, so neither half
        // starts mid-frame.
        assertEquals(at, SampleVideo.frameRate.snapToFrame(clips[0].sourceOut))
        // Nothing was lost or duplicated across the cut.
        assertEquals(original.sourceDuration, clips[0].sourceDuration + clips[1].sourceDuration)
        assertEquals(original.timelineEnd, clips[1].timelineEnd)
    }

    @Test
    fun `splitting every frame of a second leaves the total length untouched`() {
        val (start, trackId, ids) = openProject()
        var project = start

        // Thirty consecutive cuts. If tick arithmetic drifted at all, the sum of
        // the pieces would stop matching the original.
        for (frame in 300L until 330L) {
            project = project.splitClip(ids, trackId, SampleVideo.frameRate.timeOfFrame(frame))
        }

        val clips = project.track(trackId)!!.ordered
        assertEquals(31, clips.size)
        assertEquals(SampleVideo.duration, clips.last().timelineEnd)
        assertEquals(
            SampleVideo.duration,
            Ticks(clips.sumOf { it.timelineDuration.raw }),
        )
        // Every boundary is still on a frame.
        for (clip in clips.drop(1)) {
            assertEquals(clip.timelineStart, SampleVideo.frameRate.snapToFrame(clip.timelineStart))
        }
    }

    @Test
    fun `a ripple trim on real media closes the gap exactly`() {
        val (start, trackId, ids) = openProject()
        val two = start.appendClip(trackId, createClip(ids, SampleVideo.mediaRef()))
        val firstId = two.track(trackId)!!.ordered[0].id

        val target = SampleVideo.frameRate.timeOfFrame(600)
        val rippled = two.trimClip(firstId, TrimEdge.END, target, ripple = true)
        val clips = rippled.track(trackId)!!.ordered

        assertEquals(target, clips[0].timelineEnd)
        assertEquals(clips[0].timelineEnd, clips[1].timelineStart)
        assertEquals(target + SampleVideo.duration, rippled.duration)
    }

    @Test
    fun `trimming past the end of real media stops at the media`() {
        val (start, trackId, _) = openProject()
        val clipId = start.track(trackId)!!.clips.single().id

        // The importer reported 33.034 s; asking for a minute must not invent it.
        val trimmed = start.trimClip(clipId, TrimEdge.END, Ticks.ofSeconds(60.0))
        assertEquals(SampleVideo.duration, trimmed.clip(clipId)!!.timelineEnd)
    }

    @Test
    fun `a full edit round trip returns to the original length`() {
        val (start, trackId, ids) = openProject()
        val at = SampleVideo.frameRate.timeOfFrame(495)

        val edited = start
            .splitClip(ids, trackId, at)
            .let { p -> p.rippleDeleteClip(p.track(trackId)!!.ordered[1].id) }

        // Removing the second half and closing the gap leaves exactly the first.
        assertEquals(at, edited.duration)
        assertEquals(1, edited.track(trackId)!!.clips.size)
    }

    // --- animation at real numbers -------------------------------------------

    @Test
    fun `a fade across the real clip reaches its endpoints exactly`() {
        val (start, trackId, _) = openProject()
        val clipId = start.track(trackId)!!.clips.single().id
        val end = SampleVideo.duration

        val faded = start
            .addKeyframe(clipId, AnimatableProperty.OPACITY, Ticks.ZERO, 0f)
            .addKeyframe(clipId, AnimatableProperty.OPACITY, end, 1f)
            .setKeyframeEasing(clipId, AnimatableProperty.OPACITY, Ticks.ZERO, Easing.LINEAR)

        val clip = faded.clip(clipId)!!
        assertEquals(0f, clip.valueAt(AnimatableProperty.OPACITY, Ticks.ZERO), 0.0001f)
        assertEquals(1f, clip.valueAt(AnimatableProperty.OPACITY, end), 0.0001f)
        // Halfway through 33.034 s, not halfway through a round 33 s.
        assertEquals(0.5f, clip.valueAt(AnimatableProperty.OPACITY, Ticks(end.raw / 2)), 0.001f)
    }

    @Test
    fun `an animated frame composes with the clip's real dimensions`() {
        val (start, trackId, _) = openProject()
        val clipId = start.track(trackId)!!.clips.single().id

        val animated = start
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, SampleVideo.duration, 2f)
            .setKeyframeEasing(clipId, AnimatableProperty.SCALE_X, Ticks.ZERO, Easing.LINEAR)

        val frame = composeFrame(animated, SampleVideo.frameRate.timeOfFrame(495))
        assertEquals(SampleVideo.WIDTH, frame.width)
        assertEquals(SampleVideo.HEIGHT, frame.height)
        assertEquals(1, frame.layers.size)
        // The clip has sound, so the frame carries an audio layer too.
        assertEquals(1, frame.audio.size)
        assertTrue(frame.layers.single().transform.scaleX in 1.4f..1.6f)
    }

    @Test
    fun `composition boundaries land on frame boundaries after editing`() {
        val (start, trackId, ids) = openProject()
        val split = start
            .splitClip(ids, trackId, SampleVideo.frameRate.timeOfFrame(200))
            .splitClip(ids, trackId, SampleVideo.frameRate.timeOfFrame(700))

        val boundaries = compositionBoundaries(split)
        // Zero, two cuts, and the end.
        assertEquals(4, boundaries.size)
        for (boundary in boundaries.dropLast(1)) {
            assertEquals(boundary, SampleVideo.frameRate.snapToFrame(boundary))
        }
    }

    @Test
    fun `a clip shorter than one frame cannot be produced by any edit`() {
        val (start, trackId, ids) = openProject()
        // One frame at 60 fps is the floor; this clip is 30 fps, so a frame here
        // is comfortably above it and no edit may go below.
        assertTrue(SampleVideo.frameRate.ticksPerFrame > MIN_CLIP_DURATION)

        val nearEnd = SampleVideo.duration - Ticks(MIN_CLIP_DURATION.raw / 2)
        val refused = start.splitClip(ids, trackId, nearEnd)
        assertEquals(1, refused.track(trackId)!!.clips.size)
    }
}
