package com.apexedits.feature.editor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.apexedits.core.designsystem.ApexPanelHeader
import com.apexedits.core.designsystem.ApexSlider
import com.apexedits.core.designsystem.overflowSentinel
import com.apexedits.core.model.Clip
import kotlin.math.roundToInt

/**
 * The Speed panel.
 *
 * Speed is a plain clip field, not an [com.apexedits.core.model.AnimatableProperty] — a
 * clip retiming mid-playback (a ramp) is a real feature some editors offer, but
 * it changes the clip's own timeline duration as it plays, which the keyframe
 * system's clip-relative time model was never built to represent. So this
 * offers one constant speed per clip: a slider for fine control, and presets
 * for the values editors reach for most, matching the fast path every mobile
 * NLE gives this exact control.
 */
@Composable
fun SpeedPanel(
    clip: Clip,
    maxHeight: Dp,
    onSpeedChange: (Float) -> Unit,
    onSpeedChangeFinished: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(max = maxHeight * PANEL_MAX_FRACTION)
            .overflowSentinel("SpeedPanel"),
    ) {
        ApexPanelHeader(
            title = "Speed",
            purpose = "Change how fast or slow this clip plays. The clip's length on the " +
                "timeline changes to match; its sound changes pitch along with it.",
        )

        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            ApexSlider(
                label = "Speed",
                explanation = "Drag for fine control, or tap a preset below for a common speed.",
                value = clip.speed,
                onValueChange = onSpeedChange,
                onValueChangeFinished = onSpeedChangeFinished,
                valueRange = MIN_SLIDER_SPEED..MAX_SLIDER_SPEED,
                valueLabel = { it.speedLabel() },
                modifier = Modifier.padding(horizontal = 16.dp),
            )

            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(SPEED_PRESETS) { preset ->
                    val selected = kotlin.math.abs(clip.speed - preset) < 0.001f
                    FilterChip(
                        selected = selected,
                        onClick = {
                            onSpeedChange(preset)
                            onSpeedChangeFinished()
                        },
                        label = { Text(preset.speedLabel()) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                        ),
                        modifier = Modifier.semantics {
                            contentDescription = "Set speed to ${preset.speedLabel()}." +
                                if (selected) " Currently selected." else ""
                        },
                    )
                }
            }
        }
    }
}

private fun Float.speedLabel(): String {
    val rounded = (this * 100).roundToInt() / 100f
    return if (rounded == rounded.toInt().toFloat()) "${rounded.toInt()}×" else "${rounded}×"
}

/** The PRD's full range is 0.1×–100×; the slider covers the range editors actually drag to. */
private const val MIN_SLIDER_SPEED = 0.1f
private const val MAX_SLIDER_SPEED = 4f

/** Presets in the order editors expect: slow motion, normal, then fast forward. */
private val SPEED_PRESETS = listOf(0.25f, 0.5f, 1f, 1.5f, 2f, 4f)

private const val PANEL_MAX_FRACTION = 0.6f
