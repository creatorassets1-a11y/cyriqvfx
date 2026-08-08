package com.apexedits.feature.editor

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.apexedits.core.designsystem.ApexTrackToggle
import com.apexedits.core.designsystem.overflowSentinel
import com.apexedits.core.engine.edit.keyframeTimelineTimes
import com.apexedits.core.media.ThumbnailCache
import com.apexedits.core.media.WaveformExtractor
import com.apexedits.core.model.Clip
import com.apexedits.core.model.ColorTag
import com.apexedits.core.model.MediaRef
import com.apexedits.core.model.Project
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.Track
import com.apexedits.core.model.TrackKind
import com.apexedits.core.model.formatTimecode
import kotlin.math.roundToLong

/**
 * The multi-track timeline.
 *
 * Two things drive the design.
 *
 * **Zoom is a scale factor, not a layout parameter.** Clip widths are computed
 * from `ticks × pixelsPerTick`, so a pinch changes one number and everything
 * re-lays-out consistently. The alternative — recomputing dp widths per clip on
 * every gesture frame — is where timeline implementations usually start to
 * stutter.
 *
 * **Track headers are pinned and the clip area scrolls.** Headers carry the
 * lock, mute, solo and visibility toggles, which the PRD requires to be
 * reachable at all times; scrolling them away with the clips would mean
 * scrolling back to the start to mute a track.
 */
@Composable
fun Timeline(
    project: Project,
    playhead: Ticks,
    selectedClipId: String?,
    onSeek: (Ticks) -> Unit,
    onSelectClip: (String?) -> Unit,
    onToggleLock: (String, Boolean) -> Unit,
    onToggleMute: (String, Boolean) -> Unit,
    onMarkerClick: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var pixelsPerSecond by remember { mutableFloatStateOf(DEFAULT_PIXELS_PER_SECOND) }
    val horizontalScroll = rememberScrollState()
    val verticalScroll = rememberScrollState()
    val density = LocalDensity.current
    val context = LocalContext.current
    // One cache per screen instance, not per clip: extraction is expensive and
    // clips share media, so every clip drawn from the same source shares the
    // same decoded frames and waveform.
    val thumbnailCache = remember(context) { ThumbnailCache(context) }
    val waveformExtractor = remember(context) { WaveformExtractor(context) }

    Row(modifier = modifier.fillMaxSize().clipToBounds()) {
        // --- pinned headers ---
        Column(
            modifier = Modifier
                .width(TRACK_HEADER_WIDTH)
                .fillMaxHeight()
                .background(MaterialTheme.colorScheme.surface)
                .verticalScroll(verticalScroll)
                .overflowSentinel("TrackHeaders"),
        ) {
            // Spacer aligning headers with the ruler above the clips.
            Box(Modifier.height(RULER_HEIGHT).fillMaxWidth())
            project.tracks.forEach { track ->
                TrackHeader(
                    track = track,
                    onToggleLock = { onToggleLock(track.id, it) },
                    onToggleMute = { onToggleMute(track.id, it) },
                )
            }
        }

        // --- scrolling clip area ---
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight()
                .clipToBounds()
                .pointerInput(Unit) {
                    detectTransformGestures { _, _, zoom, _ ->
                        // Clamped to the PRD's 30x range, expressed relative to
                        // the default so the limits mean the same thing on every
                        // screen density.
                        pixelsPerSecond = (pixelsPerSecond * zoom)
                            .coerceIn(MIN_PIXELS_PER_SECOND, MAX_PIXELS_PER_SECOND)
                    }
                }
                .overflowSentinel("TimelineClips"),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .horizontalScroll(horizontalScroll)
                    .verticalScroll(verticalScroll),
            ) {
                val contentWidth = with(density) {
                    ((project.duration.toSeconds() * pixelsPerSecond).toFloat())
                        .coerceAtLeast(MIN_CONTENT_WIDTH_PX)
                        .toDp()
                }

                TimeRuler(
                    project = project,
                    pixelsPerSecond = pixelsPerSecond,
                    contentWidth = contentWidth,
                    onSeek = { fraction ->
                        onSeek(Ticks.ofSeconds(fraction * project.duration.toSeconds()))
                    },
                    onMarkerClick = onMarkerClick,
                )

                project.tracks.forEach { track ->
                    TrackLane(
                        track = track,
                        project = project,
                        pixelsPerSecond = pixelsPerSecond,
                        contentWidth = contentWidth,
                        selectedClipId = selectedClipId,
                        onSelectClip = onSelectClip,
                        thumbnailCache = thumbnailCache,
                        waveformExtractor = waveformExtractor,
                    )
                }
            }

            // The playhead sits above the scrolling content but inside the same
            // clipped box, so it can never be drawn over the track headers.
            Playhead(
                playhead = playhead,
                pixelsPerSecond = pixelsPerSecond,
                scrollOffsetPx = horizontalScroll.value,
            )
        }
    }
}

