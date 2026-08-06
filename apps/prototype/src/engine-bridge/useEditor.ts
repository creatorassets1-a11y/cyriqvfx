import { useCallback, useMemo, useRef, useState } from 'react';
import {
  canRedo,
  canUndo,
  commit,
  createDocument,
  createHistory,
  documentDuration,
  redo,
  roundToFrame,
  takeSnapshot,
  undo,
  type EditDocument,
  type HistoryState,
  type Id,
  type Ticks,
} from '@apex/edit-engine';

/**
 * Editor state.
 *
 * The document lives in a history stack; everything else here is view state
 * that must survive an undo — selection, playhead, zoom, which panel is open.
 * Keeping the two separate is what lets undo restore the timeline without
 * yanking the user's viewport around.
 */

export type EditorMode = 'simple' | 'pro';

export type ToolPanel =
  | null
  | 'transform'
  | 'speed'
  | 'color'
  | 'audio'
  | 'text'
  | 'effects'
  | 'captions'
  | 'ai'
  | 'export';

export interface EditorState {
  history: HistoryState;
  selection: readonly Id[];
  playhead: Ticks;
  /** Pixels per second at the current timeline zoom. */
  zoom: number;
  mode: EditorMode;
  panel: ToolPanel;
  playing: boolean;
  snapping: boolean;
  rippleMode: boolean;
}

const DEFAULT_ZOOM = 60;
export const MIN_ZOOM = 4;
/** 30× the default is the PRD's precision-zoom target. */
export const MAX_ZOOM = DEFAULT_ZOOM * 30;

export function useEditor(initial?: EditDocument) {
  const [state, setState] = useState<EditorState>(() => ({
    history: createHistory(initial ?? createDocument({ name: 'Untitled', aspectRatio: '9:16' })),
    selection: [],
    playhead: 0,
    zoom: DEFAULT_ZOOM,
    mode: 'simple',
    panel: null,
    playing: false,
    snapping: true,
    rippleMode: false,
  }));

  const doc = state.history.present;
  const duration = useMemo(() => documentDuration(doc), [doc]);

  /**
   * Apply an edit and record it.
   *
   * `coalesceKey` folds a continuous gesture into one undo entry — pass the
   * gesture's id while a drag is live and omit it when the finger lifts.
   */
  const apply = useCallback(
    (
      mutate: (doc: EditDocument) => EditDocument,
      label: string,
      opts: { coalesceKey?: string } = {},
    ) => {
      setState((prev) => {
        const next = mutate(prev.history.present);
        if (next === prev.history.present) return prev;
        return { ...prev, history: commit(prev.history, next, label, opts) };
      });
    },
    [],
  );

  const doUndo = useCallback(() => {
    setState((prev) => {
      if (!canUndo(prev.history)) return prev;
      // Drop any selection the undone edit may have invalidated.
      const history = undo(prev.history);
      return { ...prev, history, selection: prev.selection.filter((id) => history.present.clips[id]) };
    });
  }, []);

  const doRedo = useCallback(() => {
    setState((prev) => {
      if (!canRedo(prev.history)) return prev;
      const history = redo(prev.history);
      return { ...prev, history, selection: prev.selection.filter((id) => history.present.clips[id]) };
    });
  }, []);

  const snapshot = useCallback((name: string) => {
    setState((prev) => ({ ...prev, history: takeSnapshot(prev.history, name) }));
  }, []);

  const setPlayhead = useCallback((time: Ticks) => {
    setState((prev) => {
      const rate = prev.history.present.project.settings.frameRate;
      const clamped = Math.max(0, roundToFrame(time, rate));
      if (clamped === prev.playhead) return prev;
      return { ...prev, playhead: clamped };
    });
  }, []);

  const select = useCallback((ids: readonly Id[], additive = false) => {
    setState((prev) => ({
      ...prev,
      selection: additive ? [...new Set([...prev.selection, ...ids])] : ids,
      // Opening a clip's inspector for a different clip keeps the same panel.
      panel: ids.length === 0 ? null : prev.panel,
    }));
  }, []);

  const setZoom = useCallback((zoom: number | ((current: number) => number)) => {
    setState((prev) => {
      const next = typeof zoom === 'function' ? zoom(prev.zoom) : zoom;
      return { ...prev, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) };
    });
  }, []);

  const setPanel = useCallback((panel: ToolPanel) => {
    setState((prev) => ({ ...prev, panel: prev.panel === panel ? null : panel }));
  }, []);

  const setMode = useCallback((mode: EditorMode) => {
    setState((prev) => ({ ...prev, mode }));
  }, []);

  const setPlaying = useCallback((playing: boolean) => {
    setState((prev) => (prev.playing === playing ? prev : { ...prev, playing }));
  }, []);

  const toggleSnapping = useCallback(() => {
    setState((prev) => ({ ...prev, snapping: !prev.snapping }));
  }, []);

  const toggleRipple = useCallback(() => {
    setState((prev) => ({ ...prev, rippleMode: !prev.rippleMode }));
  }, []);

  const replaceDocument = useCallback((next: EditDocument, label: string) => {
    setState((prev) => ({
      ...prev,
      history: commit(prev.history, next, label),
      selection: [],
    }));
  }, []);

  const selectedClips = useMemo(
    () => state.selection.map((id) => doc.clips[id]).filter(Boolean),
    [state.selection, doc],
  );

  return {
    state,
    doc,
    duration,
    selectedClips,
    apply,
    undo: doUndo,
    redo: doRedo,
    canUndo: canUndo(state.history),
    canRedo: canRedo(state.history),
    snapshot,
    setPlayhead,
    select,
    setZoom,
    setPanel,
    setMode,
    setPlaying,
    toggleSnapping,
    toggleRipple,
    replaceDocument,
  };
}

export type Editor = ReturnType<typeof useEditor>;

/**
 * Haptics.
 *
 * The PRD asks for feedback on cut, keyframe and export. The web only offers a
 * coarse vibration API and only on some platforms, so this is a no-op where it
 * is unsupported rather than a feature gate — the native builds map these same
 * three intents onto the real haptic engines.
 */
export function haptic(intent: 'light' | 'medium' | 'success'): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  const patterns: Record<typeof intent, number | number[]> = {
    light: 8,
    medium: 16,
    success: [12, 40, 12],
  };
  try {
    navigator.vibrate(patterns[intent]);
  } catch {
    // Vibration is blocked without a user gesture in some browsers; ignore.
  }
}

/** Stable per-gesture id, for history coalescing across a drag. */
export function useGestureKey() {
  const counter = useRef(0);
  return useCallback(() => `gesture-${++counter.current}`, []);
}
