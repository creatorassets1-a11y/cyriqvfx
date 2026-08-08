package com.apexedits.core.data

import com.apexedits.core.model.Project
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach

/**
 * Auto-save.
 *
 * The PRD asks for a save every few seconds and a "Restore last session?" prompt
 * after a crash. Writing on every mutation would mean a file write per frame of
 * a slider drag, so edits are debounced: the document settles for
 * [QUIET_PERIOD_MS] before it is written.
 *
 * Deduplication is by `revision` rather than by document equality. The revision
 * counter only advances when an operation actually changed something — a trim
 * that clamped to a no-op leaves it alone — so this skips writes that would
 * produce a byte-identical file, without paying for a deep comparison of the
 * timeline on every emission.
 */
class AutoSave(
    private val store: ProjectStore,
    private val scope: CoroutineScope,
) {
    private val pending = MutableStateFlow<Project?>(null)

    /** Set when a write fails, so the editor can surface it rather than losing work silently. */
    val lastError = MutableStateFlow<Throwable?>(null)

    @OptIn(FlowPreview::class)
    fun start() {
        pending
            .filterNotNull()
            .distinctUntilChangedBy { it.revision }
            .debounce(QUIET_PERIOD_MS)
            .onEach { project ->
                runCatching { store.autosave(project) }
                    .onFailure { lastError.value = it }
                    .onSuccess { lastError.value = null }
            }
            .launchIn(scope)
    }

    /** Records the latest document. Cheap: it only sets a reference. */
    fun record(project: Project) {
        pending.value = project
    }

    /**
     * Writes immediately, bypassing the debounce.
     *
     * Called when the editor goes to the background: there may be no next
     * moment, so the debounce window is a window in which work is lost.
     */
    suspend fun flush() {
        val project = pending.value ?: return
        runCatching { store.autosave(project) }.onFailure { lastError.value = it }
    }

    /** Promotes the autosave to the saved document. Clean close. */
    suspend fun commit() {
        val project = pending.value ?: return
        runCatching {
            store.commit(project)
            store.markOpen(project.id, open = false)
        }.onFailure { lastError.value = it }
    }

    companion object {
        /**
         * Two seconds of quiet. Long enough that a drag writes once at the end
         * rather than sixty times during, short enough that little is at risk if
         * the process dies.
         */
        const val QUIET_PERIOD_MS = 2_000L
    }
}
