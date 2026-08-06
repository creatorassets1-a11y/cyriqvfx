package com.apexedit.editor.core

/**
 * Undo/redo.
 *
 * Documents are immutable with structural sharing, so an entry is a reference
 * rather than a copy — editing one clip leaves the other two hundred as the
 * same objects in memory. That is what makes unlimited undo affordable on a
 * phone.
 *
 * Coalescing is what makes it feel right under a finger: a drag emitting sixty
 * positions a second produces one undo entry, not sixty.
 */
data class HistoryEntry(
    val label: String,
    val document: EditDocument,
    val coalesceKey: String? = null,
)

data class History(
    val past: List<HistoryEntry> = emptyList(),
    val present: EditDocument,
    val future: List<HistoryEntry> = emptyList(),
    /** Keeps memory bounded on a long session. */
    val limit: Int = 300,
) {
    val canUndo: Boolean get() = past.isNotEmpty()
    val canRedo: Boolean get() = future.isNotEmpty()
    val undoLabel: String? get() = past.lastOrNull()?.label
    val redoLabel: String? get() = future.lastOrNull()?.label

    /**
     * Record a new state. Pass a [coalesceKey] while a gesture is in flight and
     * drop it when the finger lifts.
     */
    fun commit(next: EditDocument, label: String, coalesceKey: String? = null): History {
        if (next === present) return this

        val last = past.lastOrNull()
        val coalesces = coalesceKey != null && last?.coalesceKey == coalesceKey

        // When coalescing, the existing entry already holds the pre-gesture
        // document, so it is kept and only the present advances.
        val newPast = if (coalesces) {
            past
        } else {
            (past + HistoryEntry(label, present, coalesceKey)).let {
                if (limit > 0 && it.size > limit) it.takeLast(limit) else it
            }
        }
        return copy(past = newPast, present = next, future = emptyList())
    }

    fun undo(): History {
        val entry = past.lastOrNull() ?: return this
        return copy(
            past = past.dropLast(1),
            present = entry.document,
            future = future + entry.copy(document = present),
        )
    }

    fun redo(): History {
        val entry = future.lastOrNull() ?: return this
        return copy(
            past = past + entry.copy(document = present),
            present = entry.document,
            future = future.dropLast(1),
        )
    }
}
