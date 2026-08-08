package com.apexedits.feature.editor

import android.os.Looper
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import com.apexedits.core.model.AspectRatio
import com.apexedits.core.model.Clip
import com.apexedits.core.model.MediaKind
import com.apexedits.core.model.MediaRef
import com.apexedits.core.model.Project
import com.apexedits.core.model.ProjectFormat
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.Track
import com.apexedits.core.model.TrackKind
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * The direct regression test for "there is no play button": renders the real
 * [PreviewPane] composable, finds the button by the same content description
 * the accessibility tree exposes, taps it, and asserts the callback that
 * reaches [EditorViewModel.togglePlayPause] actually fires.
 *
 * [PreviewPane] needs a real [Player] to hand to Media3's `PlayerSurface`. A
 * [SimpleBasePlayer] with a fixed [SimpleBasePlayer.State] stands in for one
 * — it is a real, correctly-behaved `Player` implementation (Media3's own
 * base class for exactly this purpose), just with no media loaded. This test
 * proves the click wiring; it says nothing about decoding or rendering an
 * actual frame, which needs a device.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PreviewPaneTest {

    @get:Rule
    val composeRule = createComposeRule()

    private class FakePlayer(looper: Looper) : SimpleBasePlayer(looper) {
        override fun getState(): State =
            State.Builder()
                .setAvailableCommands(Player.Commands.Builder().addAllCommands().build())
                // STATE_READY requires a non-empty playlist - this fake has no
                // media loaded at all, only STATE_IDLE and STATE_ENDED allow
                // that. Discovered by running this test, not assumed: Media3
                // itself rejected the first attempt with "Empty playlist only
                // allowed in STATE_IDLE or STATE_ENDED".
                .setPlaybackState(Player.STATE_IDLE)
                .build()

        // PlayerSurface attaches itself by calling setVideoSurfaceView, which
        // SimpleBasePlayer routes to this handler - and its own default
        // implementation throws IllegalStateException("Missing implementation
        // to handle COMMAND_SET_VIDEO_SURFACE") rather than no-op. Also found
        // by running this test, not assumed.
        override fun handleSetVideoOutput(videoOutput: Any): com.google.common.util.concurrent.ListenableFuture<*> =
            com.google.common.util.concurrent.Futures.immediateVoidFuture()

        override fun handleClearVideoOutput(videoOutput: Any?): com.google.common.util.concurrent.ListenableFuture<*> =
            com.google.common.util.concurrent.Futures.immediateVoidFuture()
    }

    private fun projectWithOneClip(): Project {
        val media = MediaRef(
            id = "media-1",
            uri = "file:///test.mp4",
            displayName = "test.mp4",
            kind = MediaKind.VIDEO,
            duration = Ticks.ofSeconds(10.0),
            width = 1920,
            height = 1080,
            hasAudio = true,
        )
        val clip = Clip(
            id = "clip-1",
            mediaId = "media-1",
            timelineStart = Ticks.ZERO,
            sourceIn = Ticks.ZERO,
            sourceOut = Ticks.ofSeconds(10.0),
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
    fun `tapping the play button invokes the toggle callback`() {
        var toggleCount = 0

        composeRule.setContent {
            PreviewPane(
                project = projectWithOneClip(),
                player = FakePlayer(Looper.getMainLooper()),
                isPlaying = false,
                previewError = null,
                onTogglePlayPause = { toggleCount++ },
            )
        }

        composeRule.onNodeWithContentDescription("Play the video from the current playhead position.")
            .performClick()

        assertEquals(1, toggleCount)
    }

    @Test
    fun `the button's label and description flip to Pause while playing`() {
        composeRule.setContent {
            PreviewPane(
                project = projectWithOneClip(),
                player = FakePlayer(Looper.getMainLooper()),
                isPlaying = true,
                previewError = null,
                onTogglePlayPause = {},
            )
        }

        // If this button did not exist, or still read "Play" while isPlaying
        // is true, this lookup throws - it is not a soft assertion.
        composeRule.onNodeWithContentDescription("Pause playback.").assertIsDisplayed()
    }

    @Test
    fun `a preview error is shown on screen rather than silently swallowed`() {
        composeRule.setContent {
            PreviewPane(
                project = projectWithOneClip(),
                player = FakePlayer(Looper.getMainLooper()),
                isPlaying = false,
                previewError = "This clip could not be played: DECODER_INIT_FAILED",
                onTogglePlayPause = {},
            )
        }

        composeRule.onNodeWithText("This clip could not be played: DECODER_INIT_FAILED").assertIsDisplayed()
    }
}
