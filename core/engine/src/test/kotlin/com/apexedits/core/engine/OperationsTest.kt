package com.apexedits.core.engine

import com.apexedits.core.engine.edit.MIN_CLIP_DURATION
import com.apexedits.core.engine.edit.TrimEdge
import com.apexedits.core.engine.edit.addTrack
import com.apexedits.core.engine.edit.appendClip
import com.apexedits.core.engine.edit.deleteClip
import com.apexedits.core.engine.edit.duplicateClip
import com.apexedits.core.engine.edit.moveClip
import com.apexedits.core.engine.edit.relinkMedia
import com.apexedits.core.engine.edit.rippleDeleteClip
import com.apexedits.core.engine.edit.setClipSpeed
import com.apexedits.core.engine.edit.setTrackLocked
import com.apexedits.core.engine.edit.splitClip
import com.apexedits.core.engine.edit.trimClip
import com.apexedits.core.model.AspectRatio
import com.apexedits.core.model.CountingIdSource
import com.apexedits.core.model.FrameRate
import com.apexedits.core.model.MediaKind
import com.apexedits.core.model.MediaRef
import com.apexedits.core.model.Project
import com.apexedits.core.model.ProjectFormat
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.TrackKind
import com.apexedits.core.model.createClip
import com.apexedits.core.model.createProject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

private fun seconds(value: Double) = Ticks.ofSeconds(value)

/** A ten-second video with sound, enough for every case here. */
private fun testMedia(id: String = "media-1", duration: Double = 10.0) = MediaRef(
    id = id,
    uri = "file:///test/$id.mp4",
    displayName = "$id.mp4",
    kind = MediaKind.VIDEO,
    duration = seconds(duration),
    width = 1920,
    height = 1080,
    hasAudio = true,
)

/** A project with one ten-second clip on the first video track, starting at zero. */
private fun projectWithOneClip(): Pair<Project, CountingIdSource> {
    val ids = CountingIdSource()
    val media = testMedia()
    var project = createProject(
        ids = ids,
        name = "Test",
        format = ProjectFormat.of(AspectRatio.VERTICAL_9_16, 1080, FrameRate.FPS_30),
    ).copy(media = listOf(media))
    val trackId = project.videoTracks.first().id
    project = project.appendClip(trackId, createClip(ids, media))
    return project to ids
}

class OperationsTest {

    // --- split ---------------------------------------------------------------

    @Test
    fun `split produces two clips that together cover the original`() {
        val (project, ids) = projectWithOneClip()
        val track = project.videoTracks.first()
        val original = track.clips.single()

        val split = project.splitClip(ids, track.id, seconds(4.0))
        val clips = split.track(track.id)!!.ordered

        assertEquals(2, clips.size)
        assertEquals(original.timelineStart, clips[0].timelineStart)
        assertEquals(seconds(4.0), clips[0].timelineEnd)
        assertEquals(seconds(4.0), clips[1].timelineStart)
        assertEquals(original.timelineEnd, clips[1].timelineEnd)
        // No frames lost or repeated across the cut.
        assertEquals(clips[0].sourceOut, clips[1].sourceIn)
        assertEquals(original.sourceDuration, clips[0].sourceDuration + clips[1].sourceDuration)
    }

    @Test
    fun `split outside any clip changes nothing`() {
        val (project, ids) = projectWithOneClip()
        val track = project.videoTracks.first()
        assertSame(project, project.splitClip(ids, track.id, seconds(30.0)))
    }

    @Test
    fun `split too close to an edge is refused rather than leaving a sliver`() {
        val (project, ids) = projectWithOneClip()
        val track = project.videoTracks.first()
        val tooClose = Ticks(MIN_CLIP_DURATION.raw / 2)
        assertSame(project, project.splitClip(ids, track.id, tooClose))
    }

    @Test
    fun `split on a locked track changes nothing`() {
        val (start, ids) = projectWithOneClip()
        val track = start.videoTracks.first()
        val locked = start.setTrackLocked(track.id, true)
        assertEquals(1, locked.splitClip(ids, track.id, seconds(4.0)).track(track.id)!!.clips.size)
    }

