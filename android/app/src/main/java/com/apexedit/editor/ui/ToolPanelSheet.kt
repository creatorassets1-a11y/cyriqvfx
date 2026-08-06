package com.apexedit.editor.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import com.apexedit.editor.core.*
import com.apexedit.editor.media.Exporter
import com.apexedit.editor.vm.EditorUiState
import com.apexedit.editor.vm.EditorViewModel
import com.apexedit.editor.vm.Panel

/**
 * Contextual tool panels.
 *
 * Anchored to the bottom, capped at a fraction of the screen and scrolling
 * internally, so a panel with many controls can never push the timeline or the
 * preview off — no matter how small the device or how large the user's font
 * scale.
 */
@UnstableApi
@Composable
fun ToolPanelSheet(vm: EditorViewModel, ui: EditorUiState, onDismiss: () -> Unit) {
    val clip = ui.selectedClip
    val title = when (ui.panel) {
        Panel.TRANSFORM -> "Layout"
        Panel.SPEED -> "Speed"
        Panel.COLOR -> "Adjust"
        Panel.AUDIO -> "Audio"
        Panel.TEXT -> "Text"
        Panel.TRANSITION -> "Transition"
        Panel.EXPORT -> "Export"
        Panel.NONE -> ""
    }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
        Surface(
            color = ApexColors.Panel,
            shape = RoundedCornerShape(topStart = Dimens.RadiusL, topEnd = Dimens.RadiusL),
            tonalElevation = 8.dp,
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(Dimens.PanelMaxHeightFraction),
        ) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(Dimens.TouchMin)
                        .padding(start = Dimens.SpaceL, end = Dimens.SpaceS),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        title,
                        style = MaterialTheme.typography.titleSmall,
                        color = ApexColors.TextPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, "Close", tint = ApexColors.TextSecondary)
                    }
                }
                HorizontalDivider(color = ApexColors.Border)

                Column(
                    Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = Dimens.SpaceL, vertical = Dimens.SpaceM),
                ) {
                    when (ui.panel) {
                        Panel.EXPORT -> ExportPanel(vm, ui)
                        Panel.NONE -> Unit
                        else -> if (clip == null) {
                            EmptyPanel()
                        } else {
                            when (ui.panel) {
                                Panel.TRANSFORM -> TransformPanel(vm, clip)
                                Panel.SPEED -> SpeedPanel(vm, clip)
                                Panel.COLOR -> ColorPanel(vm, clip)
                                Panel.AUDIO -> AudioPanel(vm, clip)
                                Panel.TRANSITION -> TransitionPanel(vm, clip)
                                else -> Unit
                            }
                        }
                    }
                    Spacer(Modifier.height(Dimens.SpaceXl))
                }
            }
        }
    }
}

