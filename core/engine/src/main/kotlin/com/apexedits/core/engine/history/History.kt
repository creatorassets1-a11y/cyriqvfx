package com.apexedits.core.engine.history

import com.apexedits.core.model.Project

/**
 * Undo/redo.
 *
 * Each entry holds a whole [Project]. That sounds expensive and is not: the
 * document is immutable with structural sharing, so an entry costs the handful
 * of objects the edit actually replaced and shares the rest with its neighbours.
 * A 200-deep stack over a 30-minute timeline is a few hundred small allocations,
 * not two hundred timelines.
 *
 * The alternative — storing inverse commands — needs every operation to know how
 * to undo itself, and the one that gets it subtly wrong corrupts the document in
 * a way that only shows up several undos later. Snapshots cannot drift.
 */
data class History(
    val present: Project,
    val past: List<Entry> = emptyList(),
    val future: List<Entry> = emptyList(),
    val limit: Int = DEFAULT_LIMIT,
) {
    data class Entry(val label: String, val project: Project)

    val canUndo: Boolean get() = past.isNotEmpty()
    val canRedo: Boolean get() = future.isNotEmpty()

    /** What the Undo button should say it will undo, for the tooltip. */
    val undoLabel: String? get() = past.lastOrNull()?.label

    /** What the Redo button should say it will redo. */
    val redoLabel: String? get() = future.lastOrNull()?.label

    /**
     * Records a new state under a human-readable [label] — "Split clip",
     * "Trim clip" — which the UI shows so Undo tells the user what it will
     * reverse instead of making them guess.
     *
     * A [next] identical to the present is dropped: operations that clamped to a
     * no-op must not fill the stack with entries that undo nothing.
     */
    fun push(label: String, next: Project): History {
        if (next == present) return this
        val grown = past + Entry(label, present)
        return copy(
            present = next,
            past = if (grown.size > limit) grown.takeLast(limit) else grown,
            // Any new edit abandons the redo branch, as everywhere else.
            future = emptyList(),
        )
    }

    /**
     * Coalesces with the previous entry when it carries the same [label].
     *
     * A slider drag emits a value per frame. Without this, one drag buries the
     * previous state under sixty identical-looking entries and Undo stops being
     * useful. With it, a drag is one undoable step.
     */
    fun pushCoalescing(label: String, next: Project): History {
        if (next == present) return this
        val previous = past.lastOrNull()
        return if (previous != null && previous.label == label) {
            copy(present = next, future = emptyList())
        } else {
            push(label, next)
        }
    }

    fun undo(): History {
        val entry = past.lastOrNull() ?: return this
        return copy(
            present = entry.project,
            past = past.dropLast(1),
            future = future + Entry(entry.label, present),
        )
    }

    fun redo(): History {
        val entry = future.lastOrNull() ?: return this
        return copy(
            present = entry.project,
            past = past + Entry(entry.label, present),
            future = future.dropLast(1),
        )
    }

    companion object {
        /**
         * The PRD asks for a deep stack. 200 is deep enough that no one reaches
         * the end in a session, and bounded so a long session cannot grow the
         * heap without limit on a 3 GB device.
         */
        const val DEFAULT_LIMIT = 200

        fun of(project: Project) = History(present = project)
    }
}
