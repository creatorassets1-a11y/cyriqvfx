package com.apexedits.feature.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.apexedits.core.designsystem.ApexWidthClass
import com.apexedits.core.designsystem.overflowSentinel

/**
 * The editing screen's frame.
 *
 * The layout problem this solves is the one the PRD spends most of Part 2 on:
 * the preview, the timeline and the toolbar all have to be visible at once, on a
 * 4.5" phone and on a foldable, in either orientation, at any font scale — and
 * nothing may ever be clipped or pushed off-screen.
 *
 * The approach is to allocate space in *fractions of what is actually available*
 * rather than in fixed dp. There is no "timeline is 240dp tall" anywhere here.
 * The toolbar measures itself and takes what it needs — it is the one part whose
 * height genuinely depends on the font scale — and the preview and timeline
 * split the remainder at a ratio the user can drag, clamped so neither can
 * collapse or crowd the other out.
 *
 * Because the split is a ratio, a 200% font scale that makes the toolbar taller
 * shrinks the preview and timeline proportionally instead of pushing the
 * timeline off the bottom of the screen.
 */
@Composable
fun EditorLayout(
    availableWidth: Dp,
    availableHeight: Dp,
    preview: @Composable (Modifier) -> Unit,
    timeline: @Composable (Modifier) -> Unit,
    toolbar: @Composable (Modifier) -> Unit,
    topBar: @Composable (Modifier) -> Unit,
    modifier: Modifier = Modifier,
) {
    val widthClass = ApexWidthClass.of(availableWidth)

    // Wide and short — a landscape phone or an unfolded tablet — puts the
    // timeline beside the preview rather than under it. Stacking them in
    // landscape leaves the preview a letterbox slot too short to judge a frame.
    val sideBySide = widthClass != ApexWidthClass.COMPACT && availableWidth > availableHeight

    if (sideBySide) {
        TwoPaneEditor(availableWidth, availableHeight, preview, timeline, toolbar, topBar, modifier)
    } else {
        StackedEditor(availableHeight, preview, timeline, toolbar, topBar, modifier)
    }
}

@Composable
private fun StackedEditor(
    availableHeight: Dp,
    preview: @Composable (Modifier) -> Unit,
    timeline: @Composable (Modifier) -> Unit,
    toolbar: @Composable (Modifier) -> Unit,
    topBar: @Composable (Modifier) -> Unit,
    modifier: Modifier,
) {
    // The fraction of the space left after the top bar and toolbar that goes to
    // the preview. The user drags the divider to change it.
    var previewFraction by remember { mutableFloatStateOf(DEFAULT_PREVIEW_FRACTION) }
    val density = LocalDensity.current

    Column(modifier = modifier.fillMaxSize().overflowSentinel("EditorLayout")) {
        topBar(Modifier.fillMaxWidth())

        // weight(1f) hands this Box exactly the space the top bar and toolbar
        // did not take. Nothing inside it can therefore push them off-screen.
        Box(modifier = Modifier.fillMaxWidth().weight(1f).clipToBounds()) {
            androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
                val flexibleHeight = maxHeight
                // Clamped so neither region can be squeezed to nothing, however
                // hard the divider is dragged.
                val clamped = previewFraction.coerceIn(MIN_PREVIEW_FRACTION, MAX_PREVIEW_FRACTION)

                Column(Modifier.fillMaxSize()) {
                    preview(
                        Modifier
                            .fillMaxWidth()
                            .height(flexibleHeight * clamped)
                            .overflowSentinel("Preview"),
                    )

                    DividerHandle(
                        onDrag = { deltaPx ->
                            val deltaFraction = with(density) { deltaPx.toDp() } / flexibleHeight
                            previewFraction = (previewFraction + deltaFraction)
                                .coerceIn(MIN_PREVIEW_FRACTION, MAX_PREVIEW_FRACTION)
                        },
                    )

                    timeline(
                        Modifier
                            .fillMaxWidth()
                            // The remainder, whatever it is. Deriving it rather
                            // than computing a second fraction means the two can
                            // never sum to more than the space available.
                            .weight(1f)
                            .overflowSentinel("Timeline"),
                    )
                }
            }
        }

        // Measured last and given its intrinsic height, because this is the one
        // region whose size legitimately depends on the font scale.
        toolbar(Modifier.fillMaxWidth().overflowSentinel("Toolbar"))
    }
}

@Composable
private fun TwoPaneEditor(
    availableWidth: Dp,
    availableHeight: Dp,
    preview: @Composable (Modifier) -> Unit,
    timeline: @Composable (Modifier) -> Unit,
    toolbar: @Composable (Modifier) -> Unit,
    topBar: @Composable (Modifier) -> Unit,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize().overflowSentinel("EditorLayoutWide")) {
        topBar(Modifier.fillMaxWidth())

        Row(modifier = Modifier.fillMaxWidth().weight(1f)) {
            preview(
                Modifier
                    .fillMaxHeight()
                    .width(availableWidth * WIDE_PREVIEW_FRACTION)
                    .overflowSentinel("PreviewWide"),
            )
            Column(modifier = Modifier.fillMaxHeight().weight(1f)) {
                timeline(Modifier.fillMaxWidth().weight(1f).overflowSentinel("TimelineWide"))
                toolbar(Modifier.fillMaxWidth().overflowSentinel("ToolbarWide"))
            }
        }
    }
}

/**
 * The drag handle between preview and timeline.
 *
 * Its touch area is 24dp tall while the visible line is 4dp — a 4dp target would
 * be unusable, and the PRD's 48dp minimum applies to buttons rather than to a
 * divider whose whole edge is draggable.
 */
@Composable
private fun DividerHandle(onDrag: (Float) -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(DIVIDER_TOUCH_HEIGHT)
            .pointerInput(Unit) {
                detectDragGestures { change, dragAmount ->
                    change.consume()
                    onDrag(dragAmount.y)
                }
            }
            .semantics {
                contentDescription = "Resize handle. Drag up or down to make the video preview " +
                    "larger or the timeline larger."
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .width(DIVIDER_GRIP_WIDTH)
                .height(DIVIDER_LINE_HEIGHT)
                .background(
                    MaterialTheme.colorScheme.outline,
                    RoundedCornerShape(percent = 50),
                ),
        )
    }
}

/** Preview keeps 55% by default: enough to judge a frame, enough timeline to edit. */
private const val DEFAULT_PREVIEW_FRACTION = 0.55f

/**
 * The clamps. Below 30% the preview is too small to see what is being cut;
 * above 70% the timeline cannot show more than a couple of tracks. The PRD's
 * "at least 30–40% of the preview stays visible" is this lower bound.
 */
private const val MIN_PREVIEW_FRACTION = 0.30f
private const val MAX_PREVIEW_FRACTION = 0.70f

/** In the wide layout the preview takes a little over half the width. */
private const val WIDE_PREVIEW_FRACTION = 0.55f

private val DIVIDER_TOUCH_HEIGHT = 24.dp
private val DIVIDER_LINE_HEIGHT = 4.dp
private val DIVIDER_GRIP_WIDTH = 48.dp