@Composable
private fun EmptyPanel() {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = Dimens.SpaceXl),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Nothing selected", color = ApexColors.TextPrimary, style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(Dimens.SpaceXs))
        Text(
            "Tap a clip on the timeline first.",
            color = ApexColors.TextTertiary,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

@UnstableApi
@Composable
private fun TransformPanel(vm: EditorViewModel, clip: Clip) {
    val t = clip.transform
    ParamSlider("Scale", t.scale, 0.1f, 4f, "${(t.scale * 100).toInt()}%") {
        vm.setTransform(clip.id, t.copy(scale = it), "scale")
    }
    ParamSlider("Position X", t.x, -1f, 1f, format(t.x)) {
        vm.setTransform(clip.id, t.copy(x = it), "posx")
    }
    ParamSlider("Position Y", t.y, -1f, 1f, format(t.y)) {
        vm.setTransform(clip.id, t.copy(y = it), "posy")
    }
    ParamSlider("Rotation", t.rotationDegrees, -180f, 180f, "${t.rotationDegrees.toInt()}°") {
        vm.setTransform(clip.id, t.copy(rotationDegrees = it), "rot")
    }
    ParamSlider("Opacity", t.opacity, 0f, 1f, "${(t.opacity * 100).toInt()}%") {
        vm.setTransform(clip.id, t.copy(opacity = it), "opacity")
    }

    Spacer(Modifier.height(Dimens.SpaceS))
    Row(horizontalArrangement = Arrangement.spacedBy(Dimens.SpaceS)) {
        PanelButton("Flip H", Modifier.weight(1f)) {
            vm.setTransform(clip.id, t.copy(flipH = !t.flipH))
        }
        PanelButton("Flip V", Modifier.weight(1f)) {
            vm.setTransform(clip.id, t.copy(flipV = !t.flipV))
        }
        PanelButton("Reset", Modifier.weight(1f)) {
            vm.setTransform(clip.id, Transform())
        }
    }
}

@UnstableApi
@Composable
private fun SpeedPanel(vm: EditorViewModel, clip: Clip) {
    ParamSlider("Speed", clip.speed, MIN_SPEED, 10f, "${"%.2f".format(clip.speed)}×") {
        vm.setSpeed(clip.id, it)
    }
    Spacer(Modifier.height(Dimens.SpaceS))
    Row(horizontalArrangement = Arrangement.spacedBy(Dimens.SpaceS)) {
        listOf(0.25f, 0.5f, 1f, 2f, 4f).forEach { preset ->
            PanelButton("${trimFloat(preset)}×", Modifier.weight(1f), active = clip.speed == preset) {
                vm.setSpeed(clip.id, preset)
            }
        }
    }
    Spacer(Modifier.height(Dimens.SpaceM))
    PanelButton(if (clip.reversed) "Reversed" else "Reverse", active = clip.reversed) {
        vm.reverse(clip.id)
    }
    Spacer(Modifier.height(Dimens.SpaceS))
    Text(
        "Slowing a clip makes it longer and speeding it up makes it shorter — it keeps showing the same footage.",
        style = MaterialTheme.typography.bodySmall,
        color = ApexColors.TextTertiary,
    )
}

@UnstableApi
@Composable
private fun ColorPanel(vm: EditorViewModel, clip: Clip) {
    val g = clip.grade
    ParamSlider("Exposure", g.exposure, -3f, 3f, "${format(g.exposure)} EV") {
        vm.setGrade(clip.id, g.copy(exposure = it), "exposure")
    }
    ParamSlider("Contrast", g.contrast, -1f, 1f, format(g.contrast)) {
        vm.setGrade(clip.id, g.copy(contrast = it), "contrast")
    }
    ParamSlider("Saturation", g.saturation, -1f, 1f, format(g.saturation)) {
        vm.setGrade(clip.id, g.copy(saturation = it), "sat")
    }
    ParamSlider("Temperature", g.temperature, -1f, 1f, format(g.temperature)) {
        vm.setGrade(clip.id, g.copy(temperature = it), "temp")
    }
    ParamSlider("Tint", g.tint, -1f, 1f, format(g.tint)) {
        vm.setGrade(clip.id, g.copy(tint = it), "tint")
    }
    ParamSlider("Highlights", g.highlights, -1f, 1f, format(g.highlights)) {
        vm.setGrade(clip.id, g.copy(highlights = it), "high")
    }
    ParamSlider("Shadows", g.shadows, -1f, 1f, format(g.shadows)) {
        vm.setGrade(clip.id, g.copy(shadows = it), "shadow")
    }
    ParamSlider("Vibrance", g.vibrance, -1f, 1f, format(g.vibrance)) {
        vm.setGrade(clip.id, g.copy(vibrance = it), "vib")
    }
    ParamSlider("Fade", g.fade, 0f, 1f, format(g.fade)) {
        vm.setGrade(clip.id, g.copy(fade = it), "fade")
    }
    ParamSlider("Vignette", g.vignette, 0f, 1f, format(g.vignette)) {
        vm.setGrade(clip.id, g.copy(vignette = it), "vig")
    }
    ParamSlider("Grain", g.grain, 0f, 1f, format(g.grain)) {
        vm.setGrade(clip.id, g.copy(grain = it), "grain")
    }

    Spacer(Modifier.height(Dimens.SpaceM))
    PanelButton("Reset all") { vm.setGrade(clip.id, Grade.NEUTRAL) }
}

@UnstableApi
@Composable
private fun AudioPanel(vm: EditorViewModel, clip: Clip) {
    val a = clip.audio
    ParamSlider("Volume", a.volumeDb, -60f, 12f, if (a.volumeDb <= -60f) "Silent" else "${format(a.volumeDb)} dB") {
        vm.setAudio(clip.id, a.copy(volumeDb = it), "vol")
    }
    ParamSlider(
        "Fade in",
        Time.ticksToSeconds(a.fadeInTicks).toFloat(),
        0f,
        5f,
        "${"%.1f".format(Time.ticksToSeconds(a.fadeInTicks))}s",
    ) {
        vm.setAudio(clip.id, a.copy(fadeInTicks = Time.secondsToTicks(it.toDouble())), "fadein")
    }
    ParamSlider(
        "Fade out",
        Time.ticksToSeconds(a.fadeOutTicks).toFloat(),
        0f,
        5f,
        "${"%.1f".format(Time.ticksToSeconds(a.fadeOutTicks))}s",
    ) {
        vm.setAudio(clip.id, a.copy(fadeOutTicks = Time.secondsToTicks(it.toDouble())), "fadeout")
    }
    ParamSlider("Pitch", a.pitchSemitones, -12f, 12f, "${a.pitchSemitones.toInt()} st") {
        vm.setAudio(clip.id, a.copy(pitchSemitones = it), "pitch")
    }

    Spacer(Modifier.height(Dimens.SpaceM))
    Row(horizontalArrangement = Arrangement.spacedBy(Dimens.SpaceS)) {
        PanelButton(if (a.muted) "Unmute" else "Mute", Modifier.weight(1f), active = a.muted) {
            vm.setAudio(clip.id, a.copy(muted = !a.muted))
        }
        PanelButton("Detach", Modifier.weight(1f)) { vm.detachAudio(clip.id) }
    }
}

@UnstableApi
@Composable
private fun TransitionPanel(vm: EditorViewModel, clip: Clip) {
    val current = clip.transitionIn?.type ?: TransitionType.NONE
    val duration = clip.transitionIn?.durationTicks ?: Time.secondsToTicks(0.5)

    Text(
        "Applies to the cut before this clip.",
        style = MaterialTheme.typography.bodySmall,
        color = ApexColors.TextTertiary,
    )
    Spacer(Modifier.height(Dimens.SpaceM))

    TransitionType.entries.chunked(2).forEach { row ->
        Row(
            Modifier.padding(bottom = Dimens.SpaceS),
            horizontalArrangement = Arrangement.spacedBy(Dimens.SpaceS),
        ) {
            row.forEach { type ->
                PanelButton(
                    label = type.name.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() },
                    modifier = Modifier.weight(1f),
                    active = current == type,
                ) { vm.setTransition(clip.id, type, duration) }
            }
            if (row.size == 1) Spacer(Modifier.weight(1f))
        }
    }

    if (current != TransitionType.NONE) {
        ParamSlider(
            "Duration",
            Time.ticksToSeconds(duration).toFloat(),
            0.1f,
            3f,
            "${"%.1f".format(Time.ticksToSeconds(duration))}s",
        ) {
            vm.setTransition(clip.id, current, Time.secondsToTicks(it.toDouble()))
        }
    }
}

