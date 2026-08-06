package com.apexedit.editor.core

import android.net.Uri
import java.util.UUID

/**
 * The document model.
 *
 * Everything is immutable with structural sharing: an edit returns a new
 * document that reuses every object it did not touch. That is what makes
 * unlimited undo affordable — a history entry is a reference, not a copy.
 */

typealias Id = String

fun newId(prefix: String): Id = "${prefix}_${UUID.randomUUID().toString().take(8)}"

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

enum class MediaKind { VIDEO, AUDIO, IMAGE }

data class MediaAsset(
    val id: Id,
    val kind: MediaKind,
    val name: String,
    val uri: Uri,
    /** Full source duration in ticks. Null for stills, which are unbounded. */
    val duration: Long?,
    val width: Int = 0,
    val height: Int = 0,
    val frameRate: FrameRate = FrameRate.FPS_30,
    val hasAudio: Boolean = false,
    /** Rotation baked into the container, in degrees. */
    val rotationDegrees: Int = 0,
    /** Normalised 0..1 peaks for waveform drawing. */
    val waveform: FloatArray? = null,
) {
    /** Display aspect, accounting for container rotation. */
    val aspect: Float
        get() {
            if (width == 0 || height == 0) return 16f / 9f
            return if (rotationDegrees == 90 || rotationDegrees == 270) {
                height.toFloat() / width
            } else {
                width.toFloat() / height
            }
        }

    // Arrays break data-class equality; compare by identity of the payload.
    override fun equals(other: Any?): Boolean = this === other || (other is MediaAsset && other.id == id)
    override fun hashCode(): Int = id.hashCode()
}

// ---------------------------------------------------------------------------
// Tracks and clips
// ---------------------------------------------------------------------------

enum class TrackKind { VIDEO, AUDIO }

data class Track(
    val id: Id,
    val kind: TrackKind,
    val name: String,
    /** Higher index composites on top. */
    val index: Int,
    val enabled: Boolean = true,
    val locked: Boolean = false,
    val muted: Boolean = false,
    val solo: Boolean = false,
    val volumeDb: Float = 0f,
)

enum class BlendMode { NORMAL, MULTIPLY, SCREEN, OVERLAY, ADD, DARKEN, LIGHTEN, DIFFERENCE }

/** Normalised transform: 0 is centre, ±0.5 is a frame edge. */
data class Transform(
    val x: Float = 0f,
    val y: Float = 0f,
    val scale: Float = 1f,
    val rotationDegrees: Float = 0f,
    val opacity: Float = 1f,
    val flipH: Boolean = false,
    val flipV: Boolean = false,
    val cropTop: Float = 0f,
    val cropRight: Float = 0f,
    val cropBottom: Float = 0f,
    val cropLeft: Float = 0f,
) {
    val isIdentity: Boolean
        get() = x == 0f && y == 0f && scale == 1f && rotationDegrees == 0f &&
            opacity == 1f && !flipH && !flipV &&
            cropTop == 0f && cropRight == 0f && cropBottom == 0f && cropLeft == 0f
}

/**
 * Colour grade, in human units: exposure in stops, everything else −1..1.
 * Compiled into GL effects by the media layer; the UI never sees a shader.
 */
data class Grade(
    val exposure: Float = 0f,
    val contrast: Float = 0f,
    val saturation: Float = 0f,
    val temperature: Float = 0f,
    val tint: Float = 0f,
    val highlights: Float = 0f,
    val shadows: Float = 0f,
    val vibrance: Float = 0f,
    val sharpness: Float = 0f,
    val vignette: Float = 0f,
    val grain: Float = 0f,
    val fade: Float = 0f,
    /** Id of a built-in look/filter, or null. */
    val filterId: String? = null,
    val filterStrength: Float = 1f,
) {
    val isNeutral: Boolean
        get() = exposure == 0f && contrast == 0f && saturation == 0f && temperature == 0f &&
            tint == 0f && highlights == 0f && shadows == 0f && vibrance == 0f &&
            sharpness == 0f && vignette == 0f && grain == 0f && fade == 0f && filterId == null

    companion object { val NEUTRAL = Grade() }
}

data class AudioParams(
    val volumeDb: Float = 0f,
    val muted: Boolean = false,
    val fadeInTicks: Long = 0,
    val fadeOutTicks: Long = 0,
    val pitchSemitones: Float = 0f,
    /** Keep voices natural when the speed changes. */
    val preservePitch: Boolean = true,
) {
    val isDefault: Boolean
        get() = volumeDb == 0f && !muted && fadeInTicks == 0L && fadeOutTicks == 0L &&
            pitchSemitones == 0f
}

enum class TransitionType { NONE, CROSS_DISSOLVE, DIP_TO_BLACK, DIP_TO_WHITE, SLIDE_LEFT, SLIDE_UP, ZOOM }

data class Transition(val type: TransitionType, val durationTicks: Long)

