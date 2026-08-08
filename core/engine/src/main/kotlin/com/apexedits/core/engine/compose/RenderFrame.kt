package com.apexedits.core.engine.compose

import com.apexedits.core.engine.animation.transformAt
import com.apexedits.core.engine.animation.volumeAt
import com.apexedits.core.model.Project
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.TrackKind
import com.apexedits.core.model.Transform

/**
 * The render contract.
 *
 * [composeFrame] turns "the document at time t" into a flat list of layers with
 * nothing left to interpret: every source time is resolved, every speed applied,
 * every transform final. Whatever consumes a [RenderFrame] cannot reach a
 * different conclusion about the edit than any other consumer, because there is
 * no decision left to make.
 *
 * That matters because the preview and the exporter are different pieces of
 * Media3 — a `CompositionPlayer` and a `Transformer`. The PRD requires the
 * export to match the preview to within a frame. Making both consume the same
 * resolved description turns that from a thing QA has to keep catching into a
 * property of the architecture.
 */
data class RenderFrame(
    val time: Ticks,
    val width: Int,
    val height: Int,
    /** Bottom layer first, so a renderer draws them in order. */
    val layers: List<VideoLayer>,
    val audio: List<AudioLayer>,
) {
    val isEmpty: Boolean get() = layers.isEmpty() && audio.isEmpty()
}

data class VideoLayer(
    val clipId: String,
    val mediaId: String,
    val mediaUri: String,
    /** Where in the source this frame comes from. Already speed-adjusted. */
    val sourceTime: Ticks,
    val transform: Transform,
    /** Track opacity folded into clip opacity, so the renderer applies one number. */
    val effectiveOpacity: Float,
)

data class AudioLayer(
    val clipId: String,
    val mediaId: String,
    val mediaUri: String,
    val sourceTime: Ticks,
    /** Clip volume × track volume, with mute and solo already resolved. */
    val effectiveVolume: Float,
)

/**
 * Resolves [project] at [time] into a flat frame description.
 *
 * Layers come back bottom-first. A clip contributes nothing when it is disabled,
 * its track is hidden, or its media is missing — a missing file yields a frame
 * without that layer rather than a failure, so the timeline still plays while
 * the user relinks it.
 */
fun composeFrame(project: Project, time: Ticks): RenderFrame {
    val soloedAudio = project.audioTracks.any { it.solo }

    val layers = mutableListOf<VideoLayer>()
    val audio = mutableListOf<AudioLayer>()

    for (track in project.tracks) {
        val clip = track.clipAt(time) ?: continue
        if (!clip.enabled) continue
        val media = project.mediaRef(clip.mediaId) ?: continue
        if (!media.available) continue

        val sourceTime = clip.sourceTimeAt(time)
        // Keyframes are resolved here, once, rather than by each consumer. A
        // layer leaving this function carries final values only.
        val transform = clip.transformAt(time)
        val volume = clip.volumeAt(time)

        when (track.kind) {
            TrackKind.VIDEO -> {
                if (!track.visible) continue
                layers += VideoLayer(
                    clipId = clip.id,
                    mediaId = media.id,
                    mediaUri = media.uri,
                    sourceTime = sourceTime,
                    transform = transform,
                    effectiveOpacity = transform.opacity.coerceIn(0f, 1f),
                )
                // A video clip with sound contributes audio too, unless its
                // track is muted or another track has been soloed.
                if (media.hasAudio && !track.muted && !soloedAudio) {
                    audio += AudioLayer(
                        clipId = clip.id,
                        mediaId = media.id,
                        mediaUri = media.uri,
                        sourceTime = sourceTime,
                        effectiveVolume = volume * track.volume,
                    )
                }
            }

            TrackKind.AUDIO -> {
                // Solo wins over mute: soloing a track silences the others
                // without changing their mute state, so unsoloing restores
                // exactly what the user had set.
                val audible = if (soloedAudio) track.solo else !track.muted
                if (!audible) continue
                audio += AudioLayer(
                    clipId = clip.id,
                    mediaId = media.id,
                    mediaUri = media.uri,
                    sourceTime = sourceTime,
                    effectiveVolume = volume * track.volume,
                )
            }
        }
    }

    return RenderFrame(
        time = time,
        width = project.format.width,
        height = project.format.height,
        layers = layers,
        audio = audio,
    )
}

/**
 * The times at which the composition changes — every clip start and end, and
 * zero.
 *
 * The exporter walks these to build one Media3 `EditedMediaItem` per segment
 * instead of per frame, and the timeline uses them for snapping.
 */
fun compositionBoundaries(project: Project): List<Ticks> =
    (listOf(Ticks.ZERO) + project.tracks.flatMap { track ->
        track.clips.flatMap { listOf(it.timelineStart, it.timelineEnd) }
    }).distinct().sortedBy { it.raw }
