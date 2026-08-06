package com.apexedit.editor.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed

/**
 * Tap handling without the Material ripple.
 *
 * The editor's own selection states already say what was pressed, and a ripple
 * spreading across a clip on the timeline reads as a rendering glitch rather
 * than as feedback.
 */
fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier = composed {
    clickable(
        interactionSource = remember { MutableInteractionSource() },
        indication = null,
        onClick = onClick,
    )
}
