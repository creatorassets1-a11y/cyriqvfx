package com.apexedit.editor.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.draw.drawBehind
import androidx.media3.common.util.UnstableApi
import com.apexedit.editor.core.*
import com.apexedit.editor.vm.EditorUiState
import com.apexedit.editor.vm.EditorViewModel
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * The timeline.
 *
 * Three gestures share one surface, told apart by where the touch lands: a drag
 * on a clip body moves it, a drag within [TRIM_HANDLE_DP] of an edge trims it,
 * and a drag anywhere else scrubs. Pinch zooms. Each gesture folds into one
 * undo entry via the view model's coalescing key.
 *
 * Only tracks that hold something are drawn, plus one empty of each kind. An
 * empty project showing twelve blank rows is noise, and on a phone it is most
 * of the screen.
 */
private const val TRIM_HANDLE_DP = 20
private const val SNAP_PX = 14

@UnstableApi
@Composable
fun Timeline(vm: EditorViewModel, ui: EditorUiState, modifier: Modifier = Modifier) {
    val doc = ui.doc
    val density = LocalDensity.current
    val scroll = rememberScrollState()

    val pxPerSecond = ui.zoom
    fun ticksToPx(t: Long): Float = (Time.ticksToSeconds(t) * pxPerSecond).toFloat()
    fun pxToTicks(px: Float): Long = Time.secondsToTicks((px / pxPerSecond).toDouble())

    val snapTolerance = pxToTicks(SNAP_PX.toFloat())

    // Visible tracks: those in use, plus one spare of each kind to drop onto.
    val tracks = remember(doc) {
        val video = doc.videoTracks
        val audio = doc.audioTracks
        fun trim(list: List<Track>): List<Track> {
            val lastUsed = list.indexOfLast { doc.trackClips[it.id]?.isNotEmpty() == true }
            return list.take((lastUsed + 2).coerceIn(1, list.size))
        }
        // Video drawn top-down with the highest track first, matching how
        // layers stack visually.
        trim(video).reversed() + trim(audio)
    }

    val contentWidth = with(density) {
        (ticksToPx(doc.duration) + 600).toDp().coerceAtLeast(400.dp)
    }

    var dragState by remember { mutableStateOf<DragState?>(null) }

    Column(
        modifier
            .background(ApexColors.Panel)
            .border(width = 0.5.dp, color = ApexColors.Border),
    ) {
        TimelineBar(
            snapping = ui.snapping,
            ripple = ui.rippleMode,
            onToggleSnap = vm::toggleSnapping,
            onToggleRipple = vm::toggleRipple,
            onZoomIn = { vm.setZoom(ui.zoom * 1.5f) },
            onZoomOut = { vm.setZoom(ui.zoom / 1.5f) },
        )

        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .horizontalScroll(scroll)
                .pointerInput(ui.zoom) {
                    // Pinch to zoom, anchored so the gesture feels attached to
                    // the timeline rather than to the viewport.
                    detectTransformGestures { _, _, zoomChange, _ ->
                        if (abs(zoomChange - 1f) > 0.002f) vm.setZoom(ui.zoom * zoomChange)
                    }
                },
        ) {
            Column(Modifier.width(contentWidth)) {
                Ruler(
                    durationTicks = doc.duration,
                    pxPerSecond = pxPerSecond,
                    widthDp = contentWidth,
                    onScrub = { x -> vm.seek(pxToTicks(x)) },
                )

                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = Dimens.SpaceXs)
                        .pointerInput(doc, ui.zoom) {
                            // Empty lane space scrubs. The ruler alone is a
                            // 28dp target, far too small to be the only way to
                            // move the playhead on a phone.
                            detectTapGestures { offset ->
                                vm.select(null)
                                vm.seek(pxToTicks(offset.x))
                            }
                        },
                ) {
                    tracks.forEach { track ->
                        TrackRow(
                            track = track,
                            clips = doc.clipsOn(track.id),
                            doc = doc,
                            selection = ui.selection,
                            ticksToPx = ::ticksToPx,
                            onSelect = vm::select,
                            onDragStart = { clip, kind, offsetX ->
                                dragState = DragState(
                                    clipId = clip.id,
                                    kind = kind,
                                    trackId = track.id,
                                    startTicks = clip.start,
                                    startDuration = clip.duration,
                                    grabX = offsetX,
                                    key = "drag-${System.nanoTime()}",
                                )
                            },
                            onDrag = { deltaX, deltaY ->
                                val state = dragState ?: return@TrackRow
                                applyDrag(
                                    vm = vm,
                                    doc = doc,
                                    state = state,
                                    deltaTicks = pxToTicks(deltaX),
                                    deltaY = deltaY,
                                    tracks = tracks,
                                    snapping = ui.snapping,
                                    snapTolerance = snapTolerance,
                                )
                            },
                            onDragEnd = { dragState = null },
                        )
                    }
                }
            }

            // Playhead, drawn over everything and not interactive so it can
            // never swallow a touch meant for a clip.
            Box(
                Modifier
                    .fillMaxHeight()
                    .width(2.dp)
                    .offset(x = with(density) { ticksToPx(ui.playhead).toDp() })
                    .background(ApexColors.Record),
            )
        }
    }
}

