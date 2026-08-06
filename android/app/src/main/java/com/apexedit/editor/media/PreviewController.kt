package com.apexedit.editor.media

import android.content.Context
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.CompositionPlayer
import com.apexedit.editor.core.EditDocument
import com.apexedit.editor.core.Time
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Preview playback.
 *
 * Wraps `CompositionPlayer`, which renders the same [androidx.media3.transformer.Composition]
 * the exporter uses. Video and audio both come from Media3's own pipeline —
 * hardware decoders, the platform audio mixer — which is why playback and sound
 * work here and did not in a WebView.
 *
 * Rebuilding a composition is not free, so [setDocument] only does it when the
 * edit actually changed something the player can see. Scrubbing and selection
 * changes must never rebuild.
 */
@UnstableApi
class PreviewController(private val context: Context) {

    private var player: CompositionPlayer? = null
    private var lastSignature: Int = 0

    private val _isPlaying = MutableStateFlow(false)
    val isPlaying: StateFlow<Boolean> = _isPlaying

    private val _positionTicks = MutableStateFlow(0L)
    val positionTicks: StateFlow<Long> = _positionTicks

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    /** True once a composition has been loaded and is ready to play. */
    private val _isReady = MutableStateFlow(false)
    val isReady: StateFlow<Boolean> = _isReady

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            _isPlaying.value = isPlaying
        }

        override fun onPlaybackStateChanged(state: Int) {
            _isReady.value = state == Player.STATE_READY
            if (state == Player.STATE_ENDED) _isPlaying.value = false
        }

        override fun onPlayerError(error: PlaybackException) {
            // Surfaced in the UI rather than thrown: a codec the device cannot
            // decode must not take the editor down with it.
            _error.value = error.localizedMessage ?: "Playback failed"
            _isPlaying.value = false
        }
    }

    fun attach(): CompositionPlayer {
        player?.let { return it }
        return CompositionPlayer.Builder(context).build().also {
            it.addListener(listener)
            player = it
        }
    }

    /**
     * Load a document. Cheap when nothing structural changed.
     *
     * The signature deliberately covers only what Media3 renders — clip
     * positions, trims, effects — so moving the playhead or selecting a clip
     * does not tear down the pipeline.
     */
    fun setDocument(doc: EditDocument, force: Boolean = false) {
        val signature = doc.renderSignature()
        if (!force && signature == lastSignature) return
        lastSignature = signature

        val composition = CompositionBuilder.build(doc)
        val current = player ?: attach()

        if (composition == null) {
            current.stop()
            _isReady.value = false
            return
        }

        val resumeAt = _positionTicks.value
        _error.value = null
        try {
            current.setComposition(composition)
            current.prepare()
            if (resumeAt > 0) seekTo(resumeAt.coerceAtMost(doc.duration))
        } catch (e: Exception) {
            _error.value = e.localizedMessage ?: "Could not build the composition"
        }
    }

    fun play() {
        player?.play()
    }

    fun pause() {
        player?.pause()
    }

    fun togglePlay() {
        val p = player ?: return
        if (p.isPlaying) p.pause() else p.play()
    }

    fun seekTo(ticks: Long) {
        _positionTicks.value = ticks.coerceAtLeast(0)
        player?.seekTo(Time.ticksToMs(ticks))
    }

    /** Called on a frame tick while playing, to drive the playhead. */
    fun syncPosition() {
        val p = player ?: return
        if (p.isPlaying) _positionTicks.value = Time.msToTicks(p.currentPosition)
    }

    fun release() {
        player?.removeListener(listener)
        player?.release()
        player = null
        _isReady.value = false
    }
}

/**
 * Hash of everything the renderer can see.
 *
 * Cheap to compute and, more importantly, deliberately incomplete: fields that
 * do not affect rendering are excluded so that UI-only changes never trigger a
 * composition rebuild.
 */
private fun EditDocument.renderSignature(): Int {
    var hash = settings.hashCode()
    for (track in tracks) {
        hash = 31 * hash + track.id.hashCode() + track.enabled.hashCode() + track.muted.hashCode()
    }
    for (id in trackClips.values.flatten()) {
        val clip = clips[id] ?: continue
        hash = 31 * hash + clip.id.hashCode()
        hash = 31 * hash + clip.start.hashCode()
        hash = 31 * hash + clip.duration.hashCode()
        hash = 31 * hash + clip.mediaIn.hashCode()
        hash = 31 * hash + clip.speed.hashCode()
        hash = 31 * hash + clip.content.hashCode()
        hash = 31 * hash + clip.transform.hashCode()
        hash = 31 * hash + clip.grade.hashCode()
        hash = 31 * hash + clip.audio.hashCode()
        hash = 31 * hash + clip.enabled.hashCode()
        hash = 31 * hash + (clip.transitionIn?.hashCode() ?: 0)
    }
    return hash
}
