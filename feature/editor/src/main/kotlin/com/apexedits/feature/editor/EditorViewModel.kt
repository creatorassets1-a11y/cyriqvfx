package com.apexedits.feature.editor

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import com.apexedits.core.data.AutoSave
import com.apexedits.core.data.DevicePreferences
import com.apexedits.core.data.MediaImporter
import com.apexedits.core.data.ProjectDatabase
import com.apexedits.core.data.ProjectStore
import com.apexedits.core.device.DeviceClass
import com.apexedits.core.device.DeviceProfile
import com.apexedits.core.device.HeavyOperation
import com.apexedits.core.device.LowResourceWarning
import com.apexedits.core.engine.edit.addKeyframe
import com.apexedits.core.engine.edit.addMarker
import com.apexedits.core.engine.edit.addTrack
import com.apexedits.core.engine.edit.clearKeyframes
import com.apexedits.core.engine.edit.removeKeyframe
import com.apexedits.core.engine.edit.removeMarker
import com.apexedits.core.engine.edit.renameMarker
import com.apexedits.core.engine.edit.setPropertyValue
import com.apexedits.core.engine.edit.addMedia
import com.apexedits.core.engine.edit.appendClip
import com.apexedits.core.engine.edit.deleteClip
import com.apexedits.core.engine.edit.duplicateClip
import com.apexedits.core.engine.edit.insertClipAt
import com.apexedits.core.engine.edit.relinkMedia
import com.apexedits.core.engine.edit.rippleDeleteClip
import com.apexedits.core.engine.edit.setClipFadeIn
import com.apexedits.core.engine.edit.setClipFadeOut
import com.apexedits.core.engine.edit.setClipPan
import com.apexedits.core.engine.edit.setClipSpeed
import com.apexedits.core.engine.edit.setClipVolume
import com.apexedits.core.engine.edit.setTrackLocked
import com.apexedits.core.engine.edit.setTrackMuted
import com.apexedits.core.engine.edit.splitAllTracksAt
import com.apexedits.core.engine.history.History
import com.apexedits.core.media.PreviewPlayer
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.CountingIdSource
import com.apexedits.core.model.IdSource
import com.apexedits.core.model.MediaKind
import com.apexedits.core.model.Project
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.TrackKind
import com.apexedits.core.model.createClip
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Editor state.
 *
 * The document lives in a [History], so undo is the same mechanism as editing
 * rather than a parallel one — every mutation goes through [apply], which pushes
 * onto the stack and hands the new document to autosave. There is no code path
 * that changes the project without both happening, which is what keeps "deep
 * undo" and "never lose work" true as features are added.
 */