    @Test
    fun `split of a retimed clip cuts at the frame the user sees`() {
        val (start, ids) = projectWithOneClip()
        val track = start.videoTracks.first()
        val clipId = track.clips.single().id
        // At 2x, ten seconds of media occupies five seconds of timeline.
        val fast = start.setClipSpeed(clipId, 2f)
        assertEquals(seconds(5.0), fast.clip(clipId)!!.timelineDuration)

        val split = fast.splitClip(ids, track.id, seconds(2.5))
        val clips = split.track(track.id)!!.ordered
        // Halfway along the timeline is halfway through the source, not 2.5 s in.
        assertEquals(seconds(5.0), clips[0].sourceOut)
        assertEquals(seconds(5.0), clips[1].sourceIn)
    }

    // --- trim ----------------------------------------------------------------

    @Test
    fun `trimming the end shortens the clip`() {
        val (project, _) = projectWithOneClip()
        val clipId = project.videoTracks.first().clips.single().id

        val trimmed = project.trimClip(clipId, TrimEdge.END, seconds(6.0))
        assertEquals(seconds(6.0), trimmed.clip(clipId)!!.timelineEnd)
    }

    @Test
    fun `trimming past the end of the media stops at the media`() {
        val (project, _) = projectWithOneClip()
        val clipId = project.videoTracks.first().clips.single().id

        // The source is ten seconds long; asking for thirty must not invent frames.
        val trimmed = project.trimClip(clipId, TrimEdge.END, seconds(30.0))
        assertEquals(seconds(10.0), trimmed.clip(clipId)!!.timelineEnd)
    }

    @Test
    fun `trimming an edge past the far edge stops at the minimum duration`() {
        val (project, _) = projectWithOneClip()
        val clipId = project.videoTracks.first().clips.single().id

        val collapsed = project.trimClip(clipId, TrimEdge.END, Ticks.ZERO)
        assertEquals(MIN_CLIP_DURATION, collapsed.clip(clipId)!!.timelineDuration)
    }

    @Test
    fun `trimming the start moves into the source rather than dropping frames`() {
        val (project, _) = projectWithOneClip()
        val clipId = project.videoTracks.first().clips.single().id

        val trimmed = project.trimClip(clipId, TrimEdge.START, seconds(3.0))
        val clip = trimmed.clip(clipId)!!
        assertEquals(seconds(3.0), clip.timelineStart)
        assertEquals(seconds(3.0), clip.sourceIn)
        assertEquals(seconds(7.0), clip.timelineDuration)
    }

    @Test
    fun `a ripple trim closes the gap it would have opened`() {
        val (start, ids) = projectWithOneClip()
        val track = start.videoTracks.first()
        val second = start.appendClip(track.id, createClip(ids, testMedia()))
        val clips = second.track(track.id)!!.ordered
        val firstId = clips[0].id
        val secondStartBefore = clips[1].timelineStart

        val rippled = second.trimClip(firstId, TrimEdge.END, seconds(6.0), ripple = true)
        val after = rippled.track(track.id)!!.ordered

        assertEquals(seconds(6.0), after[0].timelineEnd)
        // The follower moved back by exactly what the first clip lost.
        assertEquals(secondStartBefore - seconds(4.0), after[1].timelineStart)
        assertEquals(after[0].timelineEnd, after[1].timelineStart)
    }

    @Test
    fun `without ripple a neighbour blocks the trim`() {
        val (start, ids) = projectWithOneClip()
        val track = start.videoTracks.first()
        var project = start.appendClip(track.id, createClip(ids, testMedia()))
        val secondId = project.track(track.id)!!.ordered[1].id

        // Dragging the second clip's start left, into the first clip.
        project = project.trimClip(secondId, TrimEdge.START, seconds(5.0))
        assertEquals(seconds(10.0), project.clip(secondId)!!.timelineStart)
    }

    // --- delete --------------------------------------------------------------

    @Test
    fun `delete leaves a gap and ripple delete closes it`() {
        val (start, ids) = projectWithOneClip()
        val track = start.videoTracks.first()
        var project = start.appendClip(track.id, createClip(ids, testMedia()))
        project = project.appendClip(track.id, createClip(ids, testMedia()))
        val ordered = project.track(track.id)!!.ordered
        val middleId = ordered[1].id
        val lastStart = ordered[2].timelineStart

        val gapped = project.deleteClip(middleId)
        assertNull(gapped.clip(middleId))
        assertEquals(lastStart, gapped.track(track.id)!!.ordered[1].timelineStart)

        val closed = project.rippleDeleteClip(middleId)
        assertEquals(seconds(10.0), closed.track(track.id)!!.ordered[1].timelineStart)
    }

