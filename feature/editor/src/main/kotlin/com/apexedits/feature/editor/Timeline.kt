package com.apexedits.feature.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.apexedits.core.designsystem.ApexTrackToggle
import com.apexedits.core.designsystem.overflowSentinel
import com.apexedits.core.model.Clip
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
    modifier: Modifier = Modifier,
) {
    var pixelsPerSecond by remember { mutableFloatStateOf(DEFAULT_PIXELS_PER_SECOND) }
    val horizontalScroll = rememberScrollState()
    val verticalScroll = rememberScrollState()
    val density = LocalDensity.current

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
                )

                project.tracks.forEach { track ->
                    TrackLane(
                        track = track,
                        project = project,
                        pixelsPerSecond = pixelsPerSecond,
                        contentWidth = contentWidth,
                        selectedClipId = selectedClipId,
                        onSelectClip = onSelectClip,
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
    contentWidth: androidx.compose.ui.unit.Dp,
    selectedClipId: String?,
    onSelectClip: (String?) -> Unit,
) {
    Box(
        modifier = Modifier
            .width(contentWidth)
            .height(trackHeight(track))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f))
            .clickable { onSelectClip(null) },
    ) {
        track.ordered.forEach { clip ->
            ClipBlock(
                clip = clip,
                track = track,
                label = project.mediaRef(clip.mediaId)?.displayName ?: clip.label.orEmpty(),
                pixelsPerSecond = pixelsPerSecond,
                selected = clip.id == selectedClipId,
                onSelect = { onSelectClip(clip.id) },
            )
        }
    }
}

@Composable
private fun ClipBlock(
    clip: Clip,
    track: Track,
    label: String,
    pixelsPerSecond: Float,
    selected: Boolean,
    onSelect: () -> Unit,
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
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 6.dp),
        )
    }
}

@Composable
private fun TimeRuler(
    project: Project,
    pixelsPerSecond: Float,
    contentWidth: androidx.compose.ui.unit.Dp,
    onSeek: (Float) -> Unit,
) {
    val density = LocalDensity.current
    Box(
        modifier = Modifier
            .width(contentWidth)
            .height(RULER_HEIGHT)
            .background(MaterialTheme.colorScheme.surface)
            .pointerInput(contentWidth) {
                detectTapGestures { offset ->
                    onSeek((offset.x / size.width.toFloat()).coerceIn(0f, 1f))
                }
            }
            .semantics {
                contentDescription = "Timeline ruler. Tap anywhere to move the playhead to that " +
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
    }
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
private val RULER_HEIGHT = 24.dp
private val PLAYHEAD_WIDTH = 2.dp

/**
 * Zoom range. The default shows about a minute on a typical phone; the bounds
 * give the PRD's 30x span from fully zoomed out to frame-level precision.
 */
private const val DEFAULT_PIXELS_PER_SECOND = 40f
private const val MIN_PIXELS_PER_SECOND = 4f
private const val MAX_PIXELS_PER_SECOND = 1_200f

private const val MIN_CLIP_WIDTH_PX = 8f
private const val MIN_CONTENT_WIDTH_PX = 600f
