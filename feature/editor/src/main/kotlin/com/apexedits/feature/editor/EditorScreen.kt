package com.apexedits.feature.editor

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.apexedits.core.designsystem.ApexScaffold
import com.apexedits.core.designsystem.ApexToolButton
import com.apexedits.core.designsystem.ApexToolRow
import com.apexedits.core.designsystem.overflowSentinel
import com.apexedits.core.model.TrackKind
import com.apexedits.core.model.formatTimecode

/**
 * The editing screen.
 *
 * Assembles the frame from [EditorLayout] with the contextual toolbar the PRD
 * describes: when nothing is selected the tools are about adding to the project;
 * when a clip is selected they are about that clip. Tools that belong to a later
 * phase are shown disabled with a reason rather than hidden, so the shape of the
 * app is honest about what it does and does not do yet.
 */
@Composable
fun EditorScreen(
    viewModel: EditorViewModel,
    onNavigateBack: () -> Unit,
    onExport: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current

    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) return@rememberLauncherForActivityResult
        viewModel.importMedia(result.data.extractUris(), atPlayhead = false)
    }

    ApexScaffold(tag = "EditorScreen", modifier = modifier) { width, height ->
        when {
            state.isLoading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                CircularProgressIndicator()
            }

            state.project == null -> Box(Modifier.fillMaxSize().padding(24.dp), Alignment.Center) {
                Text(
                    text = state.message ?: "This project could not be opened.",
                    style = MaterialTheme.typography.bodyLarge,
                )
            }

            else -> {
                val project = state.project!!
                EditorLayout(
                    availableWidth = width,
                    availableHeight = height,
                    topBar = { m ->
                        EditorTopBar(
                            modifier = m,
                            projectName = project.name,
                            timecode = formatTimecode(state.playhead, project.format.frameRate),
                            duration = formatTimecode(project.duration, project.format.frameRate),
                            canUndo = state.canUndo,
                            canRedo = state.canRedo,
                            undoLabel = state.undoLabel,
                            redoLabel = state.redoLabel,
                            onBack = onNavigateBack,
                            onUndo = viewModel::undo,
                            onRedo = viewModel::redo,
                            onExport = onExport,
                        )
                    },
                    preview = { m -> PreviewPane(modifier = m, project = project) },
                    timeline = { m ->
                        Timeline(
                            modifier = m,
                            project = project,
                            playhead = state.playhead,
                            selectedClipId = state.selectedClipId,
                            onSeek = viewModel::seek,
                            onSelectClip = viewModel::selectClip,
                            onToggleLock = viewModel::setTrackLocked,
                            onToggleMute = viewModel::setTrackMuted,
                        )
                    },
                    toolbar = { m ->
                        ContextualToolbar(
                            modifier = m,
                            hasSelection = state.hasSelection,
                            onImport = { importLauncher.launch(viewModel.importIntent()) },
                            onAddTrack = { viewModel.addTrack(TrackKind.VIDEO) },
                            onSplit = viewModel::splitAtPlayhead,
                            onDelete = viewModel::deleteSelected,
                            onDuplicate = viewModel::duplicateSelected,
                        )
                    },
                )
            }
        }

        // --- dialogs -----------------------------------------------------

        if (state.recoveryAvailable) {
            AlertDialog(
                onDismissRequest = viewModel::declineRecovery,
                title = { Text("Restore last session?") },
                text = {
                    Text(
                        "ApexEdits closed unexpectedly while you were editing. There are newer " +
                            "changes saved automatically that have not been opened yet. Would you " +
                            "like to restore them?",
                    )
                },
                confirmButton = {
                    TextButton(onClick = viewModel::acceptRecovery) { Text("Restore changes") }
                },
                dismissButton = {
                    TextButton(onClick = viewModel::declineRecovery) { Text("Open last saved version") }
                },
            )
        }

        state.warning?.let { warning ->
            AlertDialog(
                onDismissRequest = viewModel::dismissWarning,
                title = { Text(warning.title) },
                text = { Text("${warning.body}\n\n${warning.recommendation}") },
                confirmButton = {
                    TextButton(onClick = viewModel::useSaferSettings) { Text(warning.saferButton) }
                },
                dismissButton = {
                    TextButton(onClick = viewModel::dismissWarningAndContinue) {
                        Text(warning.continueButton)
                    }
                },
            )
        }

        if (state.missingMediaCount > 0) {
            MissingMediaBanner(count = state.missingMediaCount)
        }
    }

    LaunchedEffect(state.message) {
        // Messages are surfaced by the host scaffold's snackbar; clearing here
        // keeps a stale message from reappearing on rotation.
        if (state.message != null) viewModel.clearMessage()
    }
}

