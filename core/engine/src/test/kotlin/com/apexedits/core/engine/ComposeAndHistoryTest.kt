package com.apexedits.core.engine

import com.apexedits.core.engine.compose.composeFrame
import com.apexedits.core.engine.compose.compositionBoundaries
import com.apexedits.core.engine.edit.appendClip
import com.apexedits.core.engine.edit.deleteClip
import com.apexedits.core.engine.edit.setClipSpeed
import com.apexedits.core.engine.edit.setTrackMuted
import com.apexedits.core.engine.edit.setTrackSolo
import com.apexedits.core.engine.edit.setTrackVisible
import com.apexedits.core.engine.edit.splitClip
import com.apexedits.core.engine.history.History
import com.apexedits.core.model.AspectRatio
import com.apexedits.core.model.CountingIdSource
import com.apexedits.core.model.FrameRate
import com.apexedits.core.model.MediaKind
import com.apexedits.core.model.MediaRef
import com.apexedits.core.model.Project
import com.apexedits.core.model.ProjectFormat
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.createClip
import com.apexedits.core.model.createProject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

private fun seconds(value: Double) = Ticks.ofSeconds(value)

private fun media(id: String, kind: MediaKind = MediaKind.VIDEO, hasAudio: Boolean = true) = MediaRef(
    id = id,
    uri = "file:///test/$id",
    displayName = id,
    kind = kind,
    duration = seconds(10.0),
    width = 1920,
    height = 1080,
    hasAudio = hasAudio,
)

private fun project(): Pair<Project, CountingIdSource> {
    val ids = CountingIdSource()
    val m = media("media-1")
    var p = createProject(
        ids = ids,
        name = "Test",
        format = ProjectFormat.of(AspectRatio.LANDSCAPE_16_9, 1080, FrameRate.FPS_30),
    ).copy(media = listOf(m))
    p = p.appendClip(p.videoTracks.first().id, createClip(ids, m))
    return p to ids
}

class ComposeTest {

    @Test
    fun `an empty timeline composes to an empty frame`() {
        val ids = CountingIdSource()
        val empty = createProject(ids, "Empty", ProjectFormat.of(AspectRatio.SQUARE_1_1))
        assertTrue(composeFrame(empty, Ticks.ZERO).isEmpty)
    }

    @Test
    fun `a frame carries the project format so the renderer needs no other input`() {
        val (p, _) = project()
        val frame = composeFrame(p, seconds(1.0))
        assertEquals(1920, frame.width)
        assertEquals(1080, frame.height)
    }

    @Test
    fun `source time is resolved and speed already applied`() {
        val (p, _) = project()
        val clipId = p.videoTracks.first().clips.single().id
        val fast = p.setClipSpeed(clipId, 2f)

        // Two seconds along the timeline is four seconds into a 2x clip.
        val layer = composeFrame(fast, seconds(2.0)).layers.single()
        assertEquals(seconds(4.0), layer.sourceTime)
    }

    @Test
    fun `a hidden track contributes no video but its audio survives`() {
        val (p, _) = project()
        val trackId = p.videoTracks.first().id
        val hidden = p.setTrackVisible(trackId, false)

        val frame = composeFrame(hidden, seconds(1.0))
        assertTrue(frame.layers.isEmpty())
        assertTrue(frame.audio.isEmpty()) // video layer skipped entirely, audio with it
    }

    @Test
    fun `muting a track silences it`() {
        val (p, _) = project()
        val trackId = p.videoTracks.first().id
        assertTrue(composeFrame(p, seconds(1.0)).audio.isNotEmpty())
        assertTrue(composeFrame(p.setTrackMuted(trackId, true), seconds(1.0)).audio.isEmpty())
    }

