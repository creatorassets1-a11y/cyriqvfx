package com.apexedits.feature.projects

import android.app.Application
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.apexedits.core.data.ProjectEntity
import com.apexedits.core.data.aspectRatio
import com.apexedits.core.data.frameRate
import com.apexedits.core.designsystem.ApexScaffold
import com.apexedits.core.designsystem.overflowSentinel
import com.apexedits.core.model.AspectRatio
import com.apexedits.core.model.FrameRate
import com.apexedits.core.model.Ticks

/**
 * The projects list — the app's home.
 *
 * Every entry states its shape, length and when it was last touched, because on
 * a phone the thumbnail alone is rarely enough to tell two vertical projects
 * apart.
 */
@Composable
fun ProjectsScreen(
    viewModel: ProjectsViewModel,
    onOpenProject: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val projects by viewModel.projects.collectAsStateWithLifecycle()
    var showNewProject by remember { mutableStateOf(false) }

    ApexScaffold(tag = "ProjectsScreen", modifier = modifier) { _, _ ->
        if (projects.isEmpty()) {
            EmptyState(onCreate = { showNewProject = true })
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().overflowSentinel("ProjectsList"),
                contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 96.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    Text(
                        text = "Your projects",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(bottom = 4.dp),
                    )
                }
                items(projects, key = { it.id }) { project ->
                    ProjectCard(project = project, onOpen = { onOpenProject(project.id) })
                }
            }
        }

        ExtendedFloatingActionButton(
            onClick = { showNewProject = true },
            icon = { Icon(Icons.Filled.Add, contentDescription = null) },
            text = { Text("New Project") },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp)
                .semantics {
                    contentDescription = "New Project. Start a new video edit from scratch. " +
                        "You will choose a shape and frame rate first."
                },
        )
    }

    if (showNewProject) {
        NewProjectDialog(
            onDismiss = { showNewProject = false },
            onCreate = { name, aspect, frameRate ->
                showNewProject = false
                viewModel.createProject(name, aspect, frameRate, onOpenProject)
            },
        )
    }
}

@Composable
private fun ProjectCard(project: ProjectEntity, onOpen: () -> Unit) {
    val duration = Ticks(project.durationTicks)
    val summary = buildString {
        append(project.aspectRatio().displayName)
        append(" · ").append(project.width).append("×").append(project.height)
        append(" · ").append(project.frameRate().label)
    }
    val length = formatDuration(duration)

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .semantics {
                contentDescription = "Project ${project.name}. $summary. $length long, " +
                    "${project.clipCount} clips. Tap to open."
            },
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(
                text = project.name,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = summary,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = "$length · ${project.clipCount} clips",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun EmptyState(onCreate: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = "No projects yet",
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
            )
            Text(
                text = "A project holds your video, your edits, and your settings. Create one to " +
                    "start editing — everything stays on this device.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp, bottom = 20.dp),
            )
            TextButton(onClick = onCreate) { Text("Create your first project") }
        }
    }
}

/**
 * The New Project dialog.
 *
 * Each aspect ratio shows what it is *for* rather than only its numbers, which
 * is the whole point of the PRD's example — "9:16 Vertical — Best for TikTok,
 * Reels, Shorts". The guidance strings live on [AspectRatio] itself, so this
 * screen cannot show a shape without explaining it.
 */
@Composable
private fun NewProjectDialog(
    onDismiss: () -> Unit,
    onCreate: (String, AspectRatio, FrameRate) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var aspect by remember { mutableStateOf(AspectRatio.VERTICAL_9_16) }
    var frameRate by remember { mutableStateOf(FrameRate.FPS_30) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New Project") },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                item {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Project name") },
                        placeholder = { Text("Untitled project") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    Text(
                        text = "Shape",
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
                items(AspectRatio.entries) { option ->
                    SelectableRow(
                        title = option.displayName,
                        subtitle = option.guidance,
                        selected = option == aspect,
                        onSelect = { aspect = option },
                    )
                }
                item {
                    Text(
                        text = "Frame rate",
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
                items(FrameRate.ALL) { option ->
                    SelectableRow(
                        title = option.label,
                        subtitle = frameRateGuidance(option),
                        selected = option == frameRate,
                        onSelect = { frameRate = option },
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(name.ifBlank { "Untitled project" }, aspect, frameRate) },
            ) { Text("Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun SelectableRow(
    title: String,
    subtitle: String,
    selected: Boolean,
    onSelect: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onSelect)
            .padding(vertical = 6.dp)
            .semantics {
                contentDescription = "$title. $subtitle${if (selected) ". Selected" else ""}"
            },
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            color = if (selected) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurface
            },
        )
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun frameRateGuidance(rate: FrameRate): String = when (rate) {
    FrameRate.FPS_24 -> "The cinema standard. Gives a film-like look."
    FrameRate.FPS_25 -> "Broadcast standard in Europe, Africa, and much of Asia."
    FrameRate.FPS_30 -> "The most common choice for social video. Smooth and widely supported."
    FrameRate.FPS_50 -> "Smoother motion, for sport and fast action in 25 fps regions."
    FrameRate.FPS_60 -> "Very smooth motion, for sport, gaming, and slow-motion source footage."
    FrameRate.FPS_23_976 -> "Cinema rate used by North American broadcast workflows."
    FrameRate.FPS_29_97 -> "Broadcast standard in North America and Japan."
    FrameRate.FPS_59_94 -> "Smooth North American broadcast rate, for sport and action."
    else -> "A custom frame rate."
}

private fun formatDuration(duration: Ticks): String {
    val totalSeconds = duration.toSeconds().toLong()
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return if (minutes > 0) "${minutes}m ${seconds}s" else "${seconds}s"
}
