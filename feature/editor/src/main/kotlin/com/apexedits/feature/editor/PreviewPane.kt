package com.apexedits.feature.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.compose.PlayerSurface
import androidx.media3.ui.compose.SURFACE_TYPE_SURFACE_VIEW
import com.apexedits.core.designsystem.overflowSentinel
import com.apexedits.core.media.PreviewPlayer
import com.apexedits.core.model.Project

/**
 * The video preview.
 *
 * The frame is letterboxed to the project's aspect ratio inside whatever space
 * the layout gives it, computed from [BoxWithConstraints] rather than assumed.
 * That is what lets a 9:16 project and a 2.35:1 project share one screen layout:
 * the surface shrinks to fit the tighter dimension and the surrounding area
 * stays black, instead of the surface overflowing its slot.
 */
@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun PreviewPane(
    project: Project,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val inInspection = LocalInspectionMode.current

    // One player per editor session, released with the composable.
    val player = remember(inInspection) {
        if (inInspection) null else PreviewPlayer(context)
    }

    DisposableEffect(player, project.revision) {
        player?.setProject(project)
        onDispose { }
    }
    DisposableEffect(player) {
        onDispose { player?.release() }
    }

    Box(
        modifier = modifier
            .background(Color.Black)
            .clipToBounds()
            .semantics {
                contentDescription = "Video preview. Shows the frame at the current playhead " +
                    "position, at ${project.format.aspect.displayName}."
            },
        contentAlignment = Alignment.Center,
    ) {
        BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
            val aspect = project.format.width.toFloat() / project.format.height.toFloat()
            val boxAspect = maxWidth / maxHeight

            // Fit inside: whichever dimension is the binding constraint governs,
            // so the surface is never larger than the space it was given.
            val (frameWidth, frameHeight) = if (boxAspect > aspect) {
                (maxHeight * aspect) to maxHeight
            } else {
                maxWidth to (maxWidth / aspect)
            }

            Box(
                modifier = Modifier
                    .width(frameWidth)
                    .height(frameHeight)
                    .background(Color.Black)
                    .overflowSentinel("PreviewSurface"),
            ) {
                // PlayerSurface rather than the legacy PlayerView: the
                // editor owns its own transport controls, and a PlayerView
                // would bring a second set that fights with them.
                //
                // A SurfaceView, not a TextureView: CompositionPlayer composites
                // several decoded streams per frame, and a SurfaceView keeps
                // that on a dedicated hardware layer instead of routing every
                // frame through the view hierarchy.
                player?.playerOrNull()?.let { active ->
                    PlayerSurface(
                        player = active,
                        surfaceType = SURFACE_TYPE_SURFACE_VIEW,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
        }

        if (project.tracks.all { it.clips.isEmpty() }) {
            androidx.compose.material3.Text(
                text = "Nothing on the timeline yet.\nTap Add Media to bring in a video, photo, " +
                    "or piece of music.",
                style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.7f),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(24.dp),
            )
        }
    }
}
