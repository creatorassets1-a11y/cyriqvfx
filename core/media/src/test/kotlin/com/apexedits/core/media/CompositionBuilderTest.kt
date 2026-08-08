package com.apexedits.core.media

import com.apexedits.core.engine.edit.addKeyframe
import com.apexedits.core.engine.edit.appendClip
import com.apexedits.core.engine.edit.insertClipAt
import com.apexedits.core.engine.edit.setClipFadeIn
import com.apexedits.core.engine.edit.setClipPan
import com.apexedits.core.engine.edit.setTrackMuted
import com.apexedits.core.engine.edit.setTrackVisible
import com.apexedits.core.engine.edit.splitClip
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.CountingIdSource
import com.apexedits.core.model.IdSource
import com.apexedits.core.model.Project
import com.apexedits.core.model.SampleVideo
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.createClip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.EditedMediaItem
import org.robolectric.RobolectricTestRunner

/** `EditedMediaItem.isGap` is package-private; a gap is an item with no source. */
@OptIn(UnstableApi::class)
private fun EditedMediaItem.isGapItem(): Boolean = mediaItem.localConfiguration == null

/**
 * The bridge from document to Media3, checked without a device.
 *
 * `CompositionBuilder` is where ADR 0004's parity guarantee is actually made
 * good: whatever it produces is what both the preview and the exporter render.
 * Constructing a `Composition` needs `android.net.Uri` but no codec, so
 * Robolectric can verify the structure — sequence count, gap placement, clipping
 * windows — even though nothing here can decode a frame.
 */
@RunWith(RobolectricTestRunner::class)
class CompositionBuilderTest {

    private fun openProject(): Triple<Project, String, IdSource> {
        val ids = CountingIdSource()
        val base = SampleVideo.project(ids)
        val trackId = base.videoTracks.first().id
        return Triple(base.appendClip(trackId, createClip(ids, SampleVideo.mediaRef())), trackId, ids)
    }

    @Test
    fun `an empty project produces no composition`() {
        val empty = SampleVideo.project(CountingIdSource())
        // Nothing to render is not an error; the preview simply shows its empty
        // state rather than a player that fails to prepare.
        assertNull(CompositionBuilder.build(empty))
    }

    @Test
    fun `one clip produces one sequence`() {
        val (project, _, _) = openProject()
        val composition = CompositionBuilder.build(project)

        assertNotNull(composition)
        assertEquals(1, composition!!.sequences.size)
        assertEquals(1, composition.sequences[0].editedMediaItems.size)
    }

    @Test
    fun `the clipping window matches the source exactly, in microseconds`() {
        val (project, _, _) = openProject()
        val item = CompositionBuilder.build(project)!!.sequences[0].editedMediaItems[0]
        val clipping = item.mediaItem.clippingConfiguration

        // Millisecond clipping would give away up to a twentieth of a frame per
        // cut. The sample clip is 33.034 s; this must land on it exactly.
        assertEquals(0L, clipping.startPositionUs)
        assertEquals(SampleVideo.duration.toMicros(), clipping.endPositionUs)
        assertEquals(33_034_000L, clipping.endPositionUs)
    }

    @Test
    fun `a split produces two items whose windows meet without overlap`() {
        val (start, trackId, ids) = openProject()
        val at = SampleVideo.frameRate.timeOfFrame(495)
        val split = start.splitClip(ids, trackId, at)

        val items = CompositionBuilder.build(split)!!.sequences[0].editedMediaItems
        assertEquals(2, items.size)

        val first = items[0].mediaItem.clippingConfiguration
        val second = items[1].mediaItem.clippingConfiguration
        // The frame that ends the first item is the frame that starts the second:
        // no repeated frame, no dropped one.
        assertEquals(first.endPositionUs, second.startPositionUs)
        assertEquals(at.toMicros(), first.endPositionUs)
    }

    @Test
    fun `a gap before the first clip is emitted so later tracks stay in sync`() {
        val (start, trackId, ids) = openProject()
        // Second track, with its clip starting ten seconds in.
        val secondTrack = start.videoTracks[1].id
        val offset = Ticks.ofSeconds(10.0)
        val withOffset = start.insertClipAt(secondTrack, createClip(ids, SampleVideo.mediaRef()), offset)

        val composition = CompositionBuilder.build(withOffset)!!
        assertEquals(2, composition.sequences.size)

        // A sequence plays its items back to back with no notion of timeline
        // position, so without an explicit gap this clip would start at zero and
        // the two tracks would be ten seconds apart.
        val offsetSequence = composition.sequences[1]
        assertEquals(2, offsetSequence.editedMediaItems.size)
        // A gap carries no media URI; that is how one is told apart from a clip.
        assertTrue(offsetSequence.editedMediaItems[0].isGapItem())
        assertEquals(offset.toMicros(), offsetSequence.editedMediaItems[0].durationUs)
    }

