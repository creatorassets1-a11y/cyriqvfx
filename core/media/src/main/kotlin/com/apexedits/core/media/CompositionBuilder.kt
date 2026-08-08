package com.apexedits.core.media

import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.ScaleAndRotateTransformation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import com.apexedits.core.model.Clip
import com.apexedits.core.model.MediaKind
import com.apexedits.core.model.Project
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.Track
import com.apexedits.core.model.TrackKind

/**
 * Turns the edit document into a Media3 [Composition].
 *
 * This is the single most load-bearing piece of the media layer, because the
 * preview (`CompositionPlayer`) and the exporter (`Transformer`) both take a
 * `Composition` and nothing else. Building it in one place means the two cannot
 * disagree about the edit: the PRD's "export matches the timeline preview"
 * stops being a thing to test for and becomes a thing that is true because
 * there is only one description of the edit.
 *
 * The mapping:
 *
 *   one ApexEdits track  →  one EditedMediaItemSequence
 *   one clip             →  one EditedMediaItem, clipped to its source window
 *   a gap between clips  →  an explicit gap of the same length
 *
 * Gaps have to be explicit because a sequence plays its items back to back with
 * no notion of timeline position. Without them, a clip that starts ten seconds
 * in would play immediately and every later track would drift out of sync.
 */
@UnstableApi
object CompositionBuilder {

    /**
     * Builds the composition for [project].
     *
     * Tracks that are hidden, muted-into-silence, or empty are dropped rather
     * than contributing an all-gap sequence, because a sequence of nothing but
     * gaps still costs a decoder slot on a device that may only have a few.
     */
    fun build(project: Project): Composition? {
        val sequences = project.tracks
            .mapNotNull { track -> buildSequence(project, track) }

        if (sequences.isEmpty()) return null

        return Composition.Builder(sequences)
            // Video is re-encoded because clips carry transforms; audio is
            // transmuxed when it can be, which is a large speed win on the
            // common case of untouched sound.
            .setTransmuxAudio(project.tracks.none { it.kind == TrackKind.AUDIO && it.clips.isNotEmpty() })
            .build()
    }

    private fun buildSequence(project: Project, track: Track): EditedMediaItemSequence? {
        if (track.clips.isEmpty()) return null
        if (track.kind == TrackKind.VIDEO && !track.visible) return null

        val soloed = project.audioTracks.any { it.solo }
        val audible = when (track.kind) {
            TrackKind.AUDIO -> if (soloed) track.solo else !track.muted
            TrackKind.VIDEO -> !track.muted && !soloed
        }

        val builder = EditedMediaItemSequence.Builder()
        var cursor = Ticks.ZERO
        var added = 0

        for (clip in track.ordered) {
            if (!clip.enabled) continue
            val media = project.mediaRef(clip.mediaId) ?: continue
            if (!media.available) continue

            // Silence where a clip is missing keeps everything after it in sync.
            val gap = clip.timelineStart - cursor
            if (gap.isPositive) {
                builder.addGap(gap.toMicros())
            }

            builder.addItem(buildItem(clip, media.uri, media.kind, track, audible))
            cursor = clip.timelineEnd
            added++
        }

        return if (added == 0) null else builder.build()
    }

    private fun buildItem(
        clip: Clip,
        uri: String,
        kind: MediaKind,
        track: Track,
        audible: Boolean,
    ): EditedMediaItem {
        val mediaItem = MediaItem.Builder()
            .setUri(uri)
            .setClippingConfiguration(
                MediaItem.ClippingConfiguration.Builder()
                    // Microseconds, not milliseconds: the tick base is exact and
                    // rounding to a millisecond here would give away up to a
                    // twentieth of a frame per cut, which accumulates visibly
                    // over a long timeline.
                    .setStartPositionUs(clip.sourceIn.toMicros())
                    .setEndPositionUs(clip.sourceOut.toMicros())
                    .build(),
            )
            .build()

        val videoEffects = buildList {
            val transform = clip.transform
            if (transform.rotationDegrees != 0f || transform.scaleX != 1f || transform.scaleY != 1f ||
                transform.flipHorizontal || transform.flipVertical
            ) {
                add(
                    ScaleAndRotateTransformation.Builder()
                        // A flip is a negative scale; folding it in here avoids
                        // a second pass over every frame.
                        .setScale(
                            transform.scaleX * if (transform.flipHorizontal) -1f else 1f,
                            transform.scaleY * if (transform.flipVertical) -1f else 1f,
                        )
                        .setRotationDegrees(transform.rotationDegrees)
                        .build(),
                )
            }
        }

        return EditedMediaItem.Builder(mediaItem)
            .setRemoveAudio(!audible || (track.kind == TrackKind.VIDEO && !clip.enabled))
            .setRemoveVideo(track.kind == TrackKind.AUDIO)
            .apply {
                // A still has no intrinsic duration, so the composition has to
                // be told how long to hold it.
                if (kind == MediaKind.IMAGE) {
                    setDurationUs(clip.timelineDuration.toMicros())
                    setFrameRate(DEFAULT_IMAGE_FRAME_RATE)
                }
                if (videoEffects.isNotEmpty()) {
                    setEffects(Effects(emptyList(), videoEffects))
                }
            }
            .build()
    }

    /**
     * Frame rate synthesised for stills. Thirty is enough for a static image and
     * cheap; the project's own rate governs the final output.
     */
    private const val DEFAULT_IMAGE_FRAME_RATE = 30
}
