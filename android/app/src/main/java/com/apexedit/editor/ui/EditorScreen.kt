package com.apexedit.editor.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import com.apexedit.editor.core.formatTimecode
import com.apexedit.editor.vm.EditorViewModel
import com.apexedit.editor.vm.Panel

/**
 * The editor screen.
 *
 * Layout rules that make overflow structurally impossible rather than a thing
 * to test for:
 *
 *  - The root is a Column of fixed-height rows plus one `weight(1f)` row (the
 *    preview). Only the preview flexes, so nothing else can be pushed off.
 *  - Every horizontal strip that can hold more than fits — the toolbar, the
 *    timeline — scrolls rather than wraps. Wrapping changes height, and a strip
 *    that changes height moves everything else.
 *  - Panels are capped at a fraction of screen height and scroll internally.
 *  - On short screens the timeline shrinks first, because the preview is what
 *    the user is actually looking at.
 */
@UnstableApi
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(vm: EditorViewModel) {
    val ui by vm.ui.collectAsState()
    val playing by vm.isPlaying.collectAsState()
    val playerError by vm.playerError.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    val configuration = LocalConfiguration.current
    val isShort = configuration.screenHeightDp < 640
    val isWide = configuration.screenWidthDp >= 720

    val pickMedia = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris -> vm.importMedia(uris) }

    // Surface player and import problems in one place rather than silently.
    LaunchedEffect(ui.message, playerError) {
        val text = ui.message ?: playerError
        if (text != null) {
            snackbar.showSnackbar(text)
            vm.dismissMessage()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = ApexColors.Base,
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .background(ApexColors.Base),
        ) {
            TopBar(
                timecode = ui.playhead.formatTimecode(ui.doc.settings.frameRate),
                aspectLabel = ui.doc.settings.aspect.label,
                fpsLabel = formatFps(ui.doc.settings.frameRate.fps),
                canUndo = ui.history.canUndo,
                canRedo = ui.history.canRedo,
                onUndo = vm::undo,
                onRedo = vm::redo,
                onExport = { vm.openPanel(Panel.EXPORT) },
            )

            // The only flexible row. Everything else is intrinsically sized, so
            // this absorbs all the slack and nothing can be pushed off-screen.
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(ApexColors.Base),
                contentAlignment = Alignment.Center,
            ) {
                PreviewSurface(
                    vm = vm,
                    aspect = ui.doc.settings.aspect.value,
                    isEmpty = ui.doc.duration == 0L,
                    onImport = { pickMedia.launch(arrayOf("video/*", "image/*", "audio/*")) },
                    onAddText = { vm.addText() },
                )
            }

            Transport(
                playing = playing,
                enabled = ui.doc.duration > 0,
                onPlayPause = vm::togglePlay,
                onStepBack = { vm.stepFrames(-1) },
                onStepForward = { vm.stepFrames(1) },
                onStart = { vm.seek(0) },
                onEnd = { vm.seek(ui.doc.duration) },
            )

            Timeline(
                vm = vm,
                ui = ui,
                modifier = Modifier
                    // Bounded so a tall track stack cannot squeeze the preview
                    // to nothing on a short device.
                    .heightIn(
                        min = 132.dp,
                        max = if (isShort) 200.dp else if (isWide) 300.dp else 260.dp,
                    )
                    .fillMaxWidth(),
            )

            if (ui.panel == Panel.NONE) {
                ToolBar(
                    hasSelection = ui.selectedClip != null,
                    onImport = { pickMedia.launch(arrayOf("video/*", "image/*", "audio/*")) },
                    onSplit = vm::split,
                    onDelete = vm::deleteSelection,
                    onDuplicate = vm::duplicateSelection,
                    onPanel = vm::openPanel,
                    onAddText = { vm.addText() },
                )
            }
        }

        if (ui.panel != Panel.NONE) {
            ToolPanelSheet(vm = vm, ui = ui, onDismiss = { vm.openPanel(ui.panel) })
        }

        if (ui.busy != null || ui.exportProgress != null) {
            BusyOverlay(
                label = ui.busy ?: "Exporting…",
                progress = ui.exportProgress,
            )
        }
    }
}

@Composable
private fun TopBar(
    timecode: String,
    aspectLabel: String,
    fpsLabel: String,
    canUndo: Boolean,
    canRedo: Boolean,
    onUndo: () -> Unit,
    onRedo: () -> Unit,
    onExport: () -> Unit,
) {
    Surface(color = ApexColors.Panel) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(Dimens.TouchMin + 4.dp)
                .padding(horizontal = Dimens.SpaceS),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onUndo, enabled = canUndo) {
                Icon(Icons.Default.Undo, "Undo", tint = iconTint(canUndo))
            }
            IconButton(onClick = onRedo, enabled = canRedo) {
                Icon(Icons.Default.Redo, "Redo", tint = iconTint(canRedo))
            }

            // weight(1f) plus a single-line label: a long project name or an
            // unusual timecode can never widen the row past the screen.
            Column(
                Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    timecode,
                    style = MaterialTheme.typography.titleSmall,
                    color = ApexColors.TextPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "$aspectLabel · $fpsLabel",
                    style = MaterialTheme.typography.labelSmall,
                    color = ApexColors.TextTertiary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            Button(
                onClick = onExport,
                colors = ButtonDefaults.buttonColors(
                    containerColor = ApexColors.Accent,
                    contentColor = ApexColors.OnAccent,
                ),
                contentPadding = PaddingValues(horizontal = Dimens.SpaceL, vertical = 6.dp),
                modifier = Modifier.heightIn(min = 40.dp),
            ) {
                Text("Export", style = MaterialTheme.typography.labelLarge, maxLines = 1)
            }
        }
    }
}