@Composable
private fun TrackHeader(
    track: Track,
    onToggleLock: (Boolean) -> Unit,
    onToggleMute: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(trackHeight(track))
            .padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = track.name,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        ApexTrackToggle(
            icon = Icons.Filled.Lock,
            label = "Lock",
            tooltip = "Lock Track — Protects everything on this track so it cannot be moved or " +
                "changed by accident.",
            description = "Lock or unlock ${track.name}. While locked, clips on it cannot be " +
                "moved, trimmed, or deleted.",
            checked = track.locked,
            onCheckedChange = onToggleLock,
        )
        ApexTrackToggle(
            icon = Icons.Filled.VolumeOff,
            label = "Mute",
            tooltip = "Mute Track — Silences this track so you cannot hear it, without deleting " +
                "anything.",
            description = "Mute or unmute ${track.name}. Muting silences it during playback and " +
                "in the exported video, but keeps the clips.",
            checked = track.muted,
            onCheckedChange = onToggleMute,
        )
    }
}

@Composable
private fun TrackLane(
    track: Track,
    project: Project,
    pixelsPerSecond: Float,
    contentWidth: Dp,
    selectedClipId: String?,
    onSelectClip: (String?) -> Unit,
    thumbnailCache: ThumbnailCache,
    waveformExtractor: WaveformExtractor,
) {
    Box(
        modifier = Modifier
            .width(contentWidth)
            .height(trackHeight(track))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f))
            .clickable { onSelectClip(null) },
    ) {
        track.ordered.forEach { clip ->
            val media = project.mediaRef(clip.mediaId)
            ClipBlock(
                clip = clip,
                track = track,
                media = media,
                label = media?.displayName ?: clip.label.orEmpty(),
                pixelsPerSecond = pixelsPerSecond,
                selected = clip.id == selectedClipId,
                onSelect = { onSelectClip(clip.id) },
                thumbnailCache = thumbnailCache,
                waveformExtractor = waveformExtractor,
            )
        }
    }
}