@Composable
private fun EditorTopBar(
    modifier: Modifier,
    projectName: String,
    timecode: String,
    duration: String,
    canUndo: Boolean,
    canRedo: Boolean,
    undoLabel: String?,
    redoLabel: String?,
    onBack: () -> Unit,
    onUndo: () -> Unit,
    onRedo: () -> Unit,
    onExport: () -> Unit,
) {
    Row(
        modifier = modifier
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 4.dp, vertical = 2.dp)
            .overflowSentinel("EditorTopBar"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ApexToolButton(
            icon = Icons.AutoMirrored.Filled.ArrowBack,
            label = "Projects",
            tooltip = "Return to Projects — Goes back to your project list. Your work is saved " +
                "automatically.",
            description = "Return to the project list. Any unsaved changes in this project are " +
                "saved automatically before leaving.",
            onClick = onBack,
        )

        Column(modifier = Modifier.weight(1f).padding(horizontal = 4.dp)) {
            Text(
                text = projectName,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "$timecode / $duration",
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                modifier = Modifier.semantics {
                    contentDescription = "Playhead at $timecode of $duration total."
                },
            )
        }

        ApexToolButton(
            icon = Icons.AutoMirrored.Filled.Undo,
            label = "Undo",
            tooltip = undoLabel?.let { "Undo $it — Reverses your last change." }
                ?: "Undo — Reverses your last change. You can undo many steps in a row.",
            description = undoLabel?.let { "Undo $it. This reverses the most recent change." }
                ?: "Undo the most recent change to your project.",
            onClick = onUndo,
            enabled = canUndo,
            disabledReason = "There is nothing to undo yet.",
        )
        ApexToolButton(
            icon = Icons.AutoMirrored.Filled.Redo,
            label = "Redo",
            tooltip = redoLabel?.let { "Redo $it — Puts back the change you just undid." }
                ?: "Redo — Puts back a change you just undid.",
            description = redoLabel?.let { "Redo $it. This puts back the change you just undid." }
                ?: "Redo the change that was most recently undone.",
            onClick = onRedo,
            enabled = canRedo,
            disabledReason = "There is nothing to redo.",
        )
        ApexToolButton(
            icon = Icons.Filled.FileUpload,
            label = "Export",
            tooltip = "Export Video — Turns your timeline into a finished video file saved on " +
                "your device.",
            description = "Open export settings to render your project into a finished video " +
                "file and save it to your device gallery.",
            onClick = onExport,
        )
    }
}

/**
 * The bottom toolbar.
 *
 * Swaps its tools on selection, as the PRD specifies. Phase-2 tools are present
 * but disabled with a reason, rather than absent: a user who looks for Speed and
 * finds nothing concludes the app cannot do it, while one who finds it greyed
 * out with "coming in a later version" knows where it will be.
 */
