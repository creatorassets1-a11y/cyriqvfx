package com.apexedit.editor.vm

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.util.UnstableApi
import com.apexedit.editor.core.*
import com.apexedit.editor.media.Exporter
import com.apexedit.editor.media.MediaImporter
import com.apexedit.editor.media.PreviewController
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Which contextual panel is open. Null means the toolbar is showing. */
enum class Panel { NONE, TRANSFORM, SPEED, COLOR, AUDIO, TEXT, TRANSITION, EXPORT }

data class EditorUiState(
    val history: History,
    val selection: Set<Id> = emptySet(),
    val playhead: Long = 0,
    /** Pixels per second at the current zoom. */
    val zoom: Float = 48f,
    val panel: Panel = Panel.NONE,
    val snapping: Boolean = true,
    val rippleMode: Boolean = false,
    val busy: String? = null,
    val message: String? = null,
    val exportProgress: Float? = null,
) {
    val doc: EditDocument get() = history.present
    val selectedClip: Clip? get() = selection.firstOrNull()?.let { doc.clips[it] }
}

@UnstableApi
class EditorViewModel(app: Application) : AndroidViewModel(app) {

    val preview = PreviewController(app)
    private val exporter = Exporter(app)

    private val _ui = MutableStateFlow(
        EditorUiState(history = History(present = EditDocument.create())),
    )
    val ui: StateFlow<EditorUiState> = _ui.asStateFlow()

    val isPlaying: StateFlow<Boolean> get() = preview.isPlaying
    val playerError: StateFlow<String?> get() = preview.error

    private var tickJob: Job? = null

    init {
        // Drive the playhead from the player while it is playing, so the
        // timeline follows real decoded position rather than a wall clock that
        // would drift away from the picture.
        tickJob = viewModelScope.launch {
            while (true) {
                if (preview.isPlaying.value) {
                    preview.syncPosition()
                    _ui.value = _ui.value.copy(playhead = preview.positionTicks.value)
                }
                delay(33)
            }
        }
    }

    // -----------------------------------------------------------------------
    // Document edits
    // -----------------------------------------------------------------------

    /**
     * Apply an edit and record it.
     *
     * [coalesceKey] folds a continuous gesture into a single undo entry — pass
     * the gesture id while a drag is live, omit it when the finger lifts.
     */
    private fun edit(label: String, coalesceKey: String? = null, block: (EditDocument) -> EditDocument) {
        val state = _ui.value
        val next = block(state.doc)
        if (next === state.doc) return
        _ui.value = state.copy(
            history = state.history.commit(next, label, coalesceKey),
            // Drop selection for clips the edit removed.
            selection = state.selection.filter { next.clips.containsKey(it) }.toSet(),
        )
        preview.setDocument(next)
    }

    fun undo() {
        val h = _ui.value.history
        if (!h.canUndo) return
        val next = h.undo()
        _ui.value = _ui.value.copy(history = next, selection = emptySet())
        preview.setDocument(next.present)
    }

    fun redo() {
        val h = _ui.value.history
        if (!h.canRedo) return
        val next = h.redo()
        _ui.value = _ui.value.copy(history = next, selection = emptySet())
        preview.setDocument(next.present)
    }

    // -----------------------------------------------------------------------
    // Import
    // -----------------------------------------------------------------------

    fun importMedia(uris: List<Uri>) {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = "Importing…")
            var added = 0
            var failed = 0

            for (uri in uris) {
                val asset = MediaImporter.load(getApplication(), uri)
                if (asset == null) {
                    failed++
                    continue
                }
                added++
                edit("Import ${asset.name}") { doc ->
                    val isAudio = asset.kind == MediaKind.AUDIO
                    val track = (if (isAudio) doc.audioTracks else doc.videoTracks).firstOrNull()
                        ?: return@edit doc
                    val duration = asset.duration ?: Time.secondsToTicks(5.0)
                    doc.addMedia(asset).appendClip(
                        Clip(
                            id = newId("clip"),
                            trackId = track.id,
                            start = 0,
                            duration = duration.roundToFrame(doc.settings.frameRate),
                            mediaIn = 0,
                            content = ClipContent.Media(asset.id),
                            label = asset.name,
                        ),
                    )
                }
            }