@Composable
private fun ClipBlock(
    clip: Clip,
    track: Track,
    media: MediaRef?,
    label: String,
    pixelsPerSecond: Float,
    selected: Boolean,
    onSelect: () -> Unit,
    thumbnailCache: ThumbnailCache,
    waveformExtractor: WaveformExtractor,
) {
    val density = LocalDensity.current
    val startDp = with(density) { (clip.timelineStart.toSeconds() * pixelsPerSecond).toFloat().toDp() }
    val widthDp = with(density) {
        (clip.timelineDuration.toSeconds() * pixelsPerSecond).toFloat()
            // A sub-pixel clip would be invisible and untappable. Every clip
            // stays wide enough to hit even at the furthest zoom-out.
            .coerceAtLeast(MIN_CLIP_WIDTH_PX)
            .toDp()
    }

    Box(
        modifier = Modifier
            .padding(start = startDp, top = 2.dp, bottom = 2.dp)
            .width(widthDp)
            .fillMaxHeight()
            .background(
                if (track.kind == TrackKind.VIDEO) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.secondaryContainer
                },
                RoundedCornerShape(6.dp),
            )
            .border(
                width = if (selected) 2.dp else 0.dp,
                color = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent,
                shape = RoundedCornerShape(6.dp),
            )
            .clickable(onClick = onSelect)
            .semantics {
                contentDescription = buildString {
                    append(if (track.kind == TrackKind.VIDEO) "Video clip" else "Audio clip")
                    append(" ").append(label)
                    append(", ").append(formatSeconds(clip.timelineDuration.toSeconds())).append(" long")
                    append(", starting at ").append(formatSeconds(clip.timelineStart.toSeconds()))
                    append(", on ").append(track.name)
                    if (selected) append(". Selected")
                }
            }
            .clipToBounds(),
        contentAlignment = Alignment.CenterStart,
    ) {
        // Drawn first so the label and keyframe diamonds layer on top of it
        // rather than under it — a thumbnail behind unreadable text would
        // defeat the point of the label.
        if (media != null && media.available) {
            if (track.kind == TrackKind.VIDEO) {
                VideoThumbnailStrip(
                    clip = clip,
                    media = media,
                    widthDp = widthDp,
                    thumbnailCache = thumbnailCache,
                )
            } else {
                AudioWaveform(
                    clip = clip,
                    media = media,
                    widthDp = widthDp,
                    waveformExtractor = waveformExtractor,
                )
            }
        }

        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .padding(horizontal = 6.dp)
                // The strip behind it can be any brightness, so the label gets
                // a scrim rather than risking unreadable text on a bright frame.
                .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.55f), RoundedCornerShape(3.dp)),
        )

        // Animation points, drawn along the bottom of the clip so they never
        // cover the name. Only on the selected clip: showing every clip's
        // keyframes at once turns a busy timeline into confetti.
        if (selected && clip.hasAnimation) {
            KeyframeMarkers(clip = clip, pixelsPerSecond = pixelsPerSecond)
        }
    }
}

/**
 * A strip of frames sampled evenly across the clip's source window.
 *
 * One slot roughly every [THUMBNAIL_SLOT_WIDTH] rather than one per pixel: a
 * `MediaMetadataRetriever` seek costs tens of milliseconds, so the strip asks
 * for only as many frames as are actually distinguishable at the clip's
 * current on-screen width.
 */
@Composable
private fun BoxScope.VideoThumbnailStrip(
    clip: Clip,
    media: MediaRef,
    widthDp: Dp,
    thumbnailCache: ThumbnailCache,
) {
    val density = LocalDensity.current
    val slotCount = with(density) { (widthDp.toPx() / THUMBNAIL_SLOT_WIDTH_PX) }
        .toInt()
        .coerceIn(1, MAX_THUMBNAIL_SLOTS)

    Row(modifier = Modifier.matchParentSize().clipToBounds()) {
        for (slot in 0 until slotCount) {
            // Sampled at the middle of each slot's share of the clip, not the
            // start: the middle frame is the one that best represents what a
            // viewer sees while that slot is on screen during playback.
            val fraction = (slot + 0.5f) / slotCount
            val sourceTime = remember(clip, fraction) {
                val offsetInClip = Ticks((clip.timelineDuration.raw * fraction).toLong())
                clip.sourceTimeAt(clip.timelineStart + offsetInClip)
            }
            val bitmap by produceState<Bitmap?>(initialValue = null, media.uri, sourceTime.raw) {
                value = thumbnailCache.frameAt(media.uri, sourceTime)
            }

            Box(modifier = Modifier.weight(1f).fillMaxHeight()) {
                bitmap?.let {
                    Image(
                        bitmap = it.asImageBitmap(),
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.matchParentSize(),
                    )
                }
            }
        }
    }
}

/**
 * Peak-amplitude bars for the clip's audio, decoded once per (source,
 * resolution) and cached — see [WaveformExtractor].
 */
