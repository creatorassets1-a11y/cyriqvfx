package com.apexedits.feature.editor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.apexedits.core.designsystem.ApexPanelHeader
import com.apexedits.core.designsystem.ApexSlider
import com.apexedits.core.designsystem.overflowSentinel
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.Clip
import com.apexedits.core.model.Ticks
import kotlin.math.roundToInt

/**
 * The Audio panel: volume, balance, and fades for the selected clip.
 *
 * Volume reuses [PropertyRow] from the Transform panel because it is a real
 * [AnimatableProperty] — the same slider-writes-a-keyframe-when-animated
 * behaviour applies here as everywhere else a property is edited. Pan and the
 * two fades are plain clip fields rather than animatable properties: a
 * left/right balance or a fade shape is not something an editor keyframes
 * mid-clip, so they get ordinary sliders with no diamond.
 */
@Composable
fun AudioPanel(
    clip: Clip,
    playhead: Ticks,
    maxHeight: Dp,
    onVolumeChange: (Float) -> Unit,
    onVolumeChangeFinished: () -> Unit,
    onToggleVolumeKeyframe: () -> Unit,
    onClearVolumeAnimation: () -> Unit,
    onPanChange: (Float) -> Unit,
    onPanChangeFinished: () -> Unit,
    onFadeInChange: (Ticks) -> Unit,
    onFadeOutChange: (Ticks) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            // Same 40%-for-the-preview rule the Transform panel follows.
            .heightIn(max = maxHeight * PANEL_MAX_FRACTION)
            .overflowSentinel("AudioPanel"),
    ) {
        ApexPanelHeader(
            title = "Audio",
            purpose = "Adjust this clip's volume, left/right balance, and fade in or out of " +
                "silence.",
        )

        LazyColumn(
            modifier = Modifier.fillMaxWidth().weight(1f, fill = false),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            item {
                PropertyRow(
                    property = AnimatableProperty.VOLUME,
                    clip = clip,
                    playhead = playhead,
                    onValueChange = onVolumeChange,
                    onValueChangeFinished = onVolumeChangeFinished,
                    onToggleKeyframe = onToggleVolumeKeyframe,
                    onClearProperty = onClearVolumeAnimation,
                )
                HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
            }
            item {
                ApexSlider(
                    label = "Balance",
                    explanation = "Shifts the sound toward the left or right speaker. Centred " +
                        "plays evenly in both.",
                    value = clip.pan,
                    onValueChange = onPanChange,
                    onValueChangeFinished = onPanChangeFinished,
                    valueRange = -1f..1f,
                    valueLabel = { it.balanceLabel() },
                )
                HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
            }
            item {
                FadeRow(
                    label = "Fade In",
                    explanation = "Rises from silence at the start of the clip over this many " +
                        "seconds.",
                    duration = clip.fadeInDuration,
                    maxDuration = clip.timelineDuration,
                    onChange = onFadeInChange,
                )
                HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
            }
            item {
                FadeRow(
                    label = "Fade Out",
                    explanation = "Sinks to silence at the end of the clip over this many " +
                        "seconds.",
                    duration = clip.fadeOutDuration,
                    maxDuration = clip.timelineDuration,
                    onChange = onFadeOutChange,
                )
            }
        }
    }
}

@Composable
private fun FadeRow(
    label: String,
    explanation: String,
    duration: Ticks,
    maxDuration: Ticks,
    onChange: (Ticks) -> Unit,
) {
    val maxSeconds = maxDuration.toSeconds().toFloat().coerceAtLeast(0.01f)
    ApexSlider(
        label = label,
        explanation = explanation,
        value = duration.toSeconds().toFloat().coerceIn(0f, maxSeconds),
        onValueChange = { onChange(Ticks.ofSeconds(it.toDouble())) },
        valueRange = 0f..maxSeconds,
        valueLabel = { "${((it * 10).roundToInt()) / 10f} s" },
    )
}

private fun Float.balanceLabel(): String = when {
    this < -0.01f -> "${(-this * 100).roundToInt()}% Left"
    this > 0.01f -> "${(this * 100).roundToInt()}% Right"
    else -> "Centre"
}

/** Leaves 40% of the screen for the preview, matching the Transform panel. */
private const val PANEL_MAX_FRACTION = 0.6f
