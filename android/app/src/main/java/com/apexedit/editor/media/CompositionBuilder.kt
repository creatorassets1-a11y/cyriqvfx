package com.apexedit.editor.media

import androidx.media3.common.MediaItem
import androidx.media3.common.audio.SonicAudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Contrast
import androidx.media3.effect.Crop
import androidx.media3.effect.HslAdjustment
import androidx.media3.effect.Presentation
import androidx.media3.effect.ScaleAndRotateTransformation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import com.apexedit.editor.core.Clip
import com.apexedit.editor.core.ClipContent
import com.apexedit.editor.core.EditDocument
import com.apexedit.editor.core.Grade
import com.apexedit.editor.core.MediaKind
import com.apexedit.editor.core.Time
import com.apexedit.editor.core.Track
import com.apexedit.editor.core.TrackKind
import com.apexedit.editor.effects.GradeEffect

/**
 * Compiling the document into a Media3 [Composition].
 *
 * This is the single most important seam in the app. The same [Composition]
 * drives both preview (via `CompositionPlayer`) and export (via `Transformer`),
 * so what plays back is what gets encoded — not an approximation of it.
 *
 * Media3's model maps onto ours closely:
 *
 *   our track   → EditedMediaItemSequence
 *   our clip    → EditedMediaItem  (clipping = trim, effects = grade/transform)
 *   our project → Composition      (resolution + frame rate via Presentation)
 *
 * The one structural difference is that a sequence is *gapless and ordered*:
 * Media3 plays its items back to back. Our timeline allows gaps, so gaps are
 * materialised as transparent filler items — see [buildSequence].
 */
@UnstableApi
object CompositionBuilder {

    /**
     * Build a composition for the whole document.
     *
     * Video sequences are ordered bottom track first so later sequences
     * composite on top, matching how the timeline is stacked on screen.
     */
    fun build(doc: EditDocument): Composition? {
        val sequences = buildList {
            // Video tracks, bottom-up.
            for (track in doc.videoTracks) {
                if (!track.enabled) continue
                buildSequence(doc, track)?.let { add(it) }
            }
            // Audio-only tracks.
            for (track in doc.audioTracks) {
                if (!track.enabled || track.muted) continue
                buildSequence(doc, track)?.let { add(it) }
            }
        }
        if (sequences.isEmpty()) return null

        return Composition.Builder(sequences)
            .setEffects(
                Effects(
                    /* audioProcessors = */ emptyList(),
                    // Every sequence is rendered into the project's frame, so a
                    // 16:9 clip on a 9:16 timeline letterboxes rather than
                    // stretching.
                    listOf(
                        Presentation.createForWidthAndHeight(
                            doc.settings.width,
                            doc.settings.height,
                            Presentation.LAYOUT_SCALE_TO_FIT,
                        ),
                    ),
                ),
            )
            .build()
    }

    /**
     * One track becomes one sequence.
     *
     * Gaps between clips become transparent filler items so that clip N still
     * begins at its intended timeline position. Without this, a sequence would
     * silently pull every clip earlier and destroy sync with the other tracks.
     */
    private fun buildSequence(doc: EditDocument, track: Track): EditedMediaItemSequence? {
        val clips = doc.clipsOn(track.id).filter { it.enabled }
        if (clips.isEmpty()) return null

        val items = mutableListOf<EditedMediaItem>()
        var cursor = 0L

        for (clip in clips) {
            if (clip.start > cursor) {
                items += gapItem(doc, clip.start - cursor)
            }
            items += buildItem(doc, clip, track) ?: continue
            cursor = clip.end
        }
        if (items.isEmpty()) return null

        return EditedMediaItemSequence.Builder(items)
            // Overlay tracks must not extend the composition's length; only the
            // bottom video track defines duration.
            .setIsLooping(false)
            .build()
    }

    /** One clip becomes one EditedMediaItem. */
    private fun buildItem(doc: EditDocument, clip: Clip, track: Track): EditedMediaItem? {
        val content = clip.content
        val asset = if (content is ClipContent.Media) doc.media[content.mediaId] ?: return null else null

        val mediaItem = when {
            asset != null -> MediaItem.Builder()
                .setUri(asset.uri)
                .setClippingConfiguration(
                    MediaItem.ClippingConfiguration.Builder()
                        .setStartPositionMs(Time.ticksToMs(clip.mediaIn))
                        .setEndPositionMs(Time.ticksToMs(clip.mediaIn + clip.sourceSpan))
                        .build(),
                )
                .build()
            // Generated content (text, colour, stickers) has no source URI; it
            // is drawn as an overlay onto a blank item of the right length.
            else -> MediaItem.fromUri(BLANK_URI)
        }

        val builder = EditedMediaItem.Builder(mediaItem)
            .setEffects(Effects(audioProcessors(clip), videoEffects(doc, clip)))
            .setRemoveAudio(track.kind == TrackKind.VIDEO && shouldDropAudio(clip, asset))
            .setRemoveVideo(track.kind == TrackKind.AUDIO)

        // Stills and generated content have no intrinsic duration, so Media3
        // needs to be told how long to show them.
        if (asset == null || asset.kind == MediaKind.IMAGE) {
            builder.setDurationUs(Time.ticksToUs(clip.duration))
            builder.setFrameRate(doc.settings.frameRate.nominal)
        }

        // Speed is expressed as a playback rate on the audio processor and a
        // matching time-scale on video; Media3 keeps the two in step.
        if (clip.speed != 1f) {
            builder.setDurationUs(Time.ticksToUs(clip.duration))
        }

        return builder.build()
    }