    @Test
    fun `deleting from a locked track changes nothing`() {
        val (start, _) = projectWithOneClip()
        val track = start.videoTracks.first()
        val clipId = track.clips.single().id
        val locked = start.setTrackLocked(track.id, true)
        assertNotNull(locked.deleteClip(clipId).clip(clipId))
    }

    // --- move ----------------------------------------------------------------

    @Test
    fun `a move onto a track of a different kind is refused`() {
        val (project, _) = projectWithOneClip()
        val clipId = project.videoTracks.first().clips.single().id
        val audioTrackId = project.audioTracks.first().id

        // Video does not belong on an audio track.
        assertSame(project, project.moveClip(clipId, seconds(1.0), audioTrackId))
    }

    @Test
    fun `dragging off the left edge parks the clip at zero`() {
        val (project, _) = projectWithOneClip()
        val clipId = project.videoTracks.first().clips.single().id

        val moved = project.moveClip(clipId, seconds(-5.0))
        assertEquals(Ticks.ZERO, moved.clip(clipId)!!.timelineStart)
    }

    @Test
    fun `a move between video tracks carries the clip across`() {
        val (start, ids) = projectWithOneClip()
        val source = start.videoTracks.first()
        val target = start.videoTracks[1]
        val clipId = source.clips.single().id

        val moved = start.moveClip(clipId, seconds(2.0), target.id)
        assertTrue(moved.track(source.id)!!.clips.isEmpty())
        assertEquals(seconds(2.0), moved.track(target.id)!!.clips.single().timelineStart)
        // Still exactly one copy of it in the document.
        assertEquals(1, moved.tracks.sumOf { t -> t.clips.count { it.id == clipId } })
    }

    // --- general contract ----------------------------------------------------

    @Test
    fun `every operation on a missing id returns the document unchanged`() {
        val (project, ids) = projectWithOneClip()
        // The gesture layer can hand the engine a stale id after a delete. None
        // of these may throw; all must be no-ops.
        assertSame(project, project.deleteClip("nope"))
        assertSame(project, project.rippleDeleteClip("nope"))
        assertSame(project, project.moveClip("nope", seconds(1.0)))
        assertSame(project, project.trimClip("nope", TrimEdge.END, seconds(1.0)))
        assertSame(project, project.duplicateClip(ids, "nope"))
        assertSame(project, project.splitClip(ids, "nope", seconds(1.0)))
        assertSame(project, project.setClipSpeed("nope", 2f))
        assertSame(project, project.relinkMedia("nope", "file:///x"))
    }

    @Test
    fun `speed is clamped to the supported range instead of rejected`() {
        val (project, _) = projectWithOneClip()
        val clipId = project.videoTracks.first().clips.single().id

        assertEquals(0.1f, project.setClipSpeed(clipId, 0f).clip(clipId)!!.speed, 0.0001f)
        assertEquals(100f, project.setClipSpeed(clipId, 1000f).clip(clipId)!!.speed, 0.0001f)
    }

    @Test
    fun `a mutation bumps the revision so autosave can skip no-ops`() {
        val (project, _) = projectWithOneClip()
        val clipId = project.videoTracks.first().clips.single().id

        val changed = project.setClipSpeed(clipId, 2f)
        assertTrue(changed.revision > project.revision)
        // Setting the same value again is not a change.
        assertEquals(changed.revision, changed.setClipSpeed(clipId, 2f).revision)
    }

    @Test
    fun `adding tracks keeps video above audio`() {
        val (project, ids) = projectWithOneClip()
        val grown = project.addTrack(ids, TrackKind.VIDEO).addTrack(ids, TrackKind.AUDIO)
        val kinds = grown.tracks.map { it.kind }
        assertEquals(kinds.sortedBy { if (it == TrackKind.VIDEO) 0 else 1 }, kinds)
    }

    @Test
    fun `duplicate places the copy immediately after the original`() {
        val (project, ids) = projectWithOneClip()
        val original = project.videoTracks.first().clips.single()

        val duplicated = project.duplicateClip(ids, original.id)
        val clips = duplicated.videoTracks.first().ordered
        assertEquals(2, clips.size)
        assertEquals(original.timelineEnd, clips[1].timelineStart)
        assertTrue(clips[0].id != clips[1].id)
    }
}