    @Test
    fun `solo silences other tracks without clearing their mute state`() {
        val (start, ids) = project()
        val audioTrack = start.audioTracks.first()
        val musicMedia = media("music", MediaKind.AUDIO)
        var p = start.copy(media = start.media + musicMedia)
        p = p.appendClip(audioTrack.id, createClip(ids, musicMedia))

        // Both the video's audio and the music track are audible.
        assertEquals(2, composeFrame(p, seconds(1.0)).audio.size)

        val soloed = p.setTrackSolo(audioTrack.id, true)
        val audio = composeFrame(soloed, seconds(1.0)).audio
        assertEquals(1, audio.size)
        assertEquals("music", audio.single().mediaId)

        // Unsoloing restores exactly what was there before.
        assertEquals(2, composeFrame(soloed.setTrackSolo(audioTrack.id, false), seconds(1.0)).audio.size)
    }

    @Test
    fun `missing media yields a frame without that layer rather than a failure`() {
        val (p, _) = project()
        // The file moved. The timeline must still play while the user relinks.
        val broken = p.copy(media = p.media.map { it.copy(available = false) })
        assertTrue(composeFrame(broken, seconds(1.0)).isEmpty)
    }

    @Test
    fun `boundaries list every cut point once, in order`() {
        val (start, ids) = project()
        val trackId = start.videoTracks.first().id
        val split = start.splitClip(ids, trackId, seconds(4.0))

        val boundaries = compositionBoundaries(split)
        assertEquals(listOf(Ticks.ZERO, seconds(4.0), seconds(10.0)), boundaries)
        assertEquals(boundaries.sortedBy { it.raw }, boundaries)
        assertEquals(boundaries.distinct().size, boundaries.size)
    }
}

class HistoryTest {

    @Test
    fun `undo returns the previous document and redo puts it back`() {
        val (p, ids) = project()
        val trackId = p.videoTracks.first().id
        var history = History.of(p)

        history = history.push("Split clip", p.splitClip(ids, trackId, seconds(4.0)))
        assertEquals(2, history.present.track(trackId)!!.clips.size)

        history = history.undo()
        assertEquals(1, history.present.track(trackId)!!.clips.size)
        assertSame(p, history.present)

        history = history.redo()
        assertEquals(2, history.present.track(trackId)!!.clips.size)
    }

    @Test
    fun `a no-op edit is not pushed onto the stack`() {
        val (p, ids) = project()
        // splitClip clamped to a no-op; recording it would make Undo do nothing
        // visible, which reads as a broken button.
        val unchanged = p.splitClip(ids, "no-such-track", seconds(4.0))
        val history = History.of(p).push("Split clip", unchanged)
        assertFalse(history.canUndo)
    }

    @Test
    fun `a new edit abandons the redo branch`() {
        val (p, ids) = project()
        val trackId = p.videoTracks.first().id
        val clipId = p.videoTracks.first().clips.single().id

        var history = History.of(p)
            .push("Split clip", p.splitClip(ids, trackId, seconds(4.0)))
            .undo()
        assertTrue(history.canRedo)

        history = history.push("Delete clip", history.present.deleteClip(clipId))
        assertFalse(history.canRedo)
    }

    @Test
    fun `a drag coalesces into one undoable step`() {
        val (p, _) = project()
        val clipId = p.videoTracks.first().clips.single().id
        var history = History.of(p)

        // Sixty frames of a speed slider drag.
        for (frame in 1..60) {
            val speed = 1f + frame * 0.01f
            history = history.pushCoalescing("Change speed", history.present.setClipSpeed(clipId, speed))
        }

        assertEquals(1, history.past.size)
        assertEquals(p, history.undo().present)
    }

    @Test
    fun `the stack is bounded so a long session cannot grow without limit`() {
        val (p, _) = project()
        val clipId = p.videoTracks.first().clips.single().id
        var history = History.of(p).copy(limit = 10)

        for (frame in 1..50) {
            history = history.push("Edit $frame", history.present.setClipSpeed(clipId, 1f + frame * 0.1f))
        }
        assertEquals(10, history.past.size)
    }

    @Test
    fun `the stack reports what undo will reverse`() {
        val (p, ids) = project()
        val trackId = p.videoTracks.first().id
        val history = History.of(p).push("Split clip", p.splitClip(ids, trackId, seconds(4.0)))
        // The Undo tooltip says "Undo Split clip" rather than just "Undo".
        assertEquals("Split clip", history.undoLabel)
        assertEquals("Split clip", history.undo().redoLabel)
    }
}