@OptIn(UnstableApi::class)
class EditorViewModel(
    application: Application,
    private val projectId: String,
) : AndroidViewModel(application) {

    private val database = ProjectDatabase.get(application)
    private val store = ProjectStore(application, database.projectDao())
    private val importer = MediaImporter(application)
    private val autoSave = AutoSave(store, viewModelScope)
    private val preferences = DevicePreferences(application)

    /**
     * Built once, for the life of this ViewModel — not per-composition, as an
     * earlier version had it. Owning it here rather than inside `PreviewPane`
     * is what makes play/pause and scrub-driven seeking reachable from the
     * toolbar and the timeline instead of being sealed inside a composable
     * with no way in.
     */
    private val previewPlayer = PreviewPlayer(application)

    private val ids: IdSource = CountingIdSource(System.currentTimeMillis())

    private val _state = MutableStateFlow(EditorUiState())
    val state: StateFlow<EditorUiState> = _state.asStateFlow()

    private var history: History? = null

    /** The underlying player, for `PreviewPane`'s `PlayerSurface`. */
    fun previewPlayerForSurface(): Player = previewPlayer.player

    init {
        autoSave.start()
        load()

        viewModelScope.launch {
            previewPlayer.state.collect { previewState ->
                _state.value = _state.value.copy(
                    isPreviewPlaying = previewState.isPlaying,
                    previewError = previewState.error,
                )
            }
        }

        // Drives the timeline playhead during playback. Polled rather than
        // pushed because Media3 has no per-frame position callback; ~30 times
        // a second is smooth enough for a scrubber indicator without costing
        // anything when nothing is playing, since the loop is a no-op check.
        viewModelScope.launch {
            while (isActive) {
                if (_state.value.isPreviewPlaying) {
                    _state.value = _state.value.copy(playhead = previewPlayer.currentPosition())
                }
                delay(POSITION_POLL_INTERVAL_MS)
            }
        }
    }

    private fun load() {
        viewModelScope.launch {
            val result = store.load(projectId)
            if (result == null) {
                _state.value = _state.value.copy(
                    isLoading = false,
                    message = "This project could not be opened. It may have been deleted.",
                )
                return@launch
            }

            // Media can move or be deleted between sessions. Checking on open
            // means a missing file shows as a relink prompt rather than as a
            // clip that silently plays nothing.
            val refreshed = importer.refreshAvailability(result.project.media)
            val project = result.project.copy(media = refreshed)

            history = History.of(project)
            store.markOpen(projectId, open = true)

            _state.value = EditorUiState(
                project = project,
                isLoading = false,
                deviceProfile = DeviceProfile.read(getApplication()),
                recoveryAvailable = result.hasRecovery,
                missingMediaCount = refreshed.count { !it.available },
            )
            pendingRecovery = result.recovered
            previewPlayer.setProject(project, keepPosition = Ticks.ZERO)
        }
    }

    private var pendingRecovery: Project? = null

    // --- editing -------------------------------------------------------------

    /**
     * Applies a mutation, records it for undo, and queues an autosave.
     *
     * Every edit goes through here. A [label] is required because the Undo
     * button shows what it will reverse.
     */
    private fun apply(label: String, coalesce: Boolean = false, transform: (Project) -> Project) {
        val current = history ?: return
        val next = transform(current.present)
        val updated = if (coalesce) current.pushCoalescing(label, next) else current.push(label, next)
        history = updated
        publish()
    }

    private fun publish() {
        val current = history ?: return
        _state.value = _state.value.copy(
            project = current.present,
            canUndo = current.canUndo,
            canRedo = current.canRedo,
            undoLabel = current.undoLabel,
            redoLabel = current.redoLabel,
        )
        autoSave.record(current.present)
        // Rebuilding the composition resets the player to frame zero; seeking
        // back to where the playhead already was keeps an edit from visibly
        // jumping the preview to the start of the timeline.
        previewPlayer.setProject(current.present, keepPosition = _state.value.playhead)
    }

    fun undo() {
        history = history?.undo()
        publish()
    }

    fun redo() {
        history = history?.redo()
        publish()
    }

    /**
     * Moves the playhead, from a tap or a drag on the timeline ruler.
     *
     * Pauses playback first: a manual scrub is the user taking over from
     * autoplay, and continuing to advance the position out from under a drag
     * is what makes a scrubber feel like it is fighting the finger on it.
     */
    fun seek(position: Ticks) {
        val duration = _state.value.project?.duration ?: Ticks.ZERO
        val clamped = position.coerceIn(Ticks.ZERO, duration)
        previewPlayer.pause()
        previewPlayer.seekTo(clamped)
        _state.value = _state.value.copy(playhead = clamped)
    }

    /** The bottom-centre play/pause control on the preview. */
    fun togglePlayPause() {
        previewPlayer.togglePlayPause()
    }

    fun selectClip(clipId: String?) {
        _state.value = _state.value.copy(
            selectedClipId = clipId,
            // A panel about a clip has nothing to show once the clip is
            // deselected, so it closes rather than lingering over nothing.
            openPanel = if (clipId == null) null else _state.value.openPanel,
        )
    }

    fun splitAtPlayhead() {
        val playhead = _state.value.playhead
        apply("Split clip") { it.splitAllTracksAt(ids, playhead) }
    }

    fun deleteSelected() {
        val clipId = _state.value.selectedClipId ?: return
        apply("Delete clip") { it.deleteClip(clipId) }
        selectClip(null)
    }

    fun rippleDeleteSelected() {
        val clipId = _state.value.selectedClipId ?: return
        apply("Delete clip and close gap") { it.rippleDeleteClip(clipId) }
        selectClip(null)
    }

    fun duplicateSelected() {
        val clipId = _state.value.selectedClipId ?: return
        apply("Duplicate clip") { it.duplicateClip(ids, clipId) }
    }

    /** Coalesced: a slider drag is one undoable step, not sixty. */
    fun setSelectedSpeed(speed: Float) {
        val clipId = _state.value.selectedClipId ?: return
        apply("Change speed", coalesce = true) { it.setClipSpeed(clipId, speed) }
    }

    fun setSelectedVolume(volume: Float) {
        val clipId = _state.value.selectedClipId ?: return
        apply("Change volume", coalesce = true) { it.setClipVolume(clipId, volume) }
    }

    fun setSelectedPan(pan: Float) {
        val clipId = _state.value.selectedClipId ?: return
        apply("Change balance", coalesce = true) { it.setClipPan(clipId, pan) }
    }

    fun setSelectedFadeIn(duration: Ticks) {
        val clipId = _state.value.selectedClipId ?: return
        apply("Change fade in", coalesce = true) { it.setClipFadeIn(clipId, duration) }
    }

    fun setSelectedFadeOut(duration: Ticks) {
        val clipId = _state.value.selectedClipId ?: return
        apply("Change fade out", coalesce = true) { it.setClipFadeOut(clipId, duration) }
    }

    fun setTrackLocked(trackId: String, locked: Boolean) {
        apply(if (locked) "Lock track" else "Unlock track") { it.setTrackLocked(trackId, locked) }
    }

    fun setTrackMuted(trackId: String, muted: Boolean) {
        apply(if (muted) "Mute track" else "Unmute track") { it.setTrackMuted(trackId, muted) }
    }

    fun addTrack(kind: TrackKind) {
        val project = _state.value.project ?: return
        val policy = _state.value.deviceProfile?.effectivePolicy
        val action = { apply("Add track") { it.addTrack(ids, kind) } }

        // A soft limit: the user is warned, never blocked. The PRD is explicit
        // that a weak device gets warnings and safer defaults, not a smaller
        // feature set.
        if (policy != null && project.tracks.size >= policy.softTrackLimit) {
            warnThenRun(HeavyOperation.MANY_LAYERS, policy.deviceClass, action)
        } else {
            action()
        }
    }

    /**
     * Runs [action] immediately if this warning was suppressed for the device, or
     * shows the Limited Resources dialog first.
     *
     * The suppression check is a DataStore read, which is asynchronous, so this
     * always takes at least one coroutine hop even when the answer turns out to
     * be "run it now" — a heavy operation is never so time-critical that this
     * costs anything perceptible.
     */
    private fun warnThenRun(
        operation: HeavyOperation,
        deviceClass: DeviceClass,
        action: () -> Unit,
    ) {
        viewModelScope.launch {
            val suppressed = preferences.isSuppressed(operation).first()
            if (suppressed) {
                action()
            } else {
                _state.value = _state.value.copy(
                    warning = LowResourceWarning(operation, deviceClass),
                    pendingAction = action,
                    suppressWarningChecked = false,
                )
            }
        }
    }

    // --- transform and keyframes --------------------------------------------

    /**
     * Moves a property's value at the playhead.
     *
     * Coalesced, so a drag is one undoable step. The engine decides whether that
     * writes a keyframe or the static value, which keeps every surface that
     * edits a property behaving identically.
     */
    fun setProperty(property: AnimatableProperty, value: Float) {
        val clipId = _state.value.selectedClipId ?: return
        val at = _state.value.playhead
        apply("Change ${property.displayName.lowercase()}", coalesce = true) {
            it.setPropertyValue(clipId, property, at, value)
        }
    }

    /**
     * Adds a keyframe at the playhead, or removes the one already there.
     *
     * One button for both directions because the diamond shows which it will do,
     * and a separate "remove keyframe" control would be a second thing to find.
     */
    fun toggleKeyframe(property: AnimatableProperty) {
        val clipId = _state.value.selectedClipId ?: return
        val clip = _state.value.project?.clip(clipId) ?: return
        val at = _state.value.playhead
        val timeInClip = (at - clip.timelineStart).coerceAtLeast(Ticks.ZERO)

        if (clip.track(property).keyframeAt(timeInClip) != null) {
            apply("Remove animation point") { it.removeKeyframe(clipId, property, at) }
        } else {
            apply("Add animation point") { it.addKeyframe(clipId, property, at) }
        }
    }

    fun clearProperty(property: AnimatableProperty) {
        val clipId = _state.value.selectedClipId ?: return
        apply("Stop animating ${property.displayName.lowercase()}") {
            it.clearKeyframes(clipId, property)
        }
    }

    fun showPanel(panel: EditorPanel?) {
        _state.value = _state.value.copy(openPanel = panel)
    }

    // --- markers ---------------------------------------------------------

    /** Adds a marker at the playhead. The no-selection toolbar's "Add Marker" button. */
    fun addMarkerAtPlayhead() {
        val at = _state.value.playhead
        apply("Add marker") { it.addMarker(ids, at) }
    }

    fun renameMarker(markerId: String, name: String, note: String) {
        apply("Rename marker") { it.renameMarker(markerId, name, note) }
    }

    fun removeMarker(markerId: String) {
        apply("Delete marker") { it.removeMarker(markerId) }
    }

    // --- media import --------------------------------------------------------

    /**
     * Imports picked media and places it on a matching track.
     *
     * Unreadable files are skipped and counted rather than aborting the batch,
     * so one corrupt video in a multi-select does not lose the other nine.
     */
    fun importMedia(uris: List<Uri>, atPlayhead: Boolean) {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            _state.value = _state.value.copy(isImporting = true)
            var skipped = 0

            for (uri in uris) {
                val ref = importer.import(uri, "media-${UUID.randomUUID()}")
                if (ref == null) {
                    skipped++
                    continue
                }
                val playhead = _state.value.playhead
                apply("Add media") { project ->
                    val withMedia = project.addMedia(ref)
                    val trackKind = if (ref.kind == MediaKind.AUDIO) TrackKind.AUDIO else TrackKind.VIDEO
                    val track = withMedia.tracks.firstOrNull { it.kind == trackKind && !it.locked }
                        ?: return@apply withMedia
                    val clip = createClip(ids, ref)
                    if (atPlayhead) {
                        withMedia.insertClipAt(track.id, clip, playhead)
                    } else {
                        withMedia.appendClip(track.id, clip)
                    }
                }
            }

            _state.value = _state.value.copy(
                isImporting = false,
                message = when {
                    skipped == 0 -> null
                    skipped == uris.size -> "None of those files could be read. They may be in a " +
                        "format this device does not support."
                    else -> "$skipped of ${uris.size} files could not be read and were skipped."
                },
            )
        }
    }

    fun importIntent() = importer.pickIntent()

    // --- missing media relink --------------------------------------------

    /**
     * Relinks [mediaId] to a file the user just picked to replace a moved or
     * deleted one.
     *
     * The count in [EditorUiState.missingMediaCount] is recomputed from the
     * document, not decremented by hand, so it cannot drift out of sync with
     * what the banner is actually counting.
     */
    fun relinkMedia(mediaId: String, uri: Uri) {
        val uriString = importer.preparePersistableUri(uri)
        apply("Relink media") { it.relinkMedia(mediaId, uriString) }
        val project = _state.value.project ?: return
        _state.value = _state.value.copy(missingMediaCount = project.media.count { !it.available })
    }

    /** The media the relink dialog should offer, unavailable ones first. */
    fun missingMedia() = _state.value.project?.media?.filter { !it.available }.orEmpty()

    // --- recovery and warnings ----------------------------------------------

    /** Accepts the "Restore last session?" offer. */
    fun acceptRecovery() {
        val recovered = pendingRecovery ?: return
        history = History.of(recovered)
        pendingRecovery = null
        _state.value = _state.value.copy(recoveryAvailable = false)
        publish()
    }

    fun declineRecovery() {
        pendingRecovery = null
        _state.value = _state.value.copy(recoveryAvailable = false)
    }

    fun dismissWarningAndContinue() {
        val warning = _state.value.warning
        val action = _state.value.pendingAction
        val suppress = _state.value.suppressWarningChecked

        _state.value = _state.value.copy(warning = null, pendingAction = null, suppressWarningChecked = false)
        action?.invoke()

        // Persisted after the action runs, not before: if the app died mid-action
        // for some unrelated reason, the warning should still be there next time
        // rather than silently suppressed for something that never completed.
        if (suppress && warning != null) {
            viewModelScope.launch { preferences.setSuppressed(warning.operation, true) }
        }
    }

    fun dismissWarning() {
        _state.value = _state.value.copy(warning = null, pendingAction = null, suppressWarningChecked = false)
    }

    fun setSuppressWarningChecked(checked: Boolean) {
        _state.value = _state.value.copy(suppressWarningChecked = checked)
    }

    fun useSaferSettings() {
        val profile = _state.value.deviceProfile ?: return
        _state.value = _state.value.copy(
            deviceProfile = profile.copy(userOverride = profile.effectivePolicy.safer()),
            warning = null,
            pendingAction = null,
        )
    }

    fun clearMessage() {
        _state.value = _state.value.copy(message = null)
    }

    /** Called when the editor goes to the background: there may be no next moment. */
    fun flush() {
        viewModelScope.launch { autoSave.flush() }
    }

    override fun onCleared() {
        super.onCleared()
        viewModelScope.launch { autoSave.commit() }
        previewPlayer.release()
    }

    private companion object {
        /** ~30 times a second: smooth for a scrubber indicator, cheap when idle. */
        const val POSITION_POLL_INTERVAL_MS = 33L
    }
}

data class EditorUiState(
    val project: Project? = null,
    val isLoading: Boolean = true,
    val isImporting: Boolean = false,
    val playhead: Ticks = Ticks.ZERO,
    val selectedClipId: String? = null,
    val canUndo: Boolean = false,
    val canRedo: Boolean = false,
    val undoLabel: String? = null,
    val redoLabel: String? = null,
    val deviceProfile: DeviceProfile? = null,
    val recoveryAvailable: Boolean = false,
    val missingMediaCount: Int = 0,
    val warning: LowResourceWarning? = null,
    val pendingAction: (() -> Unit)? = null,
    val suppressWarningChecked: Boolean = false,
    val message: String? = null,
    val openPanel: EditorPanel? = null,
    val isPreviewPlaying: Boolean = false,
    val previewError: String? = null,
) {
    val selectedClip get() = selectedClipId?.let { project?.clip(it) }
    val hasSelection get() = selectedClip != null
}

/** Which tool panel is open. Null means none, and the timeline gets the space. */
enum class EditorPanel { TRANSFORM, AUDIO, SPEED, COLOR }
