package com.apexedits.core.model

import kotlinx.serialization.Serializable

/**
 * The edit document.
 *
 * Everything here is immutable. An edit produces a new [Project] that shares
 * every untouched track and clip with the old one, so undo is a reference to a
 * previous value rather than a copy of the timeline. That is what makes deep
 * undo affordable on a phone with 3 GB of RAM — the PRD asks for an undo stack
 * that is both deep and persistent, and copying a 30-minute timeline per
 * keystroke would not survive that.
 */
@Serializable
data class Project(
    val id: String,
    val name: String,
    val format: ProjectFormat,
    val tracks: List<Track> = emptyList(),
    val media: List<MediaRef> = emptyList(),
    val markers: List<Marker> = emptyList(),
    val createdAtEpochMs: Long = 0L,
    val modifiedAtEpochMs: Long = 0L,
    /** Bumped on every mutation. Lets the autosave layer skip no-op writes. */
    val revision: Long = 0L,
) {
    /** End of the last clip on any track. Zero for an empty project. */
    val duration: Ticks
        get() = tracks.flatMap { it.clips }.maxOfOrNull { it.timelineEnd } ?: Ticks.ZERO

    val videoTracks: List<Track> get() = tracks.filter { it.kind == TrackKind.VIDEO }

    val audioTracks: List<Track> get() = tracks.filter { it.kind == TrackKind.AUDIO }

    fun track(id: String): Track? = tracks.firstOrNull { it.id == id }

    fun clip(id: String): Clip? = tracks.firstNotNullOfOrNull { t -> t.clips.firstOrNull { it.id == id } }

    fun trackOf(clipId: String): Track? = tracks.firstOrNull { t -> t.clips.any { it.id == clipId } }

    fun mediaRef(id: String): MediaRef? = media.firstOrNull { it.id == id }
}

@Serializable
data class ProjectFormat(
    val width: Int,
    val height: Int,
    val frameRate: FrameRate,
    val aspect: AspectRatio,
) {
    val ticksPerFrame: Ticks get() = frameRate.ticksPerFrame

    companion object {
        fun of(aspect: AspectRatio, height: Int = 1080, frameRate: FrameRate = FrameRate.FPS_30) =
            ProjectFormat(
                width = aspect.widthFor(height),
                height = height,
                frameRate = frameRate,
                aspect = aspect,
            )
    }
}

/**
 * Project aspect ratios. Each carries the plain-language guidance the PRD
 * requires the New Project dialog to show — "9:16 Vertical — Best for TikTok,
 * Reels, Shorts" — so the copy lives with the value rather than being retyped
 * in whichever screen happens to display it.
 */
@Serializable
enum class AspectRatio(
    val ratioWidth: Int,
    val ratioHeight: Int,
    val displayName: String,
    val guidance: String,
) {
    VERTICAL_9_16(9, 16, "9:16 Vertical", "Best for TikTok, Reels, and YouTube Shorts."),
    LANDSCAPE_16_9(16, 9, "16:9 Landscape", "Best for YouTube and most video players."),
    SQUARE_1_1(1, 1, "1:1 Square", "Best for Instagram feed posts."),
    PORTRAIT_4_5(4, 5, "4:5 Portrait", "Taller than square, for Instagram and Facebook feeds."),
    CLASSIC_4_3(4, 3, "4:3 Classic", "The older TV shape, for a retro look."),
    CINEMATIC_2_35(47, 20, "2.35:1 Cinematic", "Wide film shape, for a movie-like feel.");

    /** The width that pairs with [height] at this ratio, rounded to an even number for codecs. */
    fun widthFor(height: Int): Int {
        val w = (height.toLong() * ratioWidth / ratioHeight).toInt()
        return if (w % 2 == 0) w else w + 1
    }

    val label: String get() = displayName
}

@Serializable
enum class TrackKind { VIDEO, AUDIO }

/**
 * A track. [magnetic] selects the PRD's two timeline modes: in magnetic mode a
 * ripple edit closes gaps automatically; in freeform mode clips stay where they
 * were put.
 */
@Serializable
data class Track(
    val id: String,
    val kind: TrackKind,
    val name: String,
    val clips: List<Clip> = emptyList(),
    val magnetic: Boolean = true,
    val locked: Boolean = false,
    val muted: Boolean = false,
    val solo: Boolean = false,
    val visible: Boolean = true,
    val volume: Float = 1f,
) {
    /** Clips in timeline order. The invariant every operation restores. */
    val ordered: List<Clip> get() = clips.sortedBy { it.timelineStart.raw }

    fun clipAt(time: Ticks): Clip? = clips.firstOrNull { it.contains(time) }

    fun clipsOverlapping(start: Ticks, end: Ticks): List<Clip> =
        clips.filter { it.timelineStart < end && it.timelineEnd > start }
}

