package com.apexedits.core.media

import android.content.Context
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.CompositionPlayer
import com.apexedits.core.model.Project
import com.apexedits.core.model.Ticks
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The timeline preview.
 *
 * Wraps `CompositionPlayer`, which plays a multi-track [androidx.media3.transformer.Composition]
 * directly — the same object the exporter renders. Using it rather than an
 * `ExoPlayer` per track is what keeps preview and export honest with each other;
 * a hand-rolled preview would be a second implementation of the edit, and second
 * implementations drift.
 *
 * The composition is rebuilt when the document changes, which is why the editor
 * calls [setProject] with a revision guard rather than on every recomposition.
 *
 * ### Why the player is built eagerly, not lazily
 *
 * An earlier version built the underlying `CompositionPlayer` lazily, inside
 * [setProject]'s first call, and left [play] entirely unreachable from the UI.
 * The combination was a preview that never painted a frame: `PlayerSurface`
 * had nothing to attach to until the first edit, and even after that nothing
 * ever called `seekTo` or `play`, so the surface stayed black no matter what
 * was on the timeline. The player now exists for the whole life of this
 * object, and [setProject] seeks to the caller's current playhead after
 * preparing — Media3 renders the frame at a seek position as soon as it is
 * ready, without needing playback to start, which is what makes a freshly
 * opened project show its first frame instead of a black rectangle.
 */
@UnstableApi
class PreviewPlayer(context: Context) {

    private val _state = MutableStateFlow(PreviewState())
    val state: StateFlow<PreviewState> = _state.asStateFlow()

    data class PreviewState(
        val isPlaying: Boolean = false,
        val positionTicks: Long = 0L,
        val durationTicks: Long = 0L,
        val isReady: Boolean = false,
        /**
         * Set when playback fails. The editor shows it inline rather than as a
         * dialog: a preview that cannot decode one clip should not block editing
         * the rest of the timeline.
         */
        val error: String? = null,
    )

    // Declared before compositionPlayer, which references it during its own
    // initialisation — property initialisers run in declaration order, so the
    // reverse ordering would read an uninitialised listener.
    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            _state.value = _state.value.copy(isPlaying = isPlaying)
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            _state.value = _state.value.copy(isReady = playbackState == Player.STATE_READY)
        }

        override fun onPlayerError(error: PlaybackException) {
            // Surfaced, not thrown. Losing the preview must not lose the session.
            _state.value = _state.value.copy(
                error = "This clip could not be played: ${error.errorCodeName}",
                isPlaying = false,
            )
        }
    }

    private val compositionPlayer: CompositionPlayer = CompositionPlayer.Builder(context).build().also {
        it.addListener(listener)
    }
    private var loadedRevision: Long = -1L

    /** The underlying player, for the Compose `PlayerSurface`. Never null: built in the constructor. */
    val player: Player get() = compositionPlayer

    /**
     * Loads [project] if its revision differs from what is loaded, then seeks
     * to [keepPosition] so the surface shows that frame rather than resetting
     * to the start of the timeline on every edit.
     *
     * Rebuilding a composition tears down and re-creates decoders, so doing it
     * per recomposition would make the preview stutter on every slider tick. The
     * revision counter only advances on a real change, which makes it a reliable
     * guard.
     */
    fun setProject(project: Project, keepPosition: Ticks = Ticks.ZERO) {
        if (project.revision == loadedRevision) return

        val composition = CompositionBuilder.build(project)
        if (composition == null) {
            compositionPlayer.stop()
            loadedRevision = project.revision
            _state.value = PreviewState(durationTicks = project.duration.raw)
            return
        }

        runCatching {
            compositionPlayer.setComposition(composition)
            compositionPlayer.prepare()
            // Without this, a freshly prepared player has nothing telling it to
            // render anything: it sits ready, on frame zero of a surface with no
            // draw call behind it, which is indistinguishable from a black
            // screen. Seeking asks it to display the frame at this position the
            // moment it can, independent of whether playback ever starts.
            compositionPlayer.seekTo(keepPosition.toMillis())
        }.onFailure { error ->
            _state.value = _state.value.copy(error = error.message ?: "Preview could not be prepared")
        }

        loadedRevision = project.revision
        _state.value = _state.value.copy(
            durationTicks = project.duration.raw,
            positionTicks = keepPosition.raw,
            error = null,
        )
    }

    fun play() {
        compositionPlayer.play()
    }

    fun pause() {
        compositionPlayer.pause()
    }

    fun togglePlayPause() {
        if (compositionPlayer.isPlaying) compositionPlayer.pause() else compositionPlayer.play()
    }

    /** Moves the playhead. Called continuously while scrubbing. */
    fun seekTo(position: Ticks) {
        compositionPlayer.seekTo(position.toMillis())
        _state.value = _state.value.copy(positionTicks = position.raw)
    }

    /** Current playback position, for driving the playhead during playback. */
    fun currentPosition(): Ticks = Ticks.ofMillis(compositionPlayer.currentPosition.coerceAtLeast(0L))

    fun release() {
        compositionPlayer.removeListener(listener)
        compositionPlayer.release()
        _state.value = PreviewState()
    }
}
