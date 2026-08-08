package com.apexedits.feature.editor

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performTouchInput
import com.apexedits.core.model.AspectRatio
import com.apexedits.core.model.Clip
import com.apexedits.core.model.MediaKind
import com.apexedits.core.model.MediaRef
import com.apexedits.core.model.Project
import com.apexedits.core.model.ProjectFormat
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.Track
import com.apexedits.core.model.TrackKind
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Drives the timeline ruler with a real (simulated) touch sequence and checks
 * what [onSeek] actually receives — the direct regression test for the
 * reported bug: touching and dragging along the ruler did nothing, because
 * the gesture handler only recognised a stationary tap.
 *
 * This runs the real gesture-detection code through Robolectric's Compose
 * test harness, not a description of what it should do. `MediaMetadataRetriever`
 * calls the clip's thumbnail strip makes will fail against the fake
 * `file:///test.mp4` URI and are caught internally as null frames, same as any
 * unreadable file — nothing here needs a real video.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TimelineScrubTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun testProject(): Project {
        val media = MediaRef(
            id = "media-1",
            uri = "file:///test.mp4",
            displayName = "test.mp4",
            kind = MediaKind.VIDEO,
            duration = Ticks.ofSeconds(20.0),
            width = 1920,
            height = 1080,
            hasAudio = true,
        )
        val clip = Clip(
            id = "clip-1",
            mediaId = "media-1",
            timelineStart = Ticks.ZERO,
            sourceIn = Ticks.ZERO,
            sourceOut = Ticks.ofSeconds(20.0),
        )
        val track = Track(id = "track-1", kind = TrackKind.VIDEO, name = "Video 1", clips = listOf(clip))
        return Project(
            id = "project-1",
            name = "Test",
            format = ProjectFormat.of(AspectRatio.LANDSCAPE_16_9),
            tracks = listOf(track),
            media = listOf(media),
        )
    }

    @Test
    fun `touching the ruler seeks immediately, matching the tap the old code handled`() {
        val seeks = mutableListOf<Ticks>()

        composeRule.setContent {
            Timeline(
                project = testProject(),
                playhead = Ticks.ZERO,
                selectedClipId = null,
                onSeek = { seeks += it },
                onSelectClip = {},
                onToggleLock = { _, _ -> },
                onToggleMute = { _, _ -> },
            )
        }

        composeRule.onNodeWithContentDescription("Timeline ruler", substring = true)
            .performTouchInput { click(Offset(100f, height / 2f)) }

        composeRule.waitForIdle()
        assertTrue("expected a seek from a plain tap, got none", seeks.isNotEmpty())
    }

    @Test
    fun `dragging the ruler seeks continuously, which the old tap-only code could not do at all`() {
        val seeks = mutableListOf<Ticks>()

        composeRule.setContent {
            Timeline(
                project = testProject(),
                playhead = Ticks.ZERO,
                selectedClipId = null,
                onSeek = { seeks += it },
                onSelectClip = {},
                onToggleLock = { _, _ -> },
                onToggleMute = { _, _ -> },
            )
        }

        composeRule.onNodeWithContentDescription("Timeline ruler", substring = true)
            .performTouchInput {
                down(Offset(20f, height / 2f))
                repeat(5) { step ->
                    moveTo(Offset(20f + step * 40f, height / 2f))
                }
                up()
            }

        composeRule.waitForIdle()

        // The old detectTapGestures implementation could only ever produce
        // one seek per gesture - a stationary down, then a same-position up.
        // This is the behaviour that made "dragging does nothing" true: more
        // than one seek call, moving in the direction the finger moved,
        // proves the drag is actually being tracked rather than only the
        // initial touch.
        assertTrue(
            "expected multiple seeks from a drag, got ${seeks.size}: $seeks",
            seeks.size >= 3,
        )
        val raws = seeks.map { it.raw }
        assertTrue(
            "expected the seek position to move forward as the finger moved right, got $raws",
            raws.last() > raws.first(),
        )
    }

    @Test
    fun `a drag that moves backward is reflected immediately, not just at release`() {
        val seeks = mutableListOf<Ticks>()

        composeRule.setContent {
            Timeline(
                project = testProject(),
                playhead = Ticks.ZERO,
                selectedClipId = null,
                onSeek = { seeks += it },
                onSelectClip = {},
                onToggleLock = { _, _ -> },
                onToggleMute = { _, _ -> },
            )
        }

        composeRule.onNodeWithContentDescription("Timeline ruler", substring = true)
            .performTouchInput {
                // Same coordinate range the forward-drag test already proved
                // is on-node, just walked the other way.
                down(Offset(180f, height / 2f))
                moveTo(Offset(140f, height / 2f))
                moveTo(Offset(100f, height / 2f))
                moveTo(Offset(60f, height / 2f))
                up()
            }

        composeRule.waitForIdle()
        assertTrue("expected multiple seeks, got ${seeks.size}", seeks.size >= 3)
        // Every intermediate seek should already show the leftward motion,
        // not just the final one - a scrubber that only updates on release
        // is not usable for finding a frame.
        for (index in 1 until seeks.size) {
            assertTrue(
                "seek $index (${seeks[index].raw}) should be <= seek ${index - 1} (${seeks[index - 1].raw})",
                seeks[index].raw <= seeks[index - 1].raw,
            )
        }
    }
}