            _ui.value = _ui.value.copy(
                busy = null,
                message = when {
                    failed > 0 && added > 0 -> "Imported $added; $failed could not be read"
                    failed > 0 -> "Could not read ${if (failed == 1) "that file" else "those files"}"
                    else -> null
                },
            )
        }
    }

    fun addText(text: String = "Your text here") {
        edit("Add text") { doc ->
            val track = doc.videoTracks.getOrNull(1) ?: doc.videoTracks.first()
            doc.appendClip(
                Clip(
                    id = newId("clip"),
                    trackId = track.id,
                    start = 0,
                    duration = Time.secondsToTicks(3.0).roundToFrame(doc.settings.frameRate),
                    mediaIn = 0,
                    content = ClipContent.Text(text),
                    label = text.take(18),
                ),
            )
        }
    }

    // -----------------------------------------------------------------------
    // Timeline operations
    // -----------------------------------------------------------------------

    fun split() {
        val at = _ui.value.playhead
        edit("Split") { it.splitAt(at) }
    }

    fun deleteSelection() {
        val selection = _ui.value.selection.toList()
        if (selection.isEmpty()) return
        val ripple = _ui.value.rippleMode
        edit(if (ripple) "Ripple delete" else "Delete") {
            if (ripple) it.rippleDelete(selection) else it.liftClips(selection)
        }
    }

    fun duplicateSelection() {
        val selection = _ui.value.selection.toList()
        if (selection.isEmpty()) return
        edit("Duplicate") { doc ->
            var out = doc
            for (id in selection) {
                val clip = doc.clips[id] ?: continue
                out = out.insertClip(clip.copy(id = newId("clip"), start = clip.end))
            }
            out
        }
    }

    fun moveClip(clipId: Id, trackId: Id?, start: Long, gestureKey: String?) {
        val ripple = _ui.value.rippleMode
        edit("Move clip", gestureKey) {
            it.moveClip(
                clipId,
                trackId,
                start,
                if (ripple) CollisionPolicy.RIPPLE else CollisionPolicy.OVERWRITE,
            )
        }
    }

    fun trimStart(clipId: Id, newStart: Long, gestureKey: String?) =
        edit("Trim", gestureKey) { it.trimStart(clipId, newStart, _ui.value.rippleMode) }

    fun trimEnd(clipId: Id, newEnd: Long, gestureKey: String?) =
        edit("Trim", gestureKey) { it.trimEnd(clipId, newEnd, _ui.value.rippleMode) }

    fun setSpeed(clipId: Id, speed: Float) = edit("Speed") { it.setClipSpeed(clipId, speed) }

    fun reverse(clipId: Id) = edit("Reverse") { it.reverseClip(clipId) }

    fun setTransform(clipId: Id, transform: Transform, gestureKey: String? = null) =
        edit("Transform", gestureKey) { it.updateClip(clipId) { c -> c.copy(transform = transform) } }

    fun setGrade(clipId: Id, grade: Grade, gestureKey: String? = null) =
        edit("Colour", gestureKey) { it.updateClip(clipId) { c -> c.copy(grade = grade) } }

    fun setAudio(clipId: Id, audio: AudioParams, gestureKey: String? = null) =
        edit("Audio", gestureKey) { it.updateClip(clipId) { c -> c.copy(audio = audio) } }

    fun setTransition(clipId: Id, type: TransitionType, durationTicks: Long) =
        edit("Transition") { it.setTransition(clipId, type, durationTicks) }

    fun detachAudio(clipId: Id) = edit("Detach audio") { doc ->
        val track = doc.audioTracks.firstOrNull() ?: return@edit doc
        doc.detachAudio(clipId, track.id)
    }

    fun setAspect(aspect: AspectRatio) = edit("Aspect ratio") {
        it.copy(settings = it.settings.copy(aspect = aspect))
    }

    fun toggleTrackMute(trackId: Id) = edit("Mute track") {
        it.updateTrack(trackId) { t -> t.copy(muted = !t.muted) }
    }

    fun toggleTrackLock(trackId: Id) = edit("Lock track") {
        it.updateTrack(trackId) { t -> t.copy(locked = !t.locked) }
    }

    // -----------------------------------------------------------------------
    // View state
    // -----------------------------------------------------------------------

    fun select(clipId: Id?) {
        _ui.value = _ui.value.copy(
            selection = clipId?.let { setOf(it) } ?: emptySet(),
            panel = if (clipId == null) Panel.NONE else _ui.value.panel,
        )
    }

    fun seek(ticks: Long) {
        val doc = _ui.value.doc
        val clamped = ticks.coerceIn(0, doc.duration).roundToFrame(doc.settings.frameRate)
        _ui.value = _ui.value.copy(playhead = clamped)
        preview.seekTo(clamped)
    }

    fun stepFrames(frames: Int) {
        val doc = _ui.value.doc
        seek(_ui.value.playhead + frames.toLong().framesToTicks(doc.settings.frameRate))
    }

    fun togglePlay() {
        // Nothing to play is a common state early on; do not let the player
        // error about it.
        if (_ui.value.doc.duration == 0L) return
        preview.togglePlay()
    }

    fun setZoom(zoom: Float) {
        _ui.value = _ui.value.copy(zoom = zoom.coerceIn(MIN_ZOOM, MAX_ZOOM))
    }

    fun openPanel(panel: Panel) {
        _ui.value = _ui.value.copy(panel = if (_ui.value.panel == panel) Panel.NONE else panel)
    }

    fun toggleSnapping() {
        _ui.value = _ui.value.copy(snapping = !_ui.value.snapping)
    }

    fun toggleRipple() {
        _ui.value = _ui.value.copy(rippleMode = !_ui.value.rippleMode)
    }

    fun dismissMessage() {
        _ui.value = _ui.value.copy(message = null)
    }

    // -----------------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------------

    fun export(preset: Exporter.Preset) {
        viewModelScope.launch {
            preview.pause()
            _ui.value = _ui.value.copy(exportProgress = 0f)
            val result = exporter.export(_ui.value.doc, preset) { fraction ->
                _ui.value = _ui.value.copy(exportProgress = fraction)
            }
            _ui.value = _ui.value.copy(
                exportProgress = null,
                message = when (result) {
                    is Exporter.Progress.Done -> "Saved to your gallery"
                    is Exporter.Progress.Failed -> result.message
                    else -> null
                },
            )
        }
    }

    override fun onCleared() {
        tickJob?.cancel()
        preview.release()
        super.onCleared()
    }

    companion object {
        const val MIN_ZOOM = 6f
        const val MAX_ZOOM = 900f
    }
}
