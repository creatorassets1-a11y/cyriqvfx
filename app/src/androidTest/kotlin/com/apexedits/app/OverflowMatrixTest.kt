package com.apexedits.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.apexedits.core.designsystem.ApexEditsTheme
import com.apexedits.core.designsystem.ApexToolButton
import com.apexedits.core.designsystem.ApexToolRow
import com.apexedits.core.designsystem.MinTouchTarget
import com.apexedits.core.designsystem.OverflowPolicy
import com.apexedits.core.model.AspectRatio
import com.apexedits.core.model.CountingIdSource
import com.apexedits.core.model.FrameRate
import com.apexedits.core.model.ProjectFormat
import com.apexedits.core.model.createProject
import com.apexedits.feature.editor.EditorLayout
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The zero-overflow guarantee, asserted.
 *
 * `OverflowPolicy.strict` is switched on for these tests, so
 * `Modifier.overflowSentinel` throws instead of logging. Every case here
 * composes the editor frame under a hostile configuration — a very small screen,
 * a doubled font scale, a landscape tablet, right-to-left — and passes only if
 * no region measured larger than the space it was given.
 *
 * These need a device or emulator. The sandbox this was developed in has no KVM,
 * so they are written to run in CI rather than having been run locally.
 */
@RunWith(AndroidJUnit4::class)
class OverflowMatrixTest {

    @get:Rule
    val compose = createComposeRule()

    @Before
    fun enableStrictOverflow() {
        OverflowPolicy.strict = true
    }

    @After
    fun disableStrictOverflow() {
        OverflowPolicy.strict = false
    }

    private val project = run {
        val ids = CountingIdSource()
        createProject(
            ids = ids,
            name = "Overflow matrix",
            format = ProjectFormat.of(AspectRatio.VERTICAL_9_16, 1920, FrameRate.FPS_30),
        )
    }

    @Composable
    private fun Frame(width: Int, height: Int) {
        ApexEditsTheme {
            EditorLayout(
                availableWidth = width.dp,
                availableHeight = height.dp,
                topBar = { m -> Box(m.size(width.dp, 56.dp)) },
                preview = { m -> Box(m) },
                timeline = { m -> Box(m) },
                toolbar = { m ->
                    ApexToolRow(m) {
                        repeat(8) { index ->
                            item {
                                ApexToolButton(
                                    icon = Icons.Filled.ContentCut,
                                    label = "Tool number $index",
                                    tooltip = "A deliberately long tooltip used to check that " +
                                        "nothing is pushed off the edge of the screen.",
                                    description = "A test tool button used to verify that the " +
                                        "toolbar scrolls rather than clipping its contents.",
                                    onClick = {},
                                )
                            }
                        }
                    }
                },
            )
        }
    }

    /** Composing without a thrown [com.apexedits.core.designsystem.OverflowException] is the assertion. */
    private fun assertFitsAt(width: Int, height: Int, fontScale: Float = 1f, rtl: Boolean = false) {
        compose.setContent {
            val base = LocalDensity.current
            CompositionLocalProvider(
                LocalDensity provides Density(density = base.density, fontScale = fontScale),
                LocalLayoutDirection provides if (rtl) LayoutDirection.Rtl else LayoutDirection.Ltr,
            ) {
                Frame(width, height)
            }
        }
        compose.waitForIdle()
    }

    // --- screen sizes --------------------------------------------------------

    @Test
    fun fitsOnTheSmallestSupportedPhone() {
        // A 4.5" phone at mdpi. The tightest layout the PRD asks to support.
        assertFitsAt(width = 320, height = 480)
    }

    @Test
    fun fitsOnATypicalPhone() = assertFitsAt(width = 411, height = 891)

    @Test
    fun fitsOnAPhoneInLandscape() = assertFitsAt(width = 891, height = 411)

    @Test
    fun fitsOnAFoldableInnerScreen() = assertFitsAt(width = 673, height = 841)

    @Test
    fun fitsOnATablet() = assertFitsAt(width = 1280, height = 800)

    @Test
    fun fitsInASplitScreenSliver() {
        // Multi-window can hand an app a very short window; the toolbar and
        // timeline still have to coexist.
        assertFitsAt(width = 411, height = 320)
    }

    // --- font scale ----------------------------------------------------------

    @Test
    fun fitsAtTheSmallestFontScale() = assertFitsAt(411, 891, fontScale = 0.85f)

    @Test
    fun fitsAtLargeFontScale() = assertFitsAt(411, 891, fontScale = 1.5f)

    @Test
    fun fitsAtMaximumFontScale() {
        // 200% is the PRD's stated ceiling and the case that breaks naive
        // layouts: every label is twice as tall, so a fixed-height toolbar would
        // push the timeline off the bottom.
        assertFitsAt(411, 891, fontScale = 2.0f)
    }

    @Test
    fun fitsAtMaximumFontScaleOnTheSmallestPhone() = assertFitsAt(320, 480, fontScale = 2.0f)

    // --- layout direction ----------------------------------------------------

    @Test
    fun fitsRightToLeft() = assertFitsAt(411, 891, rtl = true)

    @Test
    fun fitsRightToLeftAtMaximumFontScale() = assertFitsAt(411, 891, fontScale = 2.0f, rtl = true)

    // --- touch targets -------------------------------------------------------

    @Test
    fun toolButtonsMeetTheMinimumTouchTarget() {
        compose.setContent {
            ApexEditsTheme {
                ApexToolButton(
                    icon = Icons.Filled.ContentCut,
                    label = "Split",
                    tooltip = "Split Clip — Cuts the selected clip into two separate pieces at " +
                        "the playhead position.",
                    description = "Split the currently selected clip into two clips at the " +
                        "current playhead. The right half becomes a new clip.",
                    onClick = {},
                )
            }
        }

        val bounds = compose
            .onNodeWithContentDescription("Split the currently selected clip", substring = true)
            .assertIsDisplayed()
            .fetchSemanticsNode()
            .size

        with(compose.density) {
            assertTrue(
                "Tool button is ${bounds.width.toDp()} wide, below the 48dp minimum",
                bounds.width.toDp() >= MinTouchTarget,
            )
            assertTrue(
                "Tool button is ${bounds.height.toDp()} tall, below the 48dp minimum",
                bounds.height.toDp() >= MinTouchTarget,
            )
        }
    }
}