private enum class DragKind { MOVE, TRIM_START, TRIM_END }

private data class DragState(
    val clipId: Id,
    val kind: DragKind,
    val trackId: Id,
    val startTicks: Long,
    val startDuration: Long,
    val grabX: Float,
    val key: String,
)

private fun applyDrag(
    vm: EditorViewModel,
    doc: EditDocument,
    state: DragState,
    deltaTicks: Long,
    deltaY: Float,
    tracks: List<Track>,
    snapping: Boolean,
    snapTolerance: Long,
) {
    fun snap(target: Long): Long =
        if (snapping) doc.snapTarget(target, snapTolerance, setOf(state.clipId)) ?: target else target

    when (state.kind) {
        DragKind.MOVE -> {
            val target = snap(state.startTicks + deltaTicks).coerceAtLeast(0)
            // Vertical travel past half a row retargets the track, but only
            // between tracks of the same kind.
            val index = tracks.indexOfFirst { it.id == state.trackId }
            val rowHeight = 56f
            val steps = (deltaY / rowHeight).roundToLong().toInt()
            val candidate = tracks.getOrNull((index + steps).coerceIn(0, tracks.lastIndex))
            val trackId = if (candidate != null && candidate.kind == tracks[index].kind) {
                candidate.id
            } else {
                state.trackId
            }
            vm.moveClip(state.clipId, trackId, target, state.key)
        }
        DragKind.TRIM_START -> vm.trimStart(state.clipId, snap(state.startTicks + deltaTicks), state.key)
        DragKind.TRIM_END ->
            vm.trimEnd(state.clipId, snap(state.startTicks + state.startDuration + deltaTicks), state.key)
    }
}

@Composable
private fun TimelineBar(
    snapping: Boolean,
    ripple: Boolean,
    onToggleSnap: () -> Unit,
    onToggleRipple: () -> Unit,
    onZoomIn: () -> Unit,
    onZoomOut: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(40.dp)
            .padding(horizontal = Dimens.SpaceS),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Chip("Snap", snapping, onToggleSnap)
        Spacer(Modifier.width(Dimens.SpaceXs))
        Chip("Ripple", ripple, onToggleRipple)
        Spacer(Modifier.weight(1f))
        Chip("−", false, onZoomOut)
        Spacer(Modifier.width(Dimens.SpaceXs))
        Chip("+", false, onZoomIn)
    }
}

@Composable
private fun Chip(label: String, active: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .heightIn(min = 32.dp)
            .widthIn(min = 44.dp)
            .clip(RoundedCornerShape(50))
            .background(if (active) ApexColors.Accent.copy(alpha = 0.18f) else ApexColors.Raised)
            .clickableNoRipple(onClick)
            .padding(horizontal = Dimens.SpaceM, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = if (active) ApexColors.Accent else ApexColors.TextSecondary,
            maxLines = 1,
        )
    }
}

@Composable
private fun Ruler(
    durationTicks: Long,
    pxPerSecond: Float,
    widthDp: androidx.compose.ui.unit.Dp,
    onScrub: (Float) -> Unit,
) {
    val density = LocalDensity.current
    // Interval chosen so labels stay at least 64px apart and read as time
    // rather than as arbitrary decimals.
    val interval = listOf(0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 15.0, 30.0, 60.0, 120.0, 300.0)
        .firstOrNull { it * pxPerSecond >= 64 } ?: 600.0

    Box(
        Modifier
            .fillMaxWidth()
            .height(Dimens.RulerHeight)
            .pointerInput(pxPerSecond) {
                detectTapGestures { offset -> onScrub(offset.x) }
                detectDragGestures { change, _ -> onScrub(change.position.x) }
            }
            .drawBehind {
                val step = (interval * pxPerSecond).toFloat()
                if (step <= 0f) return@drawBehind
                var x = 0f
                while (x < size.width) {
                    drawLine(
                        color = Color(0xFF232C38),
                        start = Offset(x, 0f),
                        end = Offset(x, size.height),
                        strokeWidth = 1f,
                    )
                    x += step
                }
            },
    ) {
        Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            var seconds = 0.0
            val count = with(density) { (widthDp.toPx() / (interval * pxPerSecond)).toInt() + 1 }
            repeat(count.coerceAtMost(200)) { i ->
                val label = Time.secondsToTicks(seconds).formatDuration(interval < 1)
                Box(Modifier.width(with(density) { (interval * pxPerSecond).toFloat().toDp() })) {
                    Text(
                        label,
                        style = MaterialTheme.typography.labelSmall,
                        color = ApexColors.TextTertiary,
                        maxLines = 1,
                        overflow = TextOverflow.Clip,
                        modifier = Modifier.padding(start = 4.dp),
                    )
                }
                seconds += interval
            }
        }
    }
}

