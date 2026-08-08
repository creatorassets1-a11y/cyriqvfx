package com.apexedits.feature.editor

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.apexedits.core.data.AutoSave
import com.apexedits.core.data.MediaImporter
import com.apexedits.core.data.ProjectDatabase
import com.apexedits.core.data.ProjectStore
import com.apexedits.core.device.DeviceProfile
import com.apexedits.core.device.HeavyOperation
import com.apexedits.core.device.LowResourceWarning
import com.apexedits.core.engine.edit.addKeyframe
import com.apexedits.core.engine.edit.addTrack
import com.apexedits.core.engine.edit.clearKeyframes
import com.apexedits.core.engine.edit.removeKeyframe
import com.apexedits.core.engine.edit.setPropertyValue
import com.apexedits.core.engine.edit.addMedia
import com.apexedits.core.engine.edit.appendClip
import com.apexedits.core.engine.edit.deleteClip
import com.apexedits.core.engine.edit.duplicateClip
import com.apexedits.core.engine.edit.insertClipAt
import com.apexedits.core.engine.edit.rippleDeleteClip
import com.apexedits.core.engine.edit.setClipSpeed
import com.apexedits.core.engine.edit.setClipVolume
import com.apexedits.core.engine.edit.setTrackLocked
import com.apexedits.core.engine.edit.setTrackMuted
import com.apexedits.core.engine.edit.splitAllTracksAt
import com.apexedits.core.engine.history.History
import com.apexedits.core.model.AnimatableProperty
import com.apexedits.core.model.CountingIdSource
import com.apexedits.core.model.IdSource
import com.apexedits.core.model.MediaKind
import com.apexedits.core.model.Project
import com.apexedits.core.model.Ticks
import com.apexedits.core.model.TrackKind
import com.apexedits.core.model.createClip
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
class EditorViewModel(
    application: Application,
    private val projectId: String,
) : AndroidViewModel(application) {

    private val database = ProjectDatabase.get(application)
    private val store = ProjectStore(application, database.projectDao())
    private val importer = MediaImporter(application)
    private val autoSave = AutoSave(store, viewModelScope)

    private val ids: IdSource = CountingIdSource(System.currentTimeMillis())

    private val _state = MutableStateFlow(EditorUiState())
    val state: StateFlow<EditorUiState> = _state.asStateFlow()

    private var history: History? = null

    init {
        autoSave.start()
        load()
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
    }

    fun undo() {
        history = history?.undo()
        publish()
    }

    fun redo() {
        history = history?.redo()
        publish()
    }

    fun seek(position: Ticks) {
        val duration = _state.value.project?.duration ?: Ticks.ZERO
        _state.value = _state.value.copy(playhead = position.coerceIn(Ticks.ZERO, duration))
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

    fun setTrackLocked(trackId: String, locked: Boolean) {
        apply(if (locked) "Lock track" else "Unlock track") { it.setTrackLocked(trackId, locked) }
    }

    fun setTrackMuted(trackId: String, muted: Boolean) {
        apply(if (muted) "Mute track" else "Unmute track") { it.setTrackMuted(trackId, muted) }
    }

    fun addTrack(kind: TrackKind) {
        val project = _state.value.project ?: return
        val policy = _state.value.deviceProfile?.effectivePolicy

        // A soft limit: the user is warned, never blocked. The PRD is explicit
        // that a weak device gets warnings and safer defaults, not a smaller
        // feature set.
        if (policy != null && project.tracks.size >= policy.softTrackLimit) {
            _state.value = _state.value.copy(
                warning = LowResourceWarning(HeavyOperation.MANY_LAYERS, policy.deviceClass),
                pendingAction = { apply("Add track") { it.addTrack(ids, kind) } },
            )
            return
        }
        apply("Add track") { it.addTrack(ids, kind) }
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
        val action = _state.value.pendingAction
        _state.value = _state.value.copy(warning = null, pendingAction = null)
        action?.invoke()
    }

    fun dismissWarning() {
        _state.value = _state.value.copy(warning = null, pendingAction = null)
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
    val message: String? = null,
    val openPanel: EditorPanel? = null,
) {
    val selectedClip get() = selectedClipId?.let { project?.clip(it) }
    val hasSelection get() = selectedClip != null
}

/** Which tool panel is open. Null means none, and the timeline gets the space. */
enum class EditorPanel { TRANSFORM }