    @Test
    fun `a hidden track contributes no sequence`() {
        val (start, trackId, _) = openProject()
        val hidden = start.setTrackVisible(trackId, false)

        // Not merely invisible: absent, so it costs no decoder slot on a device
        // that may only have a few.
        assertNull(CompositionBuilder.build(hidden))
    }

    @Test
    fun `an unavailable file is skipped without breaking the composition`() {
        val (start, trackId, ids) = openProject()
        val two = start.appendClip(trackId, createClip(ids, SampleVideo.mediaRef(id = "gone", uri = "file:///gone.mp4")))
        val broken = two.copy(media = two.media.map { if (it.id == "gone") it.copy(available = false) else it })

        val composition = CompositionBuilder.build(broken)
        assertNotNull(composition)
        // The good clip still plays while the user relinks the missing one.
        assertEquals(1, composition!!.sequences[0].editedMediaItems.count { !it.isGapItem() })
    }

    // --- the transmux decision ----------------------------------------------

    @Test
    fun `audio is transmuxed when nothing touches it`() {
        val (project, _, _) = openProject()
        // Copying audio through without decoding is a large speed win, and safe
        // when no processing is asked for.
        assertTrue(CompositionBuilder.build(project)!!.transmuxAudio)
    }

    @Test
    fun `volume automation vetoes transmuxing`() {
        val (start, trackId, _) = openProject()
        val clipId = start.track(trackId)!!.clips.single().id
        val ducked = start
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ofSeconds(2.0), 0f)

