package com.apexedit.editor.core

import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Conformance tests for the Kotlin core.
 *
 * These mirror the TypeScript engine's suite in `packages/edit-engine`, which
 * covers the same semantics and passes. Where a case here looks oddly specific
 * — drop-frame counting at the tenth minute, trimming past the end of the
 * media — it is because that case caught a real bug in the original.
 *
 * Pure JVM tests: no device, no emulator, so `./gradlew test` runs them in
 * seconds.
 */
class TimeTest {

    @Test
    fun `tick base divides every supported frame rate exactly`() {
        for (rate in FrameRate.ALL) {
            assertEquals(
                "rate ${rate.num}/${rate.den} must divide the tick base",
                0L,
                Time.TICKS_PER_SECOND * rate.den % rate.num,
            )
        }
    }

    @Test
    fun `frames round-trip without drift over three hours of 29_97`() {
        val rate = FrameRate.FPS_29_97
        val frames = 3L * 60 * 60 * 30
        assertEquals(frames, frames.framesToTicks(rate).ticksToFrames(rate))
    }

    @Test
    fun `drop-frame skips the first two frame numbers of a normal minute`() {
        val rate = FrameRate.FPS_29_97
        // Frame 1800 is one minute of counted frames; drop-frame labels it
        // 00:01:00;02 because ;00 and ;01 of that minute do not exist.
        val parts = 1800L.framesToTicks(rate).toTimecodeParts(rate)
        assertEquals(1, parts.minutes)
        assertEquals(0, parts.seconds)
        assertEquals(2, parts.frames)
    }

    @Test
    fun `drop-frame does not skip on the tenth minute`() {
        val rate = FrameRate.FPS_29_97
        val framesPer10Min = 30L * 60 * 10 - 2 * 9
        val parts = framesPer10Min.framesToTicks(rate).toTimecodeParts(rate)
        assertEquals(10, parts.minutes)
        assertEquals(0, parts.seconds)
        assertEquals(0, parts.frames)
    }

    @Test
    fun `drop-frame stays on wall clock across an hour`() {
        val rate = FrameRate.FPS_29_97
        val oneHour = Math.round(3600 * (30000.0 / 1001))
        val parts = oneHour.framesToTicks(rate).toTimecodeParts(rate)
        assertEquals(1, parts.hours)
        assertEquals(0, parts.minutes)
        assertEquals(0, parts.seconds)
    }

    @Test
    fun `microsecond conversion round-trips within a microsecond`() {
        val ticks = 12L.framesToTicks(FrameRate.FPS_30)
        val back = Time.usToTicks(Time.ticksToUs(ticks))
        assertTrue("drift was ${Math.abs(back - ticks)}", Math.abs(back - ticks) < 1000)
    }

    @Test
    fun `rounding snaps to the nearest frame boundary`() {
        val rate = FrameRate.FPS_30
        val tpf = rate.ticksPerFrame
        assertEquals(tpf * 2, (tpf * 2 + 10).roundToFrame(rate))
        assertEquals(tpf * 2, (tpf * 2 - 10).roundToFrame(rate))
        assertTrue((tpf * 2).isOnFrame(rate))
    }
}

class EditsTest {

    private val rate = FrameRate.FPS_30
    private fun f(frames: Long) = frames.framesToTicks(rate)

    /** A document with one 600-frame source and no clips. */
    private fun fixture(mediaFrames: Long = 600): Pair<EditDocument, MediaAsset> {
        val asset = MediaAsset(
            id = "med1",
            kind = MediaKind.VIDEO,
            name = "source",
            uri = Uri.EMPTY,
            duration = f(mediaFrames),
            width = 1920,
            height = 1080,
            hasAudio = true,
        )
        return EditDocument.create(frameRate = rate).addMedia(asset) to asset
    }

    private fun EditDocument.place(
        trackId: Id,
        startFrames: Long,
        durationFrames: Long,
        mediaInFrames: Long = 0,
        id: Id = newId("clip"),
    ): EditDocument = overwriteClip(
        Clip(
            id = id,
            trackId = trackId,
            start = f(startFrames),
            duration = f(durationFrames),
            mediaIn = f(mediaInFrames),
            content = ClipContent.Media("med1"),
        ),
    )

    /** Compact [start, duration] pairs in frames, for readable assertions. */
    private fun EditDocument.layout(trackId: Id): List<Pair<Long, Long>> =
        clipsOn(trackId).map { it.start / f(1) to it.duration / f(1) }

