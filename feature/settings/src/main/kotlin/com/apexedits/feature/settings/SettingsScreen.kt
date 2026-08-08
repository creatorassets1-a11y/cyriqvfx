package com.apexedits.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.apexedits.core.data.ProjectStore
import com.apexedits.core.designsystem.ApexPanelHeader
import com.apexedits.core.designsystem.ApexScaffold
import com.apexedits.core.designsystem.ApexToggle
import com.apexedits.core.designsystem.ApexToolButton
import com.apexedits.core.designsystem.overflowSentinel

/**
 * Settings.
 *
 * The PRD groups this as Performance, Storage, Accessibility/theme, and About.
 * Each is its own card with a header explaining what it contains, per the panel
 * rule the rest of the app follows — a Settings screen is not exempt from the
 * self-explanatory-everything requirement just because it is administrative.
 */
@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    ApexScaffold(tag = "SettingsScreen", modifier = modifier) { _, _ ->
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ApexToolButton(
                    icon = Icons.AutoMirrored.Filled.ArrowBack,
                    label = "Back",
                    tooltip = "Back — Returns to your project.",
                    description = "Return to the previous screen.",
                    onClick = onBack,
                )
                Text(
                    text = "Settings",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }

            LazyColumn(
                modifier = Modifier.fillMaxWidth().weight(1f).overflowSentinel("SettingsList"),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                item { PerformanceSection(state, viewModel::setAlwaysUseFullQuality, viewModel::resetWarnings) }
                item { StorageSection(state, viewModel::clearAllCaches) }
                item { AboutSection() }
                item { LicencesSection() }
            }
        }
    }

    LaunchedEffect(state.message) {
        if (state.message != null) viewModel.clearMessage()
    }
}

@Composable
private fun PerformanceSection(
    state: SettingsUiState,
    onSetAlwaysFullQuality: (Boolean) -> Unit,
    onResetWarnings: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(bottom = 12.dp)) {
            ApexPanelHeader(
                title = "Performance",
                purpose = "See how ApexEdits has classified this device, and control the " +
                    "warnings it shows before demanding operations.",
            )
            state.deviceProfile?.let { profile ->
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text(
                        text = "${profile.deviceClass.displayName} device",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        text = profile.deviceClass.explanation,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
            ApexToggle(
                label = "Always Use Full Quality",
                onExplanation = "Preview and export always run at this device's highest " +
                    "quality, even where ApexEdits would normally suggest lowering it. You may " +
                    "see more lag, heat, or crashes on a limited device.",
                offExplanation = "ApexEdits automatically lowers preview and export quality on " +
                    "limited devices to stay smooth and reliable.",
                checked = state.alwaysUseFullQuality,
                onCheckedChange = onSetAlwaysFullQuality,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            Row(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                TextButton(onClick = onResetWarnings) {
                    Text("Show Low-Resource Warnings Again")
                }
            }
        }
    }
}

@Composable
private fun StorageSection(state: SettingsUiState, onClearCaches: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(bottom = 12.dp)) {
            ApexPanelHeader(
                title = "Storage",
                purpose = "See how much space your projects use, and clear cached previews " +
                    "without touching your footage or edits.",
            )
            if (state.isLoadingStorage) {
                Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.Center) {
                    CircularProgressIndicator()
                }
            } else {
                state.storage?.let { storage ->
                    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                        StorageRow("Your videos, photos, and audio", storage.mediaBytes)
                        StorageRow("Project files", storage.documentsBytes)
                        StorageRow("Cached preview proxies", storage.proxyBytes)
                        StorageRow("Cached thumbnails", storage.thumbnailBytes)
                        HorizontalDivider(modifier = Modifier.padding(vertical = 6.dp))
                        StorageRow("Total", storage.totalBytes, emphasise = true)
                    }
                }
            }
            Row(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                TextButton(onClick = onClearCaches) { Text("Clear Cached Previews") }
            }
        }
    }
}

@Composable
private fun StorageRow(label: String, bytes: Long, emphasise: Boolean = false) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(
            text = label,
            style = if (emphasise) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium,
        )
        Text(
            text = formatBytes(bytes),
            style = if (emphasise) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun AboutSection() {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(bottom = 12.dp)) {
            ApexPanelHeader(
                title = "About ApexEdits",
                purpose = "Free, offline-first, and private by construction.",
            )
            Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text(
                    text = "Your videos and audio stay on your device. ApexEdits does not upload " +
                        "your media, and the app has no permission to access the internet at all.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    text = "No ads. No account required. No in-app purchases. Free forever.",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun LicencesSection() {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(bottom = 12.dp)) {
            ApexPanelHeader(
                title = "Open-Source Licences",
                purpose = "ApexEdits is built on open-source software. Every component and its " +
                    "licence, as required by their terms.",
            )
            LicenceList()
        }
    }
}

@Composable
private fun LicenceList() {
    // A plain Column, not another LazyColumn: nesting scrollables here would need
    // a fixed height picked out of nowhere, and the list is short enough that it
    // scrolls fine as part of the outer Settings list.
    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
        LICENCE_ENTRIES.forEach { entry ->
            Column(modifier = Modifier.padding(vertical = 6.dp)) {
                Text(text = entry.component, style = MaterialTheme.typography.labelLarge)
                Text(
                    text = entry.licence,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private data class LicenceEntry(val component: String, val licence: String)

/**
 * Mirrors `docs/LICENSES.md`. Kept in-app per PRD §4.6 ("Open-source licenses
 * properly attributed in Settings → Licenses") — a markdown file in the repo
 * satisfies a developer, not a user holding the shipped app.
 */
private val LICENCE_ENTRIES = listOf(
    LicenceEntry("Kotlin, coroutines, kotlinx.serialization", "Apache License 2.0"),
    LicenceEntry("Jetpack Compose, Material 3, Material Icons", "Apache License 2.0"),
    LicenceEntry(
        "AndroidX Media3 (ExoPlayer, Transformer, Effect, UI Compose)",
        "Apache License 2.0",
    ),
    LicenceEntry(
        "Media3's alpha-scale fragment shader (used in ApexEdits' animated opacity effect)",
        "Apache License 2.0 — Copyright 2023 The Android Open Source Project",
    ),
    LicenceEntry("AndroidX Room, DataStore, WorkManager, Lifecycle, Navigation, Core", "Apache License 2.0"),
    LicenceEntry("JUnit 4", "Eclipse Public License 1.0"),
    LicenceEntry("Robolectric (used only to build and test the app)", "MIT License"),
)

private fun formatBytes(bytes: Long): String = when {
    bytes >= 1_000_000_000 -> "%.2f GB".format(bytes / 1_000_000_000.0)
    bytes >= 1_000_000 -> "%.1f MB".format(bytes / 1_000_000.0)
    bytes >= 1_000 -> "%.0f KB".format(bytes / 1_000.0)
    else -> "$bytes bytes"
}