        // Transmuxed audio never reaches the gain processor, so the fade would be
        // audible in the preview and silently absent from the export — exactly
        // the divergence ADR 0004 exists to prevent.
        assertFalse(CompositionBuilder.build(ducked)!!.transmuxAudio)
    }

    @Test
    fun `a fade vetoes transmuxing`() {
        val (start, trackId, _) = openProject()
        val clipId = start.track(trackId)!!.clips.single().id
        val faded = start.setClipFadeIn(clipId, Ticks.ofSeconds(1.0))

        // Same reasoning as volume automation: a fade with no keyframes on it
        // would otherwise pass this check and then never play in the export.
        assertFalse(CompositionBuilder.build(faded)!!.transmuxAudio)
    }

    @Test
    fun `a pan vetoes transmuxing`() {
        val (start, trackId, _) = openProject()
        val clipId = start.track(trackId)!!.clips.single().id
        val panned = start.setClipPan(clipId, -0.5f)

        assertFalse(CompositionBuilder.build(panned)!!.transmuxAudio)
    }

    @Test
    fun `an audio track vetoes transmuxing`() {
        val (start, _, ids) = openProject()
        val audioTrack = start.audioTracks.first().id
        val music = SampleVideo.mediaRef(id = "music", uri = "file:///music.m4a")
        val mixed = start.copy(media = start.media + music).appendClip(audioTrack, createClip(ids, music))

        // Two sources have to be mixed, which cannot happen without decoding.
        assertFalse(CompositionBuilder.build(mixed)!!.transmuxAudio)
    }

    // --- effects wiring ------------------------------------------------------

    @Test
    fun `a plain clip carries no effects at all`() {
        val (project, _, _) = openProject()
        val item = CompositionBuilder.build(project)!!.sequences[0].editedMediaItems[0]

        assertTrue(item.effects.videoEffects.isEmpty())
        assertTrue(item.effects.audioProcessors.isEmpty())
    }

    @Test
    fun `an animated transform adds the matrix effect`() {
        val (start, trackId, _) = openProject()
        val clipId = start.track(trackId)!!.clips.single().id
        val animated = start
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, Ticks.ofSeconds(2.0), 2f)

        val item = CompositionBuilder.build(animated)!!.sequences[0].editedMediaItems[0]
        assertEquals(1, item.effects.videoEffects.size)
        assertTrue(item.effects.videoEffects[0] is KeyframedTransformation)
    }

    @Test
    fun `an opacity fade adds the alpha effect after the transform`() {
        val (start, trackId, _) = openProject()
        val clipId = start.track(trackId)!!.clips.single().id
        val animated = start
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, Ticks.ofSeconds(2.0), 2f)
            .addKeyframe(clipId, AnimatableProperty.OPACITY, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.OPACITY, Ticks.ofSeconds(2.0), 0f)

        val effects = CompositionBuilder.build(animated)!!.sequences[0].editedMediaItems[0].effects
        assertEquals(2, effects.videoEffects.size)
        // Geometry first, then alpha, so the fade scales the transformed frame
        // rather than being resampled by the geometry pass after it.
        assertTrue(effects.videoEffects[0] is KeyframedTransformation)
        assertTrue(effects.videoEffects[1] is KeyframedAlphaEffect)
    }

    @Test
    fun `a colour adjustment adds the colour matrix effect between geometry and alpha`() {
        val (start, trackId, _) = openProject()
        val clipId = start.track(trackId)!!.clips.single().id
        val graded = start
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.SCALE_X, Ticks.ofSeconds(2.0), 2f)
            .addKeyframe(clipId, AnimatableProperty.OPACITY, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.OPACITY, Ticks.ofSeconds(2.0), 0f)
            .addKeyframe(clipId, AnimatableProperty.CONTRAST, Ticks.ZERO, 0.5f)

        val effects = CompositionBuilder.build(graded)!!.sequences[0].editedMediaItems[0].effects
        assertEquals(3, effects.videoEffects.size)
        assertTrue(effects.videoEffects[0] is KeyframedTransformation)
        assertTrue(effects.videoEffects[1] is KeyframedColorMatrix)
        assertTrue(effects.videoEffects[2] is KeyframedAlphaEffect)
    }

    @Test
    fun `an untouched colour adjustment adds no effect`() {
        val (project, _, _) = openProject()
        val effects = CompositionBuilder.build(project)!!.sequences[0].editedMediaItems[0].effects
        assertTrue(effects.videoEffects.none { it is KeyframedColorMatrix })
    }

    @Test
    fun `volume automation adds the gain processor`() {
        val (start, trackId, _) = openProject()
        val clipId = start.track(trackId)!!.clips.single().id
        val ducked = start
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ofSeconds(2.0), 0f)

        val effects = CompositionBuilder.build(ducked)!!.sequences[0].editedMediaItems[0].effects
        assertEquals(1, effects.audioProcessors.size)
        assertTrue(effects.audioProcessors[0] is KeyframedGainProcessor)
    }

    @Test
    fun `a fade adds the gain processor even with no volume keyframes`() {
        val (start, trackId, _) = openProject()
        val clipId = start.track(trackId)!!.clips.single().id
        val faded = start.setClipFadeIn(clipId, Ticks.ofSeconds(1.0))

        val effects = CompositionBuilder.build(faded)!!.sequences[0].editedMediaItems[0].effects
        assertEquals(1, effects.audioProcessors.size)
        assertTrue(effects.audioProcessors[0] is KeyframedGainProcessor)
    }

    @Test
    fun `pan adds the pan processor`() {
        val (start, trackId, _) = openProject()
        val clipId = start.track(trackId)!!.clips.single().id
        val panned = start.setClipPan(clipId, 0.5f)

        val effects = CompositionBuilder.build(panned)!!.sequences[0].editedMediaItems[0].effects
        assertEquals(1, effects.audioProcessors.size)
        assertTrue(effects.audioProcessors[0] is PanProcessor)
    }

    @Test
    fun `volume automation and pan together add both processors, gain first`() {
        val (start, trackId, _) = openProject()
        val clipId = start.track(trackId)!!.clips.single().id
        val both = start
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ofSeconds(2.0), 0f)
            .setClipPan(clipId, -0.5f)

        val effects = CompositionBuilder.build(both)!!.sequences[0].editedMediaItems[0].effects
        assertEquals(2, effects.audioProcessors.size)
        assertTrue(effects.audioProcessors[0] is KeyframedGainProcessor)
        assertTrue(effects.audioProcessors[1] is PanProcessor)
    }

    @Test
    fun `a muted track gets no gain processor because it has no audio`() {
        val (start, trackId, _) = openProject()
        val clipId = start.track(trackId)!!.clips.single().id
        val muted = start
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ZERO, 1f)
            .addKeyframe(clipId, AnimatableProperty.VOLUME, Ticks.ofSeconds(2.0), 0f)
            .setTrackMuted(trackId, true)

        val item = CompositionBuilder.build(muted)!!.sequences[0].editedMediaItems[0]
        // The audio is removed outright, so processing it would be wasted work.
        assertTrue(item.removeAudio)
        assertTrue(item.effects.audioProcessors.isEmpty())
    }
}