    @Test
    fun `split divides a clip and advances the second half into the media`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 100, mediaInFrames = 30, id = "c1").splitClip("c1", f(40))

        assertEquals(listOf(0L to 40L, 40L to 60L), doc.layout(v1))
        assertEquals(f(70), doc.clipsOn(v1)[1].mediaIn)
    }

    @Test
    fun `split refuses a cut on a clip edge`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 100, id = "c1")
        assertEquals(1, doc.splitClip("c1", 0).clipsOn(v1).size)
        assertEquals(1, doc.splitClip("c1", f(100)).clipsOn(v1).size)
    }

    @Test
    fun `trimming the head keeps the tail put and consumes source`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 100, mediaInFrames = 50, id = "c1").trimStart("c1", f(20))
        assertEquals(listOf(20L to 80L), doc.layout(v1))
        assertEquals(f(70), doc.clips["c1"]!!.mediaIn)
    }

    @Test
    fun `trim cannot run past the start of the source`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        // Only ten frames of headroom exist.
        val doc = base.place(v1, 100, 50, mediaInFrames = 10, id = "c1").trimStart("c1", 0)
        assertEquals(listOf(90L to 60L), doc.layout(v1))
        assertEquals(0L, doc.clips["c1"]!!.mediaIn)
    }

    @Test
    fun `trim cannot run past the end of the source`() {
        val (base, _) = fixture(mediaFrames = 200)
        val v1 = base.videoTracks.first().id
        // Shows source 150-180, so only twenty frames of tail remain.
        val doc = base.place(v1, 0, 30, mediaInFrames = 150, id = "c1").trimEnd("c1", f(500))
        assertEquals(listOf(0L to 50L), doc.layout(v1))
    }

    @Test
    fun `trim stops at the neighbour unless rippling`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 50, id = "a").place(v1, 60, 50, mediaInFrames = 30, id = "b")
        assertEquals(listOf(0L to 50L, 50L to 60L), doc.trimStart("b", f(10)).layout(v1))
    }

    @Test
    fun `ripple trim pulls later clips along`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 50, id = "a").place(v1, 50, 50, id = "b")
        assertEquals(listOf(0L to 30L, 30L to 50L), doc.trimEnd("a", f(30), ripple = true).layout(v1))
    }

    @Test
    fun `lift leaves a gap and ripple delete closes it`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 50, id = "a").place(v1, 50, 50, id = "b").place(v1, 100, 50, id = "c")

        assertEquals(listOf(0L to 50L, 100L to 50L), doc.liftClips(listOf("b")).layout(v1))
        assertEquals(listOf(0L to 50L, 50L to 50L), doc.rippleDelete(listOf("b")).layout(v1))
    }

    @Test
    fun `ripple delete only touches the tracks it deleted from`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks[0].id
        val v2 = base.videoTracks[1].id
        val doc = base.place(v1, 0, 50, id = "a").place(v1, 50, 50, id = "b").place(v2, 80, 40, id = "c")
        assertEquals(listOf(80L to 40L), doc.rippleDelete(listOf("b")).layout(v2))
    }

    @Test
    fun `overwrite in the middle leaves a head and a tail`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 100, id = "a").overwriteClip(
            Clip("x", v1, f(40), f(20), 0, ClipContent.Color(0xFFFF0000)),
        )
        assertEquals(listOf(0L to 40L, 40L to 20L, 60L to 40L), doc.layout(v1))
    }

    @Test
    fun `roll moves the shared cut without changing total length`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 50, mediaInFrames = 100, id = "a")
            .place(v1, 50, 50, mediaInFrames = 200, id = "b")
        val before = doc.duration

        val rolled = doc.rollEdit("a", f(70))
        assertEquals(listOf(0L to 70L, 70L to 30L), rolled.layout(v1))
        assertEquals(before, rolled.duration)
        assertEquals(f(220), rolled.clips["b"]!!.mediaIn)
    }

    @Test
    fun `roll does nothing across a gap`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 50, id = "a").place(v1, 80, 50, id = "b")
        assertEquals(doc.layout(v1), doc.rollEdit("a", f(60)).layout(v1))
    }

    @Test
    fun `slip changes the source range and nothing else`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 100, 50, mediaInFrames = 200, id = "a").slipClip("a", f(25))
        assertEquals(listOf(100L to 50L), doc.layout(v1))
        assertEquals(f(225), doc.clips["a"]!!.mediaIn)
    }

    @Test
    fun `slip clamps at both ends of the source`() {
        val (base, _) = fixture(mediaFrames = 100)
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 50, mediaInFrames = 10, id = "a")
        assertEquals(0L, doc.slipClip("a", f(-999)).clips["a"]!!.mediaIn)
        // 100 − (10 + 50) = 40 frames of tailroom.
        assertEquals(f(50), doc.slipClip("a", f(999)).clips["a"]!!.mediaIn)
    }

    @Test
    fun `slide moves a clip and its neighbours absorb the change`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 50, mediaInFrames = 100, id = "a")
            .place(v1, 50, 50, mediaInFrames = 100, id = "b")
            .place(v1, 100, 50, mediaInFrames = 100, id = "c")

        val slid = doc.slideClip("b", f(10))
        assertEquals(listOf(0L to 60L, 60L to 50L, 110L to 40L), slid.layout(v1))
        // The slid clip's own content is untouched.
        assertEquals(f(100), slid.clips["b"]!!.mediaIn)
    }

    @Test
    fun `halving the speed doubles the clip length`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 100, id = "a").setClipSpeed("a", 0.5f)
        assertEquals(f(200), doc.clips["a"]!!.duration)
    }

    @Test
    fun `doubling the speed halves the clip length`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 100, id = "a").setClipSpeed("a", 2f)
        assertEquals(f(50), doc.clips["a"]!!.duration)
    }

    @Test
    fun `speed is clamped to the supported range`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 100, id = "a")
        assertEquals(MIN_SPEED, doc.setClipSpeed("a", 0.001f).clips["a"]!!.speed)
        assertEquals(MAX_SPEED, doc.setClipSpeed("a", 9999f).clips["a"]!!.speed)
    }

    @Test
    fun `a locked track rejects edits`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 100, id = "a").updateTrack(v1) { it.copy(locked = true) }
        assertEquals(doc.layout(v1), doc.splitClip("a", f(50)).layout(v1))
        assertEquals(doc.layout(v1), doc.trimEnd("a", f(20)).layout(v1))
    }

    @Test
    fun `linked clips trim and delete together`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val a1 = base.audioTracks.first().id
        val doc = base.place(v1, 0, 100, mediaInFrames = 40, id = "v")
            .place(a1, 0, 100, mediaInFrames = 40, id = "a")
            .linkClips(listOf("v", "a"))

        val trimmed = doc.trimStart("v", f(20))
        assertEquals(listOf(20L to 80L), trimmed.layout(v1))
        assertEquals(listOf(20L to 80L), trimmed.layout(a1))

        assertTrue(doc.liftClips(listOf("v")).clips.isEmpty())
    }

    @Test
    fun `the track index stays sorted after arbitrary moves`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 200, 20, id = "a").place(v1, 0, 20, id = "b").place(v1, 100, 20, id = "c")
        val moved = doc.moveClip("b", null, f(300))
        val starts = moved.layout(v1).map { it.first }
        assertEquals(starts.sorted(), starts)
    }

    @Test
    fun `deleting a clip leaves no stale id in the index`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 50, id = "a").liftClips(listOf("a"))
        assertEquals(emptyList<Id>(), doc.trackClips[v1])
    }

    @Test
    fun `snapping finds the nearest edit point and ignores the dragged clip`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 50, id = "a").place(v1, 100, 50, id = "b")
        assertEquals(f(50), doc.snapTarget(f(52), f(5)))
        assertNull(doc.snapTarget(f(70), f(5)))
        // The clip being dragged must not snap to itself.
        assertNull(doc.snapTarget(f(101), f(3), exclude = setOf("b")))
    }

    @Test
    fun `a transition is clamped to the shorter neighbour`() {
        val (base, _) = fixture()
        val v1 = base.videoTracks.first().id
        val doc = base.place(v1, 0, 50, id = "a").place(v1, 50, 20, id = "b")
            .setTransition("b", TransitionType.CROSS_DISSOLVE, f(200))
        assertNotNull(doc.clips["b"]!!.transitionIn)
        assertEquals(f(20), doc.clips["b"]!!.transitionIn!!.durationTicks)
    }
}

