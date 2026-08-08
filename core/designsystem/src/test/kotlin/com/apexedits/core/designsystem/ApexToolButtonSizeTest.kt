package com.apexedits.core.designsystem

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Measures what [ApexToolButton] actually renders at, rather than trusting the
 * source numbers.
 *
 * This runs the real Compose layout pass through Robolectric's native
 * graphics pipeline — no emulator, but real measurement and layout code, not
 * a description of what the code is supposed to do. It exists because a
 * user-reported "the UI is too big" is a claim about rendered dp, and the
 * only way to check it without a device is to actually lay the button out
 * and measure it.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ApexToolButtonSizeTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `a short-label button meets the accessibility floor but stays close to it`() {
        composeRule.setContent {
            ApexToolButton(
                icon = Icons.Filled.Add,
                label = "Add",
                tooltip = "Add — adds something.",
                description = "Adds something to the project.",
                onClick = {},
            )
        }

        val node = composeRule.onNodeWithContentDescription("Adds something to the project.")
        // Never below the PRD's floor...
        node.assertWidthIsAtLeast(MinTouchTarget)
        node.assertHeightIsAtLeast(MinTouchTarget)

        // ...and, now that the preferred size dropped from 56dp to 48dp,
        // not padded well past it either. A short label like "Add" should
        // render within a few dp of the 48dp floor, not balloon toward the
        // old default.
        val bounds = node.fetchSemanticsNode().boundsInRoot
        val density = composeRule.density
        val widthDp = with(density) { bounds.width.toDp() }
        val heightDp = with(density) { bounds.height.toDp() }

        assert(widthDp <= MAX_EXPECTED_SIZE) {
            "expected width <= $MAX_EXPECTED_SIZE, was $widthDp — the toolbar shrink did not take effect"
        }
        assert(heightDp <= MAX_EXPECTED_SIZE) {
            "expected height <= $MAX_EXPECTED_SIZE, was $heightDp — the toolbar shrink did not take effect"
        }
    }

    private companion object {
        /**
         * A little headroom above the 48dp floor for icon/label padding, but
         * well short of the old 56dp preferred size plus its own padding
         * (which measured well into the 70s of dp for a short label).
         */
        val MAX_EXPECTED_SIZE = 54.dp
    }
}