@Composable
private fun Transport(
    playing: Boolean,
    enabled: Boolean,
    onPlayPause: () -> Unit,
    onStepBack: () -> Unit,
    onStepForward: () -> Unit,
    onStart: () -> Unit,
    onEnd: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(Dimens.TransportHeight)
            .background(ApexColors.Base),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onStart, enabled = enabled) {
            Icon(Icons.Default.SkipPrevious, "Go to start", tint = iconTint(enabled))
        }
        IconButton(onClick = onStepBack, enabled = enabled) {
            Icon(Icons.Default.KeyboardArrowLeft, "Previous frame", tint = iconTint(enabled))
        }

        Surface(
            shape = MaterialTheme.shapes.extraLarge,
            color = if (enabled) ApexColors.Accent else ApexColors.Raised,
            modifier = Modifier.size(Dimens.TouchMin),
        ) {
            IconButton(onClick = onPlayPause, enabled = enabled) {
                Icon(
                    if (playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                    if (playing) "Pause" else "Play",
                    tint = if (enabled) ApexColors.OnAccent else ApexColors.TextTertiary,
                )
            }
        }

        IconButton(onClick = onStepForward, enabled = enabled) {
            Icon(Icons.Default.KeyboardArrowRight, "Next frame", tint = iconTint(enabled))
        }
        IconButton(onClick = onEnd, enabled = enabled) {
            Icon(Icons.Default.SkipNext, "Go to end", tint = iconTint(enabled))
        }
    }
}

private data class Tool(val label: String, val icon: ImageVector, val action: () -> Unit, val enabled: Boolean = true)

@Composable
private fun ToolBar(
    hasSelection: Boolean,
    onImport: () -> Unit,
    onSplit: () -> Unit,
    onDelete: () -> Unit,
    onDuplicate: () -> Unit,
    onPanel: (Panel) -> Unit,
    onAddText: () -> Unit,
) {
    val tools = listOf(
        Tool("Media", Icons.Default.AddPhotoAlternate, onImport),
        Tool("Split", Icons.Default.ContentCut, onSplit),
        Tool("Delete", Icons.Default.Delete, onDelete, hasSelection),
        Tool("Copy", Icons.Default.ContentCopy, onDuplicate, hasSelection),
        Tool("Speed", Icons.Default.Speed, { onPanel(Panel.SPEED) }, hasSelection),
        Tool("Adjust", Icons.Default.Tune, { onPanel(Panel.COLOR) }, hasSelection),
        Tool("Layout", Icons.Default.OpenWith, { onPanel(Panel.TRANSFORM) }, hasSelection),
        Tool("Audio", Icons.Default.VolumeUp, { onPanel(Panel.AUDIO) }, hasSelection),
        Tool("Text", Icons.Default.TextFields, onAddText),
        Tool("Fade", Icons.Default.Transform, { onPanel(Panel.TRANSITION) }, hasSelection),
    )

    Surface(color = ApexColors.Panel) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(Dimens.ToolbarHeight)
                // Scrolls rather than wraps: wrapping would change the row's
                // height and shove the timeline around as tools enable.
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = Dimens.SpaceXs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            tools.forEach { tool ->
                ToolButton(tool.label, tool.icon, tool.enabled, tool.action)
            }
        }
    }
}

@Composable
private fun ToolButton(label: String, icon: ImageVector, enabled: Boolean, onClick: () -> Unit) {
    Column(
        Modifier
            .width(68.dp)
            .fillMaxHeight()
            .clip(MaterialTheme.shapes.medium)
            .then(if (enabled) Modifier.clickableNoRipple(onClick) else Modifier),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = iconTint(enabled),
            modifier = Modifier.size(22.dp),
        )
        Spacer(Modifier.height(4.dp))
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = if (enabled) ApexColors.TextSecondary else ApexColors.TextTertiary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun BusyOverlay(label: String, progress: Float?) {
    Box(
        Modifier
            .fillMaxSize()
            .background(ApexColors.Base.copy(alpha = 0.82f)),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            if (progress != null) {
                CircularProgressIndicator(
                    progress = { progress.coerceIn(0f, 1f) },
                    color = ApexColors.Accent,
                )
                Spacer(Modifier.height(Dimens.SpaceM))
                Text(
                    "$label ${(progress * 100).toInt()}%",
                    color = ApexColors.TextPrimary,
                    style = MaterialTheme.typography.bodyMedium,
                )
            } else {
                CircularProgressIndicator(color = ApexColors.Accent)
                Spacer(Modifier.height(Dimens.SpaceM))
                Text(label, color = ApexColors.TextPrimary, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
internal fun iconTint(enabled: Boolean) =
    if (enabled) ApexColors.TextPrimary else ApexColors.TextTertiary.copy(alpha = 0.5f)

private fun formatFps(fps: Double): String {
    val rounded = Math.round(fps * 100) / 100.0
    return if (rounded % 1.0 == 0.0) "${rounded.toInt()} fps" else "$rounded fps"
}