class HistoryTest {

    private val doc = EditDocument.create()

    @Test
    fun `undo restores the previous document and redo replays it`() {
        val next = doc.copy(name = "Changed")
        var h = History(present = doc).commit(next, "Rename")
        assertEquals("Changed", h.present.name)
        h = h.undo()
        assertEquals("Untitled", h.present.name)
        h = h.redo()
        assertEquals("Changed", h.present.name)
    }

    @Test
    fun `a gesture collapses into one undo entry`() {
        var h = History(present = doc)
        // Simulate a drag emitting a position per frame.
        repeat(20) { i ->
            h = h.commit(h.present.copy(name = "step $i"), "Move", coalesceKey = "drag-1")
        }
        assertEquals(1, h.past.size)
        assertEquals("Untitled", h.undo().present.name)
    }

    @Test
    fun `separate gestures stay separate`() {
        var h = History(present = doc)
        h = h.commit(doc.copy(name = "a"), "Move", "g1")
        h = h.commit(doc.copy(name = "b"), "Move", "g2")
        assertEquals(2, h.past.size)
    }

    @Test
    fun `a new edit drops the redo stack`() {
        var h = History(present = doc).commit(doc.copy(name = "a"), "One").undo()
        assertTrue(h.canRedo)
        h = h.commit(doc.copy(name = "b"), "Two")
        assertTrue(!h.canRedo)
    }

    @Test
    fun `the oldest entries are discarded past the cap`() {
        var h = History(present = doc, limit = 5)
        repeat(20) { i -> h = h.commit(h.present.copy(name = "s$i"), "Tag $i") }
        assertEquals(5, h.past.size)
        assertEquals("Tag 15", h.past.first().label)
    }

    @Test
    fun `committing an unchanged document is a no-op`() {
        val h = History(present = doc)
        assertEquals(h, h.commit(doc, "Nothing"))
    }
}
