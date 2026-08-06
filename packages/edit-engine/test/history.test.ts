import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  deleteSnapshot,
  redo,
  redoLabel,
  restoreSnapshot,
  splitClip,
  takeSnapshot,
  undo,
  undoLabel,
  undoTo,
  updateClip,
} from '../src/index.js';
import { f, fixture, layout, place } from './helpers.js';

describe('undo and redo', () => {
  it('starts with nothing to undo', () => {
    const fx = fixture();
    const history = createHistory(fx.doc);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it('restores the previous document', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    let history = createHistory(doc);
    history = commit(history, splitClip(doc, id, f(50)), 'Split');

    expect(layout(history.present, fx.v1)).toHaveLength(2);
    history = undo(history);
    expect(layout(history.present, fx.v1)).toHaveLength(1);
    expect(history.present).toBe(doc);
  });

  it('redoes what it undid', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    let history = createHistory(doc);
    const split = splitClip(doc, id, f(50));
    history = commit(history, split, 'Split');
    history = redo(undo(history));
    expect(history.present).toBe(split);
  });

  it('drops the redo stack once a new edit lands', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    let history = createHistory(doc);
    history = commit(history, splitClip(doc, id, f(50)), 'Split');
    history = undo(history);
    expect(canRedo(history)).toBe(true);

    history = commit(history, splitClip(history.present, id, f(25)), 'Split again');
    expect(canRedo(history)).toBe(false);
  });

  it('surfaces labels for the undo and redo affordances', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    let history = createHistory(doc);
    history = commit(history, splitClip(doc, id, f(50)), 'Split clip');
    expect(undoLabel(history)).toBe('Split clip');
    history = undo(history);
    expect(redoLabel(history)).toBe('Split clip');
  });

  it('ignores a commit that did not change anything', () => {
    const fx = fixture();
    const history = createHistory(fx.doc);
    expect(commit(history, fx.doc, 'No-op')).toBe(history);
  });

  it('walks back several steps at once', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 100);
    let history = createHistory(doc);
    for (let i = 1; i <= 4; i++) {
      const id = history.present.trackClips[fx.v1][0];
      history = commit(history, updateClip(history.present, id, { colorTag: `c${i}` }), `Tag ${i}`);
    }
    expect(history.past).toHaveLength(4);
    history = undoTo(history, 1);
    expect(history.past).toHaveLength(1);
  });
});

describe('coalescing', () => {
  it('collapses one gesture into a single undo entry', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    let history = createHistory(doc);

    // Simulate a drag emitting a position every frame.
    for (let frame = 1; frame <= 20; frame++) {
      history = commit(
        history,
        updateClip(history.present, id, { start: f(frame) }),
        'Move clip',
        { coalesceKey: 'drag-1' },
      );
    }

    expect(history.past).toHaveLength(1);
    expect(layout(history.present, fx.v1)).toEqual([[20, 100]]);

    // One undo returns to where the drag started.
    history = undo(history);
    expect(layout(history.present, fx.v1)).toEqual([[0, 100]]);
  });

  it('separates two gestures', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    let history = createHistory(doc);
    history = commit(history, updateClip(doc, id, { start: f(10) }), 'Move', { coalesceKey: 'a' });
    history = commit(history, updateClip(history.present, id, { start: f(20) }), 'Move', {
      coalesceKey: 'b',
    });
    expect(history.past).toHaveLength(2);
  });

  it('does not record a transient change', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    let history = createHistory(doc);
    history = commit(history, updateClip(doc, id, { colorTag: 'x' }), 'Tag', { transient: true });
    expect(canUndo(history)).toBe(false);
  });
});

describe('limit', () => {
  it('discards the oldest entries past the cap', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    let history = createHistory(doc, 5);
    for (let i = 1; i <= 20; i++) {
      history = commit(history, updateClip(history.present, id, { colorTag: `c${i}` }), `Tag ${i}`);
    }
    expect(history.past).toHaveLength(5);
    // Only the five most recent survive: Tag 16 through Tag 20.
    expect(history.past[0].label).toBe('Tag 16');
    expect(history.past[4].label).toBe('Tag 20');
  });
});

describe('snapshots', () => {
  it('captures and restores a named state', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    let history = createHistory(doc);
    history = takeSnapshot(history, 'Rough cut', { id: 'snap1' });

    history = commit(history, splitClip(history.present, id, f(50)), 'Split');
    expect(layout(history.present, fx.v1)).toHaveLength(2);

    history = restoreSnapshot(history, 'snap1');
    expect(layout(history.present, fx.v1)).toHaveLength(1);
  });

  it('makes a restore itself undoable', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    let history = createHistory(doc);
    history = takeSnapshot(history, 'Start', { id: 'snap1' });
    history = commit(history, splitClip(history.present, id, f(50)), 'Split');
    const afterSplit = history.present;

    history = restoreSnapshot(history, 'snap1');
    history = undo(history);
    expect(history.present).toBe(afterSplit);
  });

  it('prunes automatic snapshots but keeps named ones', () => {
    const fx = fixture();
    let history = createHistory(fx.doc);
    history = takeSnapshot(history, 'Named', { id: 'kept' });
    for (let i = 0; i < 10; i++) {
      history = takeSnapshot(history, `Auto ${i}`, { id: `auto${i}`, auto: true, keep: 3 });
    }
    expect(history.snapshots.filter((s) => s.auto)).toHaveLength(3);
    expect(history.snapshots.some((s) => s.id === 'kept')).toBe(true);
  });

  it('deletes a snapshot', () => {
    const fx = fixture();
    let history = takeSnapshot(createHistory(fx.doc), 'One', { id: 's1' });
    history = deleteSnapshot(history, 's1');
    expect(history.snapshots).toHaveLength(0);
  });
});

describe('structural sharing', () => {
  it('reuses untouched clips across history entries, keeping undo cheap', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 50);
    const untouched = place({ ...fx, doc }, fx.v2, 0, 50);
    doc = untouched.doc;

    const edited = updateClip(doc, doc.trackClips[fx.v1][0], { colorTag: 'red' });

    // The clip on the other track is the very same object, not a copy.
    expect(edited.clips[untouched.id]).toBe(doc.clips[untouched.id]);
    expect(edited.tracks).toBe(doc.tracks);
  });
});