/**
 * A clip: a window onto a piece of media, placed at a point on the timeline.
 *
 * [sourceIn] and [sourceOut] index into the media. [timelineStart] places it.
 * Duration is derived rather than stored, so the three can never disagree.
 */
@Serializable
data class Clip(
    val id: String,
    val mediaId: String,
    val timelineStart: Ticks,
    val sourceIn: Ticks,
    val sourceOut: Ticks,
    val transform: Transform = Transform(),
    val volume: Float = 1f,
    val speed: Float = 1f,
    val enabled: Boolean = true,
    val label: String? = null,
    val colorTag: ColorTag? = null,
    /** Set when this clip's audio was detached from its video, or vice versa. */
    val linkedClipId: String? = null,
) {
    /** Length of the source window. Playback speed scales it onto the timeline. */
    val sourceDuration: Ticks get() = sourceOut - sourceIn

    /** Length on the timeline, after speed. */
    val timelineDuration: Ticks
        get() = if (speed == 1f) sourceDuration
        else Ticks((sourceDuration.raw / speed).toLong())

    val timelineEnd: Ticks get() = timelineStart + timelineDuration

    fun contains(time: Ticks): Boolean = time >= timelineStart && time < timelineEnd

    /** The point in the source that plays at timeline position [time]. */
    fun sourceTimeAt(time: Ticks): Ticks {
        val offset = time - timelineStart
        val scaled = if (speed == 1f) offset else Ticks((offset.raw * speed).toLong())
        return (sourceIn + scaled).coerceIn(sourceIn, sourceOut)
    }
}

/** Colour tags for organising a busy timeline. Names, not just swatches. */
@Serializable
enum class ColorTag(val displayName: String) {
    RED("Red"), ORANGE("Orange"), YELLOW("Yellow"),
    GREEN("Green"), BLUE("Blue"), PURPLE("Purple")
}

/**
 * Geometric state of a clip. Phase 1 stores and renders static values; the
 * keyframe system in Phase 2 animates these same fields, which is why they are
 * modelled now rather than bolted on later.
 */
@Serializable
data class Transform(
    val positionX: Float = 0f,
    val positionY: Float = 0f,
    val scaleX: Float = 1f,
    val scaleY: Float = 1f,
    val rotationDegrees: Float = 0f,
    val opacity: Float = 1f,
    val flipHorizontal: Boolean = false,
    val flipVertical: Boolean = false,
    val cropLeft: Float = 0f,
    val cropTop: Float = 0f,
    val cropRight: Float = 0f,
    val cropBottom: Float = 0f,
) {
    val isIdentity: Boolean
        get() = positionX == 0f && positionY == 0f && scaleX == 1f && scaleY == 1f &&
            rotationDegrees == 0f && opacity == 1f && !flipHorizontal && !flipVertical &&
            cropLeft == 0f && cropTop == 0f && cropRight == 0f && cropBottom == 0f
}

/** A named point on the timeline. [note] carries the PRD's clip comments. */
@Serializable
data class Marker(
    val id: String,
    val time: Ticks,
    val name: String,
    val note: String = "",
    val colorTag: ColorTag? = null,
)

/**
 * A reference to imported media.
 *
 * [uri] is stored as a string because the model must not depend on Android. The
 * data layer resolves it and reports [available] = false when a relink is
 * needed, which drives the PRD's missing-media flow.
 */
@Serializable
data class MediaRef(
    val id: String,
    val uri: String,
    val displayName: String,
    val kind: MediaKind,
    val duration: Ticks,
    val width: Int = 0,
    val height: Int = 0,
    val rotationDegrees: Int = 0,
    val frameRate: Float = 0f,
    val hasAudio: Boolean = false,
    val sizeBytes: Long = 0L,
    val available: Boolean = true,
    /** Path to a generated low-resolution stand-in, when one exists. */
    val proxyPath: String? = null,
) {
    val isVisual: Boolean get() = kind == MediaKind.VIDEO || kind == MediaKind.IMAGE
}

@Serializable
enum class MediaKind { VIDEO, AUDIO, IMAGE }