@UnstableApi
@Composable
private fun ExportPanel(vm: EditorViewModel, ui: EditorUiState) {
    var selected by remember { mutableStateOf(Exporter.PRESETS[1]) }
    val busy = ui.exportProgress != null

    Text("Quality", style = MaterialTheme.typography.labelMedium, color = ApexColors.TextSecondary)
    Spacer(Modifier.height(Dimens.SpaceS))
    Row(horizontalArrangement = Arrangement.spacedBy(Dimens.SpaceS)) {
        Exporter.PRESETS.forEach { preset ->
            PanelButton(preset.label, Modifier.weight(1f), active = preset.id == selected.id) {
                selected = preset
            }
        }
    }
    Spacer(Modifier.height(Dimens.SpaceXs))
    Text(selected.detail, style = MaterialTheme.typography.bodySmall, color = ApexColors.TextTertiary)

    Spacer(Modifier.height(Dimens.SpaceL))
    SummaryRow("Length", ui.doc.duration.formatDuration(tenths = true))
    SummaryRow("Frame rate", "${ui.doc.settings.frameRate.fps.let { Math.round(it * 100) / 100.0 }} fps")
    SummaryRow("Aspect", ui.doc.settings.aspect.label)
    SummaryRow("Estimated size", formatBytes(Exporter.estimateBytes(ui.doc, selected)))

    Spacer(Modifier.height(Dimens.SpaceL))
    Button(
        onClick = { vm.export(selected) },
        enabled = !busy && ui.doc.duration > 0,
        colors = ButtonDefaults.buttonColors(
            containerColor = ApexColors.Accent,
            contentColor = ApexColors.OnAccent,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = Dimens.TouchMin),
    ) {
        Text(if (busy) "Exporting…" else "Export to gallery", maxLines = 1)
    }
}

