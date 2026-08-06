package com.apexedit.editor.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.apexedit.editor.vm.EditorViewModel

/**
 * The preview.
 *
 * A real [PlayerView] driven by `CompositionPlayer`, so decoding, audio output
 * and A/V sync are the platform's job rather than ours. `RESIZE_MODE_FIT`
 * letterboxes inside whatever space the layout gives it, which is what keeps
 * the preview honest about the project's aspect ratio on any screen.
 *
 * The surface is sized by [aspect] within the available box rather than filling
 * it, so a 9:16 project on a wide tablet shows pillarboxing instead of a
 * stretched frame.
 */
@UnstableApi
@Composable
fun PreviewSurface(
    vm: EditorViewModel,
    aspect: Float,
    isEmpty: Boolean,
    onImport: () -> Unit,
    onAddText: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .padding(Dimens.SpaceS),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                // aspectRatio with matchHeightConstraintsFirst keeps the frame
                // inside the box on both tall and wide screens: the constraint
                // that binds first wins, so nothing is ever clipped.
                .aspectRatio(aspect, matchHeightConstraintsFirst = true)
                .clip(MaterialTheme.shapes.medium)
                .background(androidx.compose.ui.graphics.Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            AndroidView(
                factory = { context ->
                    PlayerView(context).apply {
                        useController = false
                        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                        setShutterBackgroundColor(android.graphics.Color.BLACK)
                        player = vm.preview.attach()
                    }
                },
                update = { view -> view.player = vm.preview.attach() },
                modifier = Modifier.fillMaxSize(),
            )

            if (isEmpty) {
                EmptyState(onImport = onImport, onAddText = onAddText)
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose { vm.preview.pause() }
    }
}

/**
 * Shown until there is something on the timeline.
 *
 * Two actions only. A first-run screen that lists everything the app can do is
 * a screen nobody reads; the fastest path to seeing your own footage is the
 * one worth offering.
 */
@Composable
private fun EmptyState(onImport: () -> Unit, onAddText: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .background(ApexColors.Base.copy(alpha = 0.92f))
            .padding(Dimens.SpaceL),
        horizontalArrangement = Arrangement.Center,
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Start a project",
            style = MaterialTheme.typography.titleMedium,
            color = ApexColors.TextPrimary,
        )
        Spacer(Modifier.height(Dimens.SpaceXs))
        Text(
            "Everything runs on this device. Nothing is uploaded.",
            style = MaterialTheme.typography.bodySmall,
            color = ApexColors.TextTertiary,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(Dimens.SpaceL))

        Button(
            onClick = onImport,
            colors = ButtonDefaults.buttonColors(
                containerColor = ApexColors.Accent,
                contentColor = ApexColors.OnAccent,
            ),
            modifier = Modifier.heightIn(min = Dimens.TouchMin),
        ) {
            Icon(Icons.Default.AddPhotoAlternate, null, Modifier.size(18.dp))
            Spacer(Modifier.width(Dimens.SpaceS))
            Text("Add media", maxLines = 1)
        }

        Spacer(Modifier.height(Dimens.SpaceS))

        TextButton(onClick = onAddText, modifier = Modifier.heightIn(min = Dimens.TouchMin)) {
            Icon(Icons.Default.TextFields, null, Modifier.size(18.dp), tint = ApexColors.TextSecondary)
            Spacer(Modifier.width(Dimens.SpaceS))
            Text("Add a title", color = ApexColors.TextSecondary, maxLines = 1)
        }
    }
}