@Composable
private fun BoxScope.AudioWaveform(
    clip: Clip,
    media: MediaRef,
    widthDp: Dp,
    waveformExtractor: WaveformExtractor,
) {
    val density = LocalDensity.current
    val bucketCount = with(density) { (widthDp.toPx() / WAVEFORM_BAR_SPACING_PX) }
        .toInt()
        .coerceIn(1, MAX_WAVEFORM_BUCKETS)

    val peaks by produceState<FloatArray?>(initialValue = null, media.uri, bucketCount) {
        value = waveformExtractor.peaks(media.uri, bucketCount)
    }
    val barColor = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.6f)

    peaks?.let { bars ->
        Canvas(modifier = Modifier.matchParentSize().padding(horizontal = 4.dp)) {
            if (bars.isEmpty()) return@Canvas
            val barWidth = size.width / bars.size
            bars.forEachIndexed { index, peak ->
                // A silent bar still draws a hairline: a gap would read as
                // "no waveform loaded yet" rather than "this part is quiet".
                val barHeight = (size.height * peak).coerceAtLeast(2f)
                drawRect(
                    color = barColor,
                    topLeft = Offset(index * barWidth, (size.height - barHeight) / 2f),
                    size = Size((barWidth * 0.7f).coerceAtLeast(1f), barHeight),
                )
            }
        }
    }
}

@Composable
private fun BoxScope.KeyframeMarkers(clip: Clip, pixelsPerSecond: Float) {
    val density = LocalDensity.current
    val times = remember(clip.animations, clip.timelineStart) { clip.keyframeTimelineTimes() }

    for (time in times) {
        val offset = with(density) {
            ((time - clip.timelineStart).toSeconds() * pixelsPerSecond).toFloat().toDp()
        }
        Box(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = (offset - KEYFRAME_MARKER_SIZE / 2).coerceAtLeast(0.dp), bottom = 2.dp)
                .size(KEYFRAME_MARKER_SIZE)
                // A rotated square reads as the diamond every NLE uses, without
                // needing an icon asset.
                .rotate(45f)
                .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(1.dp))
                .semantics {
                    contentDescription = "Animation point at " +
                        formatSeconds(time.toSeconds()) + " on this clip."
                },
        )
    }
}

@Composable
private fun TimeRuler(
    project: Project,
    pixelsPerSecond: Float,
    contentWidth: Dp,
    onSeek: (Float) -> Unit,
    onMarkerClick: (String) -> Unit,
) {
    val density = LocalDensity.current
    Box(
        modifier = Modifier
            .width(contentWidth)
            .height(RULER_HEIGHT)
            .background(MaterialTheme.colorScheme.surface)
            .pointerInput(contentWidth) {
                // A plain `detectTapGestures` only fires on a stationary
                // tap-and-release; it never sees a finger that moves, so
                // dragging along the ruler to scrub did nothing. Handling the
                // down event directly covers both: touching anywhere jumps
                // the playhead there immediately (the tap case), and `drag`
                // keeps tracking the same pointer for as long as it moves
                // (the scrub case), rather than requiring a second gesture
                // recogniser to take over mid-touch.
                awaitEachGesture {
                    val down = awaitFirstDown()
                    onSeek((down.position.x / size.width.toFloat()).coerceIn(0f, 1f))
                    drag(down.id) { change ->
                        change.consume()
                        onSeek((change.position.x / size.width.toFloat()).coerceIn(0f, 1f))
                    }
                }
            }
            .semantics {
                contentDescription = "Timeline ruler. Tap or drag to move the playhead to that " +
                    "point in your video."
            },
    ) {
        // A tick every second at high zoom, thinning out as the user zooms out
        // so the ruler never becomes a solid block of labels.
        val secondsPerTick = when {
            pixelsPerSecond > 80f -> 1
            pixelsPerSecond > 30f -> 5
            pixelsPerSecond > 10f -> 15
            else -> 60
        }
        val totalSeconds = project.duration.toSeconds().toInt()
        for (second in 0..totalSeconds step secondsPerTick) {
            val x = with(density) { (second * pixelsPerSecond).toDp() }
            Text(
                text = formatSeconds(second.toDouble()),
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                modifier = Modifier.padding(start = x + 2.dp),
            )
        }

        // Markers sit above the second ticks so they read as pins planted in the
        // ruler rather than competing with the timecode labels underneath.
        for (marker in project.markers) {
            val x = with(density) { (marker.time.toSeconds() * pixelsPerSecond).toFloat().toDp() }
            Box(
                modifier = Modifier
                    .padding(start = (x - MARKER_FLAG_WIDTH / 2).coerceAtLeast(0.dp))
                    .width(MARKER_FLAG_WIDTH)
                    .height(RULER_HEIGHT)
                    .clickable { onMarkerClick(marker.id) }
                    .semantics {
                        contentDescription = "Marker \"${marker.name}\" at " +
                            formatSeconds(marker.time.toSeconds()) + ". Tap to rename or delete it."
                    },
                contentAlignment = Alignment.BottomCenter,
            ) {
                Box(
                    modifier = Modifier
                        .width(2.dp)
                        .fillMaxHeight()
                        .background(markerColor(marker.colorTag)),
                )
            }
        }
    }
}