@Composable
private fun SummaryRow(label: String, value: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = ApexColors.TextSecondary, maxLines = 1)
        Text(
            value,
            style = MaterialTheme.typography.bodySmall,
            color = ApexColors.TextPrimary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

// ---------------------------------------------------------------------------
// Shared controls
// ---------------------------------------------------------------------------

/**
 * A labelled slider.
 *
 * The value is shown as text as well as by thumb position: on a phone your own
 * thumb covers the track while you drag, so a number that only exists as a
 * position is a number you cannot read while setting it.
 */
@Composable
private fun ParamSlider(
    label: String,
    value: Float,
    min: Float,
    max: Float,
    display: String,
    onChange: (Float) -> Unit,
) {
    Column(Modifier.padding(bottom = Dimens.SpaceS)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                label,
                style = MaterialTheme.typography.bodySmall,
                color = ApexColors.TextSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text(
                display,
                style = MaterialTheme.typography.labelSmall,
                color = ApexColors.Accent,
                maxLines = 1,
            )
        }
        Slider(
            value = value.coerceIn(min, max),
            onValueChange = onChange,
            valueRange = min..max,
            colors = SliderDefaults.colors(
                thumbColor = ApexColors.TextPrimary,
                activeTrackColor = ApexColors.Accent,
                inactiveTrackColor = ApexColors.Hover,
            ),
        )
    }
}

@Composable
private fun PanelButton(
    label: String,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .heightIn(min = 44.dp)
            .clip(RoundedCornerShape(Dimens.RadiusM))
            .background(if (active) ApexColors.Accent.copy(alpha = 0.2f) else ApexColors.Raised)
            .clickableNoRipple(onClick)
            .padding(horizontal = Dimens.SpaceM, vertical = Dimens.SpaceS),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = if (active) ApexColors.Accent else ApexColors.TextPrimary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private fun format(v: Float): String =
    if (v == v.toInt().toFloat()) v.toInt().toString() else "%.2f".format(v)

private fun trimFloat(v: Float): String =
    if (v == v.toInt().toFloat()) v.toInt().toString() else v.toString()

private fun formatBytes(bytes: Long): String = when {
    bytes < 1024L * 1024 -> "${bytes / 1024} KB"
    bytes < 1024L * 1024 * 1024 -> "%.1f MB".format(bytes / (1024.0 * 1024))
    else -> "%.2f GB".format(bytes / (1024.0 * 1024 * 1024))
}
