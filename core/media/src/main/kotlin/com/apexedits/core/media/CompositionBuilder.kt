package com.apexedits.core.media

import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import com.apexedits.core.engine.animation.hasAudioAutomation
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
            //
            // Volume automation, fades and pan all have to veto that. Transmuxed
            // audio is copied through without decoding, so none of these audio
            // processors would ever see a sample and would silently do nothing
            // in the export while still being audible in the preview —
            // precisely the preview/export divergence ADR 0004 exists to
            // prevent.
            .setTransmuxAudio(canTransmuxAudio(project))
            .build()
    }

    private fun canTransmuxAudio(project: Project): Boolean {
        if (project.tracks.any { it.kind == TrackKind.AUDIO && it.clips.isNotEmpty() }) return false
        return project.tracks
            .flatMap { it.clips }
            .none { it.hasAudioAutomation || it.pan != 0f }
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
        var startsWithGap = false

        for (clip in track.ordered) {
            if (!clip.enabled) continue
            val media = project.mediaRef(clip.mediaId) ?: continue
            if (!media.available) continue

            // Silence where a clip is missing keeps everything after it in sync.
            val gap = clip.timelineStart - cursor
            if (gap.isPositive) {
                if (added == 0) startsWithGap = true
                builder.addGap(gap.toMicros())
            }

            builder.addItem(buildItem(clip, media.uri, media.kind, track, audible, project))
            cursor = clip.timelineEnd
            added++
        }

        if (added == 0) return null

        // Media3 rejects a sequence that opens with a gap unless it is told what
        // kind of silence to synthesise — there is no preceding item to infer it
        // from. This is the ordinary case, not an edge one: it happens the moment
        // a clip is dragged away from the start, or a second track begins part
        // way through, so without this the composition throws and both the
        // preview and the export fail outright.
        if (startsWithGap) {
            when (track.kind) {
                TrackKind.VIDEO -> builder.experimentalSetForceVideoTrack(true)
                TrackKind.AUDIO -> builder.experimentalSetForceAudioTrack(true)
            }
        }

        return builder.build()
    }

    private fun buildItem(
        clip: Clip,
        uri: String,
        kind: MediaKind,
        track: Track,
        audible: Boolean,
        project: Project,
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

        // One effect covers both the static and the animated case, because a
        // static transform is just an animation with no keyframes. Using the
        // same code path for both means the preview cannot behave differently
        // from the export the moment a keyframe is added.
        val videoEffects = buildList {
            if (track.kind == TrackKind.VIDEO && KeyframedTransformation.isNeeded(clip)) {
                add(
                    KeyframedTransformation(
                        clip = clip,
                        frameWidth = project.format.width,
                        frameHeight = project.format.height,
                    ),
                )
            }
            // Alpha last, so it scales the transformed frame rather than being
            // resampled by the geometry pass afterwards.
            if (track.kind == TrackKind.VIDEO && KeyframedAlphaEffect.isNeeded(clip)) {
                add(KeyframedAlphaEffect(clip))
            }
        }

        val audioProcessors = buildList {
            if (audible && clip.hasAudioAutomation) {
                add(KeyframedGainProcessor(clip))
            }
            if (audible && clip.pan != 0f) {
                add(PanProcessor(clip))
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
                if (videoEffects.isNotEmpty() || audioProcessors.isNotEmpty()) {
                    setEffects(Effects(audioProcessors, videoEffects))
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