@Composable
private fun ContextualToolbar(
    modifier: Modifier,
    hasSelection: Boolean,
    onImport: () -> Unit,
    onAddTrack: () -> Unit,
    onSplit: () -> Unit,
    onDelete: () -> Unit,
    onDuplicate: () -> Unit,
) {
    ApexToolRow(modifier = modifier.background(MaterialTheme.colorScheme.surface)) {
        if (!hasSelection) {
            item {
                ApexToolButton(
                    icon = Icons.Filled.Add,
                    label = "Add Media",
                    tooltip = "Add Media — Brings video, photos, or music from your device into " +
                        "this project.",
                    description = "Open your device storage to choose video, photo, or audio " +
                        "files to add to this project. Nothing is uploaded anywhere.",
                    onClick = onImport,
                )
            }
            item {
                ApexToolButton(
                    icon = Icons.Filled.Layers,
                    label = "Add Track",
                    tooltip = "Add Track — Creates a new empty layer. Video tracks stack on top " +
                        "of each other; audio tracks play together.",
                    description = "Add a new empty video track to the timeline so you can layer " +
                        "more clips.",
                    onClick = onAddTrack,
                )
            }
            item {
                ApexToolButton(
                    icon = Icons.Filled.ContentCut,
                    label = "Split",
                    tooltip = "Split Clip — Cuts the clip under the playhead into two separate " +
                        "pieces.",
                    description = "Split every clip under the current playhead into two clips.",
                    onClick = onSplit,
                )
            }
        } else {
            item {
                ApexToolButton(
                    icon = Icons.Filled.ContentCut,
                    label = "Split",
                    tooltip = "Split Clip — Cuts the selected clip into two separate pieces at " +
                        "the playhead position.",
                    description = "Split the currently selected clip into two clips at the " +
                        "current playhead. The right half becomes a new clip.",
                    onClick = onSplit,
                )
            }
            item {
                ApexToolButton(
                    icon = Icons.Filled.Delete,
                    label = "Delete",
                    tooltip = "Delete Clip — Removes the selected clip and leaves an empty gap " +
                        "where it was.",
                    description = "Delete the selected clip from the timeline. The space it " +
                        "occupied stays empty; other clips do not move.",
                    onClick = onDelete,
                )
            }
            item {
                ApexToolButton(
                    icon = Icons.Filled.ContentCopy,
                    label = "Duplicate",
                    tooltip = "Duplicate Clip — Makes an identical copy of the selected clip and " +
                        "places it immediately after the original.",
                    description = "Create a copy of the selected clip with the same settings and " +
                        "place it directly after the original on the same track.",
                    onClick = onDuplicate,
                )
            }
            item {
                ApexToolButton(
                    icon = Icons.Filled.Speed,
                    label = "Speed",
                    tooltip = "Speed Controls — Change how fast or slow the clip plays.",
                    description = "Change the playback speed of the selected clip. The clip " +
                        "length on the timeline changes to match.",
                    onClick = {},
                    enabled = false,
                    disabledReason = "Speed controls arrive in a later version of ApexEdits.",
                )
            }
            item {
                ApexToolButton(
                    icon = Icons.Filled.VolumeUp,
                    label = "Volume",
                    tooltip = "Volume — Make the sound of this clip louder or quieter.",
                    description = "Adjust the loudness of the selected clip's audio.",
                    onClick = {},
                    enabled = false,
                    disabledReason = "Volume controls arrive in a later version of ApexEdits.",
                )
            }
        }
    }
}

@Composable
private fun MissingMediaBanner(count: Int) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.errorContainer)
            .padding(12.dp),
    ) {
        Text(
            text = if (count == 1) {
                "1 file used in this project could not be found. It may have been moved or " +
                    "deleted. The rest of your project still works."
            } else {
                "$count files used in this project could not be found. They may have been moved " +
                    "or deleted. The rest of your project still works."
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onErrorContainer,
        )
    }
}

/** Pulls one or many URIs out of a picker result, which reports them differently. */
private fun Intent?.extractUris(): List<Uri> {
    if (this == null) return emptyList()
    clipData?.let { clip ->
        return (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
    }
    return listOfNotNull(data)
}
