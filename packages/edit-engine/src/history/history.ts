import type { EditDocument } from '../model/types.js';

/**
 * Undo/redo.
 *
 * Because documents are immutable and structurally shared, an entry is just a
 * reference to a previous document — no patch computation, no inverse
 * operations to keep correct. The memory cost of an entry is the size of the
 * objects the edit actually replaced, which is why unlimited undo is
 * affordable on a phone.
 *
 * Two behaviours make this feel right in a touch UI:
 *
 *   - Coalescing: a continuous gesture (dragging a clip, scrubbing a slider)
 *     produces one undo entry, not one per frame of the drag.
 *   - Snapshots: named restore points the user can jump back to from the
 *     project history sheet, independent of the undo cursor.
 */

export interface HistoryEntry {
  readonly label: string;
  readonly document: EditDocument;
  readonly at: number;
  /** Gesture id; consecutive entries sharing one are merged. */
  readonly coalesceKey?: string;
}

export interface Snapshot {
  readonly id: string;
  readonly name: string;
  readonly document: EditDocument;
  readonly at: number;
  readonly auto: boolean;
}

export interface HistoryState {
  readonly past: readonly HistoryEntry[];
  readonly present: EditDocument;
  readonly future: readonly HistoryEntry[];
  readonly snapshots: readonly Snapshot[];
  /** 0 disables the cap; the default keeps memory bounded on long sessions. */
  readonly limit: number;
}

export const DEFAULT_HISTORY_LIMIT = 500;

export function createHistory(
  document: EditDocument,
  limit = DEFAULT_HISTORY_LIMIT,
): HistoryState {
  return { past: [], present: document, future: [], snapshots: [], limit };
}

export interface CommitOptions {
  /**
   * Consecutive commits with the same key collapse into one entry. Pass the
   * gesture's id while a drag is in flight and drop it when the finger lifts.
   */
  readonly coalesceKey?: string;
  /** Record the change without making it undoable — used for view-only state. */
  readonly transient?: boolean;
}

/** Record a new document state. */
export function commit(
  state: HistoryState,
  document: EditDocument,
  label: string,
  opts: CommitOptions = {},
): HistoryState {
  if (document === state.present) return state;
  if (opts.transient) return { ...state, present: document };

  const last = state.past[state.past.length - 1];
  const canCoalesce =
    opts.coalesceKey !== undefined &&
    last !== undefined &&
    last.coalesceKey === opts.coalesceKey;

  // When coalescing, the entry already holds the document from before the
  // gesture started, so we keep it and only advance the present.
  const past = canCoalesce
    ? state.past
    : trim(
        [
          ...state.past,
          { label, document: state.present, at: Date.now(), coalesceKey: opts.coalesceKey },
        ],
        state.limit,
      );

  return { ...state, past, present: document, future: [] };
}

function trim(entries: HistoryEntry[], limit: number): HistoryEntry[] {
  if (limit <= 0 || entries.length <= limit) return entries;
  return entries.slice(entries.length - limit);
}

export const canUndo = (state: HistoryState): boolean => state.past.length > 0;
export const canRedo = (state: HistoryState): boolean => state.future.length > 0;

/** Label of the change undo would reverse, for the button's accessibility name. */
export const undoLabel = (state: HistoryState): string | null =>
  state.past[state.past.length - 1]?.label ?? null;

export const redoLabel = (state: HistoryState): string | null =>
  state.future[state.future.length - 1]?.label ?? null;

export function undo(state: HistoryState): HistoryState {
  const entry = state.past[state.past.length - 1];
  if (!entry) return state;
  return {
    ...state,
    past: state.past.slice(0, -1),
    present: entry.document,
    future: [...state.future, { ...entry, document: state.present }],
  };
}

export function redo(state: HistoryState): HistoryState {
  const entry = state.future[state.future.length - 1];
  if (!entry) return state;
  return {
    ...state,
    past: [...state.past, { ...entry, document: state.present }],
    present: entry.document,
    future: state.future.slice(0, -1),
  };
}

/** Undo repeatedly back to a specific entry, for the history list UI. */
export function undoTo(state: HistoryState, index: number): HistoryState {
  let out = state;
  while (out.past.length > index && canUndo(out)) out = undo(out);
  return out;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export function takeSnapshot(
  state: HistoryState,
  name: string,
  opts: { auto?: boolean; id?: string; keep?: number } = {},
): HistoryState {
  const snapshot: Snapshot = {
    id: opts.id ?? `snap_${Date.now().toString(36)}`,
    name,
    document: state.present,
    at: Date.now(),
    auto: opts.auto ?? false,
  };

  let snapshots = [...state.snapshots, snapshot];
  const keep = opts.keep ?? 0;
  if (keep > 0) {
    // Auto-snapshots are pruned oldest-first; ones the user named are kept.
    const autos = snapshots.filter((s) => s.auto);
    if (autos.length > keep) {
      const drop = new Set(autos.slice(0, autos.length - keep).map((s) => s.id));
      snapshots = snapshots.filter((s) => !drop.has(s.id));
    }
  }
  return { ...state, snapshots };
}

/**
 * Restore a snapshot. This is itself an undoable change, so a user who restores
 * by mistake gets back to where they were with one undo.
 */
export function restoreSnapshot(state: HistoryState, snapshotId: string): HistoryState {
  const snapshot = state.snapshots.find((s) => s.id === snapshotId);
  if (!snapshot) return state;
  return commit(state, snapshot.document, `Restore “${snapshot.name}”`);
}

export function deleteSnapshot(state: HistoryState, snapshotId: string): HistoryState {
  return { ...state, snapshots: state.snapshots.filter((s) => s.id !== snapshotId) };
}