/** Falls back to the theme's primary colour when the marker carries no explicit tag. */
@Composable
private fun markerColor(tag: ColorTag?): Color = when (tag) {
    ColorTag.RED -> Color(0xFFE57373)
    ColorTag.ORANGE -> Color(0xFFFFB74D)
    ColorTag.YELLOW -> Color(0xFFFFF176)
    ColorTag.GREEN -> Color(0xFF81C784)
    ColorTag.BLUE -> Color(0xFF64B5F6)
    ColorTag.PURPLE -> Color(0xFFBA68C8)
    null -> MaterialTheme.colorScheme.primary
}

@Composable
private fun Playhead(playhead: Ticks, pixelsPerSecond: Float, scrollOffsetPx: Int) {
    val density = LocalDensity.current
    val x = with(density) {
        ((playhead.toSeconds() * pixelsPerSecond).toFloat() - scrollOffsetPx).toDp()
    }
    // Off-screen playheads are not drawn at a negative offset, which would place
    // them over the track headers.
    if (x < 0.dp) return

    Box(
        modifier = Modifier
            .padding(start = x)
            .width(PLAYHEAD_WIDTH)
            .fillMaxHeight()
            .background(MaterialTheme.colorScheme.primary),
    )
}

private fun trackHeight(track: Track) =
    if (track.kind == TrackKind.VIDEO) VIDEO_TRACK_HEIGHT else AUDIO_TRACK_HEIGHT

/** `M:SS`, for ruler labels and clip descriptions. */
private fun formatSeconds(seconds: Double): String {
    val total = seconds.roundToLong()
    return "%d:%02d".format(total / 60, total % 60)
}

private val TRACK_HEADER_WIDTH = 132.dp
private val VIDEO_TRACK_HEIGHT = 56.dp
private val AUDIO_TRACK_HEIGHT = 44.dp
// Taller than the 24dp a pure timecode strip needs, so there is a comfortable
// drag target for scrubbing rather than a sliver that is easy to miss.
private val RULER_HEIGHT = 32.dp
private val PLAYHEAD_WIDTH = 2.dp
private val KEYFRAME_MARKER_SIZE = 8.dp
private val MARKER_FLAG_WIDTH = 24.dp

/**
 * Zoom range. The default shows about a minute on a typical phone; the bounds
 * give the PRD's 30x span from fully zoomed out to frame-level precision.
 */
private const val DEFAULT_PIXELS_PER_SECOND = 40f
private const val MIN_PIXELS_PER_SECOND = 4f
private const val MAX_PIXELS_PER_SECOND = 1_200f

private const val MIN_CLIP_WIDTH_PX = 8f
private const val MIN_CONTENT_WIDTH_PX = 600f

/** Roughly one thumbnail per finger-width, so a strip never asks for more frames than are distinguishable. */
private const val THUMBNAIL_SLOT_WIDTH_PX = 64f
private const val MAX_THUMBNAIL_SLOTS = 40

private const val WAVEFORM_BAR_SPACING_PX = 6f
private const val MAX_WAVEFORM_BUCKETS = 300