data class TextStyle(
    val fontSizeSp: Float = 42f,
    val color: Long = 0xFFFFFFFF,
    val bold: Boolean = true,
    val italic: Boolean = false,
    val align: Int = 1, // 0 left, 1 centre, 2 right
    val outlineWidth: Float = 0f,
    val outlineColor: Long = 0xFF000000,
    val shadow: Boolean = true,
    val backgroundColor: Long? = null,
)

/** What a clip shows. */
sealed interface ClipContent {
    data class Media(val mediaId: Id) : ClipContent
    data class Text(val text: String, val style: TextStyle = TextStyle()) : ClipContent
    data class Color(val argb: Long) : ClipContent
    data class Sticker(val assetName: String) : ClipContent
}

data class Clip(
    val id: Id,
    val trackId: Id,
    /** Position on the timeline. Always frame-aligned. */
    val start: Long,
    /** Length on the timeline, after speed. */
    val duration: Long,
    /** Offset into the source of the first frame shown. */
    val mediaIn: Long,
    val content: ClipContent,
    val speed: Float = 1f,
    val reversed: Boolean = false,
    val transform: Transform = Transform(),
    val grade: Grade = Grade.NEUTRAL,
    val audio: AudioParams = AudioParams(),
    val blendMode: BlendMode = BlendMode.NORMAL,
    val transitionIn: Transition? = null,
    /** Clips sharing a group move and trim together. */
    val linkGroup: Id? = null,
    val label: String? = null,
    val colorTag: Int? = null,
    val enabled: Boolean = true,
) {
    val end: Long get() = start + duration
    val range: TimeRange get() = TimeRange(start, duration)

    /** Source ticks this clip consumes at its speed. */
    val sourceSpan: Long get() = (duration * speed).toLong()
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

enum class AspectRatio(val label: String, val value: Float) {
    PORTRAIT_9_16("9:16", 9f / 16f),
    LANDSCAPE_16_9("16:9", 16f / 9f),
    SQUARE_1_1("1:1", 1f),
    PORTRAIT_4_5("4:5", 4f / 5f),
    CLASSIC_4_3("4:3", 4f / 3f),
    CINEMA_235("2.35:1", 2.35f),
}

data class ProjectSettings(
    val aspect: AspectRatio = AspectRatio.PORTRAIT_9_16,
    val frameRate: FrameRate = FrameRate.FPS_30,
    val backgroundColor: Long = 0xFF000000,
) {
    /** Working resolution: ~1080 on the short edge, always even for the encoder. */
    val width: Int get() = if (aspect.value >= 1f) even((1080 * aspect.value).toInt()) else 1080
    val height: Int get() = if (aspect.value >= 1f) 1080 else even((1080 / aspect.value).toInt())

    private fun even(n: Int) = if (n % 2 == 0) n else n + 1
}

data class EditDocument(
    val name: String = "Untitled",
    val settings: ProjectSettings = ProjectSettings(),
    val media: Map<Id, MediaAsset> = emptyMap(),
    val tracks: List<Track> = emptyList(),
    val clips: Map<Id, Clip> = emptyMap(),
    /** Clip ids per track, kept sorted by start. Derived; never persisted. */
    val trackClips: Map<Id, List<Id>> = emptyMap(),
) {
    val duration: Long get() = clips.values.maxOfOrNull { it.end } ?: 0L

    val videoTracks: List<Track> get() = tracks.filter { it.kind == TrackKind.VIDEO }.sortedBy { it.index }
    val audioTracks: List<Track> get() = tracks.filter { it.kind == TrackKind.AUDIO }.sortedBy { it.index }

    fun track(id: Id): Track? = tracks.firstOrNull { it.id == id }

    fun clipsOn(trackId: Id): List<Clip> =
        trackClips[trackId].orEmpty().mapNotNull { clips[it] }

    fun mediaFor(clip: Clip): MediaAsset? =
        (clip.content as? ClipContent.Media)?.let { media[it.mediaId] }

    /** The clip occupying [time] on [trackId], if any. */
    fun clipAt(trackId: Id, time: Long): Clip? =
        clipsOn(trackId).firstOrNull { it.range.contains(time) }

    companion object {
        /**
         * A new project. Six video and six audio tracks — enough for every
         * template we ship, and the count is data with no engine assumption
         * behind it, so raising it later is a one-line change.
         */
        fun create(
            name: String = "Untitled",
            aspect: AspectRatio = AspectRatio.PORTRAIT_9_16,
            frameRate: FrameRate = FrameRate.FPS_30,
            videoTracks: Int = 6,
            audioTracks: Int = 6,
        ): EditDocument {
            val tracks = buildList {
                repeat(videoTracks) { add(Track(newId("vt"), TrackKind.VIDEO, "V${it + 1}", it)) }
                repeat(audioTracks) { add(Track(newId("at"), TrackKind.AUDIO, "A${it + 1}", it)) }
            }
            return EditDocument(
                name = name,
                settings = ProjectSettings(aspect, frameRate),
                tracks = tracks,
                trackClips = tracks.associate { it.id to emptyList() },
            )
        }
    }
}