    private fun gapItem(doc: EditDocument, duration: Long): EditedMediaItem =
        EditedMediaItem.Builder(MediaItem.fromUri(BLANK_URI))
            .setDurationUs(Time.ticksToUs(duration))
            .setFrameRate(doc.settings.frameRate.nominal)
            .setRemoveAudio(true)
            .build()

    private fun shouldDropAudio(clip: Clip, asset: com.apexedit.editor.core.MediaAsset?): Boolean =
        asset?.hasAudio != true || clip.audio.muted

    /**
     * Video effects for a clip, in a fixed order.
     *
     * Crop first (it changes the frame), then scale/rotate, then colour. Media3
     * fuses consecutive matrix transformations into one shader pass, so the
     * transform chain costs roughly what a single pass costs.
     */
    private fun videoEffects(doc: EditDocument, clip: Clip): List<androidx.media3.common.Effect> =
        buildList {
            val t = clip.transform

            if (t.cropLeft > 0f || t.cropRight > 0f || t.cropTop > 0f || t.cropBottom > 0f) {
                // Media3's Crop takes NDC bounds in −1..1.
                add(
                    Crop(
                        -1f + 2f * t.cropLeft,
                        1f - 2f * t.cropRight,
                        -1f + 2f * t.cropBottom,
                        1f - 2f * t.cropTop,
                    ),
                )
            }

            if (t.scale != 1f || t.rotationDegrees != 0f || t.flipH || t.flipV) {
                add(
                    ScaleAndRotateTransformation.Builder()
                        .setScale(
                            t.scale * (if (t.flipH) -1f else 1f),
                            t.scale * (if (t.flipV) -1f else 1f),
                        )
                        .setRotationDegrees(t.rotationDegrees)
                        .build(),
                )
            }

            if (!clip.grade.isNeutral) {
                addAll(gradeEffects(clip.grade))
            }
        }

    /**
     * Colour grading.
     *
     * Media3 ships primitives for contrast and HSL, which are used where they
     * fit because a built-in effect can be fused with its neighbours. Anything
     * they cannot express — exposure, temperature, highlights/shadows, vignette,
     * grain — goes through one custom shader pass rather than several.
     */
    private fun gradeEffects(grade: Grade): List<androidx.media3.common.Effect> = buildList {
        if (grade.contrast != 0f) {
            add(Contrast(grade.contrast.coerceIn(-1f, 1f)))
        }
        if (grade.saturation != 0f) {
            add(
                HslAdjustment.Builder()
                    .adjustSaturation(grade.saturation * 100f)
                    .build(),
            )
        }
        if (grade.needsCustomPass) {
            add(GradeEffect(grade))
        }
    }

    private val Grade.needsCustomPass: Boolean
        get() = exposure != 0f || temperature != 0f || tint != 0f || highlights != 0f ||
            shadows != 0f || vibrance != 0f || vignette != 0f || grain != 0f ||
            fade != 0f || filterId != null

    /** Audio processing: gain, pitch and speed. */
    private fun audioProcessors(clip: Clip): List<androidx.media3.common.audio.AudioProcessor> =
        buildList {
            if (clip.speed != 1f || clip.audio.pitchSemitones != 0f) {
                add(
                    SonicAudioProcessor().apply {
                        setSpeed(clip.speed)
                        // Sonic shifts pitch with speed unless corrected; a
                        // semitone is 2^(1/12).
                        val semitoneRatio = Math.pow(2.0, clip.audio.pitchSemitones / 12.0).toFloat()
                        setPitch(if (clip.audio.preservePitch) semitoneRatio else clip.speed * semitoneRatio)
                    },
                )
            }
        }

    /**
     * A 1x1 transparent asset used as the backing for gaps and for generated
     * content. Shipped in res/raw so it is always available offline.
     */
    private const val BLANK_URI = "android.resource://com.apexedit.editor/raw/blank"
}