@Composable
private fun TrackRow(
    track: Track,
    clips: List<Clip>,
    doc: EditDocument,
    selection: Set<Id>,
    ticksToPx: (Long) -> Float,
    onSelect: (Id?) -> Unit,
    onDragStart: (Clip, DragKind, Float) -> Unit,
    onDrag: (Float, Float) -> Unit,
    onDragEnd: () -> Unit,
) {
    val density = LocalDensity.current
    val height = if (track.kind == TrackKind.VIDEO) Dimens.TrackHeight else Dimens.AudioTrackHeight

    Box(
        Modifier
            .fillMaxWidth()
            .height(height)
            .padding(vertical = 2.dp),
    ) {
        clips.forEach { clip ->
            val left = with(density) { ticksToPx(clip.start).toDp() }
            val width = with(density) { ticksToPx(clip.duration).toDp() }.coerceAtLeast(12.dp)
            val selected = clip.id in selection

            ClipView(
                clip = clip,
                doc = doc,
                track = track,
                selected = selected,
                modifier = Modifier
                    .offset(x = left)
                    .width(width)
                    .fillMaxHeight()
                    .pointerInput(clip.id, track.locked) {
                        if (track.locked) return@pointerInput
                        // Accumulated travel since the press. Every edit is
                        // computed from the gesture's origin rather than from
                        // the previous frame: applying per-event deltas
                        // compounds rounding, and the clip drifts away from the
                        // finger over a long drag.
                        var total = Offset.Zero
                        detectDragGestures(
                            onDragStart = { offset ->
                                onSelect(clip.id)
                                total = Offset.Zero
                                val handlePx = TRIM_HANDLE_DP.dp.toPx()
                                val kind = when {
                                    // A short clip has no room for two handles
                                    // plus a body, so it is move-only.
                                    size.width < handlePx * 3 -> DragKind.MOVE
                                    offset.x <= handlePx -> DragKind.TRIM_START
                                    offset.x >= size.width - handlePx -> DragKind.TRIM_END
                                    else -> DragKind.MOVE
                                }
                                onDragStart(clip, kind, offset.x)
                            },
                            onDragEnd = onDragEnd,
                            onDragCancel = onDragEnd,
                        ) { change, dragAmount ->
                            change.consume()
                            total += dragAmount
                            onDrag(total.x, total.y)
                        }
                    }
                    .clickableNoRipple { onSelect(clip.id) },
            )
        }
    }
}

@Composable
private fun ClipView(
    clip: Clip,
    doc: EditDocument,
    track: Track,
    selected: Boolean,
    modifier: Modifier = Modifier,
) {
    val base = when {
        clip.content is ClipContent.Text -> ApexColors.TrackText
        track.kind == TrackKind.AUDIO -> ApexColors.TrackAudio
        else -> ApexColors.TrackVideo
    }
    val label = clip.label ?: when (val c = clip.content) {
        is ClipContent.Text -> c.text
        is ClipContent.Color -> "Colour"
        is ClipContent.Sticker -> "Sticker"
        is ClipContent.Media -> doc.media[c.mediaId]?.name ?: "Clip"
    }

    Box(
        modifier
            .clip(RoundedCornerShape(Dimens.RadiusS))
            .background(base.copy(alpha = 0.55f))
            .border(
                width = if (selected) 2.dp else 0.5.dp,
                color = if (selected) ApexColors.Accent else base,
                shape = RoundedCornerShape(Dimens.RadiusS),
            )
            .semantics {
                contentDescription =
                    "$label on ${track.name}, ${Time.ticksToSeconds(clip.duration).toInt()} seconds"
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        Row(
            Modifier.padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = Color.White,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (clip.speed != 1f) {
                Spacer(Modifier.width(4.dp))
                Text(
                    "${clip.speed}×",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White.copy(alpha = 0.85f),
                    maxLines = 1,
                )
            }
        }

        if (selected) {
            // Trim handles, drawn only when selected so the timeline stays calm.
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .fillMaxHeight()
                    .width(TRIM_HANDLE_DP.dp)
                    .background(ApexColors.Accent.copy(alpha = 0.25f)),
            )
            Box(
                Modifier
                    .align(Alignment.CenterEnd)
                    .fillMaxHeight()
                    .width(TRIM_HANDLE_DP.dp)
                    .background(ApexColors.Accent.copy(alpha = 0.25f)),
            )
        }
    }
}
