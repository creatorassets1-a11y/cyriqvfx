package com.apexedits.core.model

import org.junit.Assume.assumeTrue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Checks [SampleVideo] against the file it was measured from.
 *
 * The rest of the suite treats those constants as fact. This is the one test
 * that verifies they still are — because a fixture that has drifted from reality
 * keeps every test built on it passing while testing the wrong thing.
 *
 * The file is not in the repository, so this runs only when a path is supplied:
 *
 *     ./gradlew test -Papex.sampleVideo=/path/to/clip.mp4
 *
 * Without it the tests skip rather than fail, which is what keeps CI green
 * without anyone's footage in version control.
 */
class SampleVideoFixtureTest {

    private fun probe(): Mp4Probe.Info {
        val file = SampleVideo.fileOrNull()
        assumeTrue(
            "Set -P${SampleVideo.SYSTEM_PROPERTY}=<file> to check the fixture against real media",
            file != null,
        )
        return Mp4Probe.read(file!!)
    }

    @Test
    fun `the recorded file size matches`() {
        assertEquals(SampleVideo.SIZE_BYTES, probe().sizeBytes)
    }

    @Test
    fun `the recorded duration matches the container`() {
        val info = probe()
        // The movie duration, which is what MediaMetadataRetriever reports and
        // therefore what the importer will store.
        assertEquals(SampleVideo.DURATION_MS, info.durationMs)
    }

    @Test
    fun `the recorded frame dimensions match the video track`() {
        val video = probe().video
        assertNotNull("no video track found", video)
        assertEquals(SampleVideo.WIDTH, video!!.width)
        assertEquals(SampleVideo.HEIGHT, video.height)
    }

    @Test
    fun `the recorded frame count and rate match the video track`() {
        val video = probe().video!!
        assertEquals(SampleVideo.FRAME_COUNT, video.sampleCount)
        // Exactly 30, not approximately: 512 units per sample at a 15360
        // timescale. This is what makes the clip a clean test of the tick base.
        assertEquals(30.0, video.frameRate, 0.0001)
    }

    @Test
    fun `the recorded audio rate matches the audio track`() {
        val audio = probe().audio
        assertNotNull("no audio track found", audio)
        assertEquals(SampleVideo.SAMPLE_RATE, audio!!.timescale)
    }

    @Test
    fun `the audio and video tracks really are different lengths`() {
        val info = probe()
        val video = info.video!!
        val audio = info.audio!!

        assertEquals(SampleVideo.VIDEO_TRACK_DURATION_MS, video.durationMs)
        assertEquals(SampleVideo.AUDIO_TRACK_DURATION_MS, audio.durationMs)
        // The property several engine tests are built on: real recordings do not
        // end their tracks at the same instant.
        assertEquals(SampleVideo.audioVideoDriftMs, video.durationMs - audio.durationMs)
        assertTrue(video.durationMs > audio.durationMs)
    }

    @Test
    fun `the container is no shorter than either track`() {
        val info = probe()
        // Why the importer takes the movie duration rather than a track's: it is
        // the only figure that covers both.
        assertTrue(info.durationMs >= info.video!!.durationMs)
        assertTrue(info.durationMs >= info.audio!!.durationMs)
    }

    @Test
    fun `the file's frame rate and sample rate divide the tick base exactly`() {
        val info = probe()

        // The timebase argument, checked against a real recording rather than
        // against the rates the code chose to support.
        val fps = info.video!!.frameRate.toLong()
        assertEquals(30L, fps)
        assertEquals(0L, TICKS_PER_SECOND % fps)
        assertEquals(0L, TICKS_PER_SECOND % info.audio!!.timescale)

        // Note what is *not* claimed. This file stores video on a timescale of
        // 15360, and 705,600,000 / 15360 is 45,937.5 — not a whole number. That
        // is fine: a container's timescale is an arbitrary unit chosen by the
        // encoder, and nothing in ApexEdits works in it. What has to divide
        // exactly is the frame rate the user edits at and the sample rate the
        // audio plays at, and both do.
        assertEquals(15_360, info.video!!.timescale)
        assertTrue(TICKS_PER_SECOND % info.video!!.timescale != 0L)
    }
}
