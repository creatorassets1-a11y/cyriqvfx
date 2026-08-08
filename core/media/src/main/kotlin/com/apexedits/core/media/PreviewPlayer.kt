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
 */
@UnstableApi
class PreviewPlayer(private val context: Context) {

    private var player: CompositionPlayer? = null
    private var loadedRevision: Long = -1L

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

    /** The underlying player, for the Compose `PlayerSurface`. */
    fun playerOrNull(): Player? = player

    /**
     * Loads [project] if its revision differs from what is loaded.
     *
     * Rebuilding a composition tears down and re-creates decoders, so doing it
     * per recomposition would make the preview stutter on every slider tick. The
     * revision counter only advances on a real change, which makes it a reliable
     * guard.
     */
    fun setProject(project: Project) {
        if (project.revision == loadedRevision && player != null) return

        val composition = CompositionBuilder.build(project)
        if (composition == null) {
            release()
            _state.value = PreviewState(durationTicks = project.duration.raw)
            return
        }

        val active = player ?: CompositionPlayer.Builder(context).build().also {
            it.addListener(listener)
            player = it
        }

        runCatching {
            active.setComposition(composition)
            active.prepare()
        }.onFailure { error ->
            _state.value = _state.value.copy(error = error.message ?: "Preview could not be prepared")
        }

        loadedRevision = project.revision
        _state.value = _state.value.copy(durationTicks = project.duration.raw, error = null)
    }

    fun play() {
        player?.play()
    }

    fun pause() {
        player?.pause()
    }

    fun togglePlayPause() {
        val active = player ?: return
        if (active.isPlaying) active.pause() else active.play()
    }

    /** Moves the playhead. Called continuously while scrubbing. */
    fun seekTo(position: Ticks) {
        player?.seekTo(position.toMillis())
        _state.value = _state.value.copy(positionTicks = position.raw)
    }

    /** Current playback position, for driving the playhead during playback. */
    fun currentPosition(): Ticks {
        val active = player ?: return Ticks.ZERO
        return Ticks.ofMillis(active.currentPosition.coerceAtLeast(0L))
    }

    fun release() {
        player?.removeListener(listener)
        player?.release()
        player = null
        loadedRevision = -1L
        _state.value = PreviewState()
    }
}
