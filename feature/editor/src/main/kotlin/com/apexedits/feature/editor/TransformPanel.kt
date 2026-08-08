package com.apexedits.feature.editor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Diamond
import androidx.compose.material.icons.outlined.Diamond
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.apexedits.core.designsystem.ApexPanelHeader
import com.apexedits.core.designsystem.ApexSlider
import com.apexedits.core.designsystem.ApexToolButton
import com.apexedits.core.designsystem.overflowSentinel
import com.apexedits.core.engine.animation.valueAt
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.Clip
import com.apexedits.core.model.Ticks
import kotlin.math.roundToInt

/**
 * The Transform panel.
 *
 * Each property gets a slider and a keyframe diamond, which is the interaction
 * every desktop NLE uses and the one this PRD names explicitly. The diamond is
 * three-state, and the states are what make keyframing legible on a phone where
 * there is no room for a properties column:
 *
 *  - **outline** — not animated. Tapping starts an animation here.
 *  - **filled** — animated, and there is a keyframe exactly at the playhead.
 *    Tapping removes it.
 *  - **half** — animated, but the playhead is between keyframes. Tapping adds
 *    one holding the current interpolated value.
 *
 * The slider itself does the right thing without a mode switch: on a
 * non-animated property it moves the static value, on an animated one it writes
 * a keyframe at the playhead. That decision lives in the engine
 * (`setPropertyValue`), not here, so every other surface that edits a property
 * behaves the same way.
 */
@Composable
fun TransformPanel(
    clip: Clip,
    playhead: Ticks,
    maxHeight: Dp,
    onValueChange: (AnimatableProperty, Float) -> Unit,
    onValueChangeFinished: () -> Unit,
    onToggleKeyframe: (AnimatableProperty) -> Unit,
    onClearProperty: (AnimatableProperty) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            // Capped so the preview keeps at least 40% of the screen, as the
            // PRD requires of every panel. Derived from what is available rather
            // than a constant, so it holds on any device.
            .heightIn(max = maxHeight * PANEL_MAX_FRACTION)
            .overflowSentinel("TransformPanel"),
    ) {
        ApexPanelHeader(
            title = "Transform & Animation",
            purpose = "Move, resize, rotate, and fade the selected clip. Tap a diamond to " +
                "animate a setting so it changes over time.",
        )

        LazyColumn(
            modifier = Modifier.fillMaxWidth().weight(1f, fill = false),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(TRANSFORM_PROPERTIES) { property ->
                PropertyRow(
                    property = property,
                    clip = clip,
                    playhead = playhead,
                    onValueChange = { onValueChange(property, it) },
                    onValueChangeFinished = onValueChangeFinished,
                    onToggleKeyframe = { onToggleKeyframe(property) },
                    onClearProperty = { onClearProperty(property) },
                )
                HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
            }
        }
    }
}

