package com.apexedits.feature.export

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.apexedits.core.designsystem.ApexPanelHeader
import com.apexedits.core.designsystem.ApexScaffold
import com.apexedits.core.designsystem.overflowSentinel
import com.apexedits.core.device.PerformancePolicy
import com.apexedits.core.model.Ticks

/**
 * The export screen.
 *
 * Presets first, explained in terms of where the video is going. The estimate is
 * labelled as an estimate. If the chosen preset exceeds what the device should
 * be asked to do, the warning appears inline with a one-tap safer alternative —
 * rather than as a modal that has to be dismissed before the user can see what
 * they were choosing between.
 */
@Composable
fun ExportScreen(
    viewModel: ExportViewModel,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var selected by remember { mutableStateOf(ExportPreset.TIKTOK_REELS_SHORTS) }

    val settings = selected.toSettings()
    val policy = state.policy
    val exceedsDevice = policy != null && settings.exceeds(policy)

    ApexScaffold(tag = "ExportScreen", modifier = modifier) { _, _ ->
        Column(modifier = Modifier.fillMaxSize()) {
            ApexPanelHeader(
                title = "Export Video",
                purpose = "Choose where this video is going. ApexEdits picks the right size and " +
                    "quality, then saves the finished file to your device.",
            )

            LazyColumn(
                modifier = Modifier.fillMaxWidth().weight(1f).overflowSentinel("ExportOptions"),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(ExportPreset.entries) { preset ->
                    PresetCard(
                        preset = preset,
                        selected = preset == selected,
                        duration = state.duration,
                        policy = policy,
                        onSelect = { selected = preset },
                    )
                }

                if (exceedsDevice && policy != null) {
                    item {
                        DeviceWarningCard(
                            settings = settings,
                            policy = policy,
                            onUseSafer = {
                                // No matching preset: switch to the nearest one
                                // the device can actually sustain.
                                selected = ExportPreset.entries
                                    .filter { it.longestEdge <= policy.exportMaxDimension }
                                    .maxByOrNull { it.longestEdge }
                                    ?: ExportPreset.SMALL_FILE
                            },
                        )
                    }
                }
            }

            when (val progress = state.progress) {
                is ExportProgress.Running -> ExportProgressBar(progress.percent, viewModel::cancel)
                is ExportProgress.Preparing -> ExportProgressBar(0, viewModel::cancel)
                is ExportProgress.Complete -> CompletionRow(progress, onDone)
                is ExportProgress.Failed -> MessageRow(progress.message)
                is ExportProgress.Cancelled -> MessageRow("Export cancelled. Nothing was saved.")
                null -> StartRow(
                    settings = settings,
                    duration = state.duration,
                    onStart = { viewModel.start(settings) },
                )
            }
        }
    }
}

@Composable
private fun PresetCard(
    preset: ExportPreset,
    selected: Boolean,
    duration: Ticks,
    policy: PerformancePolicy?,
    onSelect: () -> Unit,
) {
    val settings = preset.toSettings()
    val size = formatBytes(settings.estimatedBytes(duration))
    val tooHeavy = policy != null && settings.exceeds(policy)

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onSelect)
            .semantics {
                contentDescription = buildString {
                    append(preset.displayName).append(". ").append(preset.explanation)
                    append(" Estimated size about ").append(size).append(".")
                    if (tooHeavy) append(" This device may struggle with this setting.")
                    if (selected) append(" Selected.")
                }
            },
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(
                text = preset.displayName,
                style = MaterialTheme.typography.titleMedium,
                color = if (selected) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
            )
            Text(
                text = preset.explanation,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                // "About" is doing real work here: compressibility varies enough
                // that a precise-looking figure would be a lie.
                text = "About $size",
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

@Composable
private fun DeviceWarningCard(
    settings: ExportSettings,
    policy: PerformancePolicy,
    onUseSafer: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(
                text = "This device may struggle with that setting",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.error,
            )
            Text(
                text = "Exporting at ${settings.width} × ${settings.height} on this device may be " +
                    "slow, make it hot, or fail part way through. Exporting at " +
                    "${policy.exportMaxDimension}p instead is much more reliable and looks nearly " +
                    "identical on a phone screen.",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 4.dp),
            )
            Row(modifier = Modifier.padding(top = 8.dp)) {
                TextButton(onClick = onUseSafer) { Text("Use safer settings") }
                // Nothing here blocks the user; the PRD is explicit that
                // "Continue Anyway" always remains available. Leaving the
                // preset selected *is* continuing anyway.
            }
        }
    }
}

@Composable
private fun StartRow(settings: ExportSettings, duration: Ticks, onStart: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "${settings.width} × ${settings.height} · ${settings.codec.displayName}",
                style = MaterialTheme.typography.labelMedium,
            )
            Text(
                text = "About ${formatBytes(settings.estimatedBytes(duration))}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Button(
            onClick = onStart,
            modifier = Modifier.semantics {
                contentDescription = "Start Export. Renders your project and saves the finished " +
                    "video to your device gallery. You can keep using your phone while it runs."
            },
        ) { Text("Start Export") }
    }
}

@Composable
private fun ExportProgressBar(percent: Int, onCancel: () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
        Text(
            text = if (percent > 0) "Exporting — $percent% complete" else "Preparing export…",
            style = MaterialTheme.typography.labelLarge,
        )
        Text(
            text = "You can leave this screen or use other apps. ApexEdits keeps working in the " +
                "background and will notify you when it is done.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 4.dp),
        )
        LinearProgressIndicator(
            progress = { percent / 100f },
            modifier = Modifier.fillMaxWidth().semantics {
                contentDescription = "Export progress, $percent percent complete."
            },
        )
        TextButton(onClick = onCancel, modifier = Modifier.padding(top = 4.dp)) {
            Text("Cancel export")
        }
    }
}

@Composable
private fun CompletionRow(progress: ExportProgress.Complete, onDone: () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
        Text(text = "Export complete", style = MaterialTheme.typography.titleSmall)
        Text(
            text = "Your video has been saved to your gallery in the ApexEdits folder " +
                "(${formatBytes(progress.sizeBytes)}).",
            style = MaterialTheme.typography.bodySmall,
        )
        Button(onClick = onDone, modifier = Modifier.padding(top = 8.dp)) { Text("Done") }
    }
}

@Composable
private fun MessageRow(message: String) {
    Text(
        text = message,
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.fillMaxWidth().padding(16.dp),
    )
}

private fun formatBytes(bytes: Long): String = when {
    bytes >= 1_000_000_000 -> "%.1f GB".format(bytes / 1_000_000_000.0)
    bytes >= 1_000_000 -> "%.0f MB".format(bytes / 1_000_000.0)
    bytes >= 1_000 -> "%.0f KB".format(bytes / 1_000.0)
    else -> "$bytes bytes"
}
