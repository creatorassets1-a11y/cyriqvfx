package com.apexedits.feature.editor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.apexedits.core.designsystem.ApexPanelHeader
import com.apexedits.core.designsystem.overflowSentinel
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.Clip
import com.apexedits.core.model.Ticks

/**
 * The Colour panel: basic correction for the selected clip.
 *
 * Every control here reuses [PropertyRow] from the Transform panel, because
 * exposure, contrast, saturation, temperature, and tint are real
 * [AnimatableProperty] entries — a grade that shifts over a clip (a sunrise
 * warming up, a flash pushing exposure) is a real editing move, so these get
 * the same slider-writes-a-keyframe-when-animated behaviour and diamond as
 * every other animatable property, not a simplified one-off control.
 */
@Composable
fun ColorPanel(
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
            .heightIn(max = maxHeight * PANEL_MAX_FRACTION)
            .overflowSentinel("ColorPanel"),
    ) {
        ApexPanelHeader(
            title = "Colour",
            purpose = "Correct the exposure, contrast, and colour of the selected clip. Tap a " +
                "diamond to animate a setting so it changes over time.",
        )

        LazyColumn(
            modifier = Modifier.fillMaxWidth().weight(1f, fill = false),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(COLOR_PROPERTIES) { property ->
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

/** In the order editors expect: brightness first, colour last. */
private val COLOR_PROPERTIES = listOf(
    AnimatableProperty.EXPOSURE,
    AnimatableProperty.CONTRAST,
    AnimatableProperty.SATURATION,
    AnimatableProperty.TEMPERATURE,
    AnimatableProperty.TINT,
)

private const val PANEL_MAX_FRACTION = 0.6f