/** Shared with [AudioPanel] for the Volume row, the one audio property that keyframes. */
@Composable
internal fun PropertyRow(
    property: AnimatableProperty,
    clip: Clip,
    playhead: Ticks,
    onValueChange: (Float) -> Unit,
    onValueChangeFinished: () -> Unit,
    onToggleKeyframe: () -> Unit,
    onClearProperty: () -> Unit,
) {
    val state = clip.keyframeState(property, playhead)
    val value = clip.currentValue(property, playhead)

    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        ApexSlider(
            label = property.displayName,
            explanation = property.explanation,
            value = value,
            onValueChange = onValueChange,
            onValueChangeFinished = onValueChangeFinished,
            valueRange = property.minValue..property.maxValue,
            valueLabel = { property.format(it) },
            modifier = Modifier.weight(1f),
        )

        ApexToolButton(
            icon = if (state == KeyframeState.NONE) {
                Icons.Outlined.Diamond
            } else {
                Icons.Filled.Diamond
            },
            label = when (state) {
                KeyframeState.NONE -> "Animate"
                KeyframeState.ON_KEYFRAME -> "Remove"
                KeyframeState.BETWEEN -> "Add"
            },
            tooltip = when (state) {
                KeyframeState.NONE ->
                    "Animate ${property.displayName} — Adds an animation point here so this " +
                        "setting can change over time. Move the playhead and change the value " +
                        "to add the next point."
                KeyframeState.ON_KEYFRAME ->
                    "Remove Animation Point — There is an animation point for " +
                        "${property.displayName} exactly here. Removing it changes how the " +
                        "animation moves through this moment."
                KeyframeState.BETWEEN ->
                    "Add Animation Point — Adds a point for ${property.displayName} at the " +
                        "playhead, holding the value it already has, so you can change what " +
                        "happens after it without disturbing what came before."
            },
            description = when (state) {
                KeyframeState.NONE ->
                    "Start animating ${property.displayName} by adding an animation point at " +
                        "the current playhead position."
                KeyframeState.ON_KEYFRAME ->
                    "Remove the ${property.displayName} animation point at the current playhead " +
                        "position. The animation continues between the remaining points."
                KeyframeState.BETWEEN ->
                    "Add a ${property.displayName} animation point at the current playhead, " +
                        "holding its current animated value."
            },
            selected = state != KeyframeState.NONE,
            onClick = onToggleKeyframe,
        )

        if (state != KeyframeState.NONE) {
            ApexToolButton(
                icon = Icons.Filled.Delete,
                label = "Stop",
                tooltip = "Stop Animating — Removes every animation point for " +
                    "${property.displayName} and holds it at one steady value again.",
                description = "Remove all animation from ${property.displayName}. The setting " +
                    "returns to a single fixed value for the whole clip.",
                onClick = onClearProperty,
            )
        }
    }
}

/** What the diamond should look like, and what tapping it will do. */
enum class KeyframeState { NONE, ON_KEYFRAME, BETWEEN }

private fun Clip.keyframeState(property: AnimatableProperty, playhead: Ticks): KeyframeState {
    val track = track(property)
    if (track.isEmpty) return KeyframeState.NONE
    val timeInClip = (playhead - timelineStart).coerceAtLeast(Ticks.ZERO)
    // Exact match rather than a tolerance: the playhead is frame-snapped and so
    // are keyframes, so "on a keyframe" is unambiguous.
    return if (track.keyframeAt(timeInClip) != null) {
        KeyframeState.ON_KEYFRAME
    } else {
        KeyframeState.BETWEEN
    }
}

private fun Clip.currentValue(property: AnimatableProperty, playhead: Ticks): Float =
    valueAt(property, playhead)

/** Formats a value the way an editor expects to read it, per property. */
private fun AnimatableProperty.format(value: Float): String = when (this) {
    AnimatableProperty.POSITION_X, AnimatableProperty.POSITION_Y ->
        "${value.roundToInt()} px"
    AnimatableProperty.SCALE_X, AnimatableProperty.SCALE_Y ->
        "${(value * 100).roundToInt()}%"
    AnimatableProperty.ROTATION ->
        "${value.roundToInt()}°"
    AnimatableProperty.OPACITY ->
        "${(value * 100).roundToInt()}%"
    AnimatableProperty.VOLUME ->
        "${(value * 100).roundToInt()}%"
    AnimatableProperty.EXPOSURE ->
        (if (value >= 0f) "+" else "") + "${(value * 100).roundToInt() / 100f} EV"
    AnimatableProperty.CONTRAST, AnimatableProperty.TEMPERATURE, AnimatableProperty.TINT ->
        (if (value > 0f) "+" else "") + "${(value * 100).roundToInt()}"
    AnimatableProperty.SATURATION ->
        "${(value * 100).roundToInt()}%"
}

/** The properties the Transform panel offers, in the order editors expect them. */
private val TRANSFORM_PROPERTIES = listOf(
    AnimatableProperty.POSITION_X,
    AnimatableProperty.POSITION_Y,
    AnimatableProperty.SCALE_X,
    AnimatableProperty.SCALE_Y,
    AnimatableProperty.ROTATION,
    AnimatableProperty.OPACITY,
)

/** Leaves 40% of the screen for the preview, per the PRD's panel rule. */
private const val PANEL_MAX_FRACTION = 0.6f
