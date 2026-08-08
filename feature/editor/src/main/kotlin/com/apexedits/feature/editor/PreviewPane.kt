package com.apexedits.feature.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.compose.PlayerSurface
import androidx.media3.ui.compose.SURFACE_TYPE_SURFACE_VIEW
import com.apexedits.core.designsystem.ApexToolButton
import com.apexedits.core.designsystem.overflowSentinel
import com.apexedits.core.model.Project

/**
 * The video preview.
 *
 * The frame is letterboxed to the project's aspect ratio inside whatever space
 * the layout gives it, computed from [BoxWithConstraints] rather than assumed.
 * That is what lets a 9:16 project and a 2.35:1 project share one screen layout:
 * the surface shrinks to fit the tighter dimension and the surrounding area
 * stays black, instead of the surface overflowing its slot.
 *
 * The player itself belongs to [EditorViewModel], not to this composable — an
 * earlier version built it here with `remember`, which meant it was torn down
 * and rebuilt on every recomposition and had no way for a toolbar button
 * elsewhere on the screen to reach it. [player] and [isPlaying] are read from
 * there; [onTogglePlayPause] is the only thing this pane needs to be able to
 * do to it.
 */
@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun PreviewPane(
    project: Project,
    player: Player,
    isPlaying: Boolean,
    previewError: String?,
    onTogglePlayPause: () -> Unit,
    modifier: Modifier = Modifier,
) {
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
                PlayerSurface(
                    player = player,
                    surfaceType = SURFACE_TYPE_SURFACE_VIEW,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }

        if (project.tracks.all { it.clips.isEmpty() }) {
            Text(
                text = "Nothing on the timeline yet.\nTap Add Media to bring in a video, photo, " +
                    "or piece of music.",
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.7f),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(24.dp),
            )
        } else {
            // Bottom-centre, floating over the frame, the way every mobile
            // editor places its transport control: the preview is the one
            // region big enough on a phone screen to hold a thumb-sized
            // target without crowding the toolbar underneath it.
            ApexToolButton(
                icon = if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                label = if (isPlaying) "Pause" else "Play",
                tooltip = if (isPlaying) {
                    "Pause — Stops playback at the current position."
                } else {
                    "Play — Plays the video from the current position."
                },
                description = if (isPlaying) {
                    "Pause playback."
                } else {
                    "Play the video from the current playhead position."
                },
                onClick = onTogglePlayPause,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 12.dp)
                    .clip(androidx.compose.foundation.shape.CircleShape)
                    .background(Color.Black.copy(alpha = 0.45f)),
            )
        }

        if (previewError != null) {
            Text(
                text = previewError,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .background(Color.Black.copy(alpha = 0.6f))
                    .padding(8.dp),
            )
        }
    }
}
