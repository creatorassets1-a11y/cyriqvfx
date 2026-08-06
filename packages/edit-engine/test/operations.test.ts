import { describe, expect, it } from 'vitest';
import {
  appendClip,
  closeAllGaps,
  createClip,
  deleteRange,
  documentDuration,
  liftClips,
  linkClips,
  moveClip,
  overwriteClip,
  rippleDeleteClips,
  rollEdit,
  slideClip,
  slipClipBy,
  splitClip,
  trimClipEnd,
  trimClipStart,
  updateTrack,
} from '../src/index.js';
import { f, fixture, layout, mediaIns, place } from './helpers.js';

describe('split', () => {
  it('divides a clip and advances the second half into the media', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100, 30);
    const out = splitClip(doc, id, f(40));

    expect(layout(out, fx.v1)).toEqual([
      [0, 40],
      [40, 60],
    ]);
    // The second half starts 40 frames further into the source.
    expect(mediaIns(out, fx.v1)).toEqual([30, 70]);
  });

  it('refuses a cut at or outside the clip edges', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    expect(splitClip(doc, id, f(0))).toBe(doc);
    expect(splitClip(doc, id, f(100))).toBe(doc);
    expect(splitClip(doc, id, f(150))).toBe(doc);
  });

  it('leaves both halves with the full effect stack', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    const withEffect = {
      ...doc,
      clips: {
        ...doc.clips,
        [id]: {
          ...doc.clips[id],
          effects: [{ id: 'e1', type: 'glitch', enabled: true, params: { intensity: 0.5 } }],
        },
      },
    };
    const out = splitClip(withEffect, id, f(50));
    for (const clipId of out.trackClips[fx.v1]) {
      expect(out.clips[clipId].effects).toHaveLength(1);
    }
  });
});

describe('trim', () => {
  it('trims the head without moving the tail', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100, 50);
    const out = trimClipStart(doc, id, f(20));
    expect(layout(out, fx.v1)).toEqual([[20, 80]]);
    expect(mediaIns(out, fx.v1)).toEqual([70]);
  });

  it('will not trim past the start of the source media', () => {
    const fx = fixture();
    // mediaIn is 10, so the head can only move 10 frames earlier.
    const { doc, id } = place(fx, fx.v1, 100, 50, 10);
    const out = trimClipStart(doc, id, f(0));
    expect(layout(out, fx.v1)).toEqual([[90, 60]]);
    expect(mediaIns(out, fx.v1)).toEqual([0]);
  });

  it('will not extend the tail past the end of the source media', () => {
    const fx = fixture({ mediaFrames: 200 });
    // The clip shows source frames 150–180, so only 20 frames of tail remain.
    const { doc, id } = place(fx, fx.v1, 0, 30, 150);
    const out = trimClipEnd(doc, id, f(500));
    expect(layout(out, fx.v1)).toEqual([[0, 50]]);
  });

  it('stops the head at the previous clip unless rippling', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 50);
    const second = place({ ...fx, doc }, fx.v1, 60, 50, 30);
    doc = second.doc;

    const clamped = trimClipStart(doc, second.id, f(10));
    expect(layout(clamped, fx.v1)).toEqual([
      [0, 50],
      [50, 60],
    ]);
  });

  it('pulls later clips along when rippling the tail', () => {
    const fx = fixture();
    let { doc, id } = place(fx, fx.v1, 0, 50);
    const second = place({ ...fx, doc }, fx.v1, 50, 50);
    doc = second.doc;

    const out = trimClipEnd(doc, id, f(30), { ripple: true });
    expect(layout(out, fx.v1)).toEqual([
      [0, 30],
      [30, 50],
    ]);
  });

  it('never trims a clip below one frame', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    const out = trimClipEnd(doc, id, f(0));
    expect(layout(out, fx.v1)).toEqual([[0, 1]]);
  });
});

describe('roll', () => {
  it('moves the shared cut without changing total length', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 50, 100);
    const second = place({ ...fx, doc }, fx.v1, 50, 50, 200);
    doc = second.doc;
    const first = doc.trackClips[fx.v1][0];

    const before = documentDuration(doc);
    const out = rollEdit(doc, first, f(70));

    expect(layout(out, fx.v1)).toEqual([
      [0, 70],
      [70, 30],
    ]);
    expect(documentDuration(out)).toBe(before);
    // The incoming clip gave up 20 frames of head, so its media in advanced.
    expect(mediaIns(out, fx.v1)).toEqual([100, 220]);
  });

  it('does nothing across a gap', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 50);
    doc = place({ ...fx, doc }, fx.v1, 80, 50).doc;
    const first = doc.trackClips[fx.v1][0];
    expect(rollEdit(doc, first, f(60))).toBe(doc);
  });
});

describe('slip and slide', () => {
  it('slip changes the source range and nothing else', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 100, 50, 200);
    const out = slipClipBy(doc, id, f(25));
    expect(layout(out, fx.v1)).toEqual([[100, 50]]);
    expect(mediaIns(out, fx.v1)).toEqual([225]);
  });

  it('slip clamps at the ends of the source', () => {
    const fx = fixture({ mediaFrames: 100 });
    const { doc, id } = place(fx, fx.v1, 0, 50, 10);
    // Only 10 frames of headroom exist.
    expect(mediaIns(slipClipBy(doc, id, f(-999)), fx.v1)).toEqual([0]);
    // 100 - (10 + 50) = 40 frames of tailroom.
    expect(mediaIns(slipClipBy(doc, id, f(999)), fx.v1)).toEqual([50]);
  });

  it('slide moves the clip and absorbs the change into both neighbours', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 50, 100);
    doc = place({ ...fx, doc }, fx.v1, 50, 50, 100).doc;
    doc = place({ ...fx, doc }, fx.v1, 100, 50, 100).doc;
    const middle = doc.trackClips[fx.v1][1];

    const out = slideClip(doc, middle, f(10));
    expect(layout(out, fx.v1)).toEqual([
      [0, 60],
      [60, 50],
      [110, 40],
    ]);
    // The slid clip's own content is untouched.
    expect(out.clips[middle].mediaIn).toBe(f(100));
  });
});

describe('delete', () => {
  it('lift leaves a gap', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 50);
    const second = place({ ...fx, doc }, fx.v1, 50, 50);
    doc = second.doc;
    doc = place({ ...fx, doc }, fx.v1, 100, 50).doc;

    const out = liftClips(doc, [second.id]);
    expect(layout(out, fx.v1)).toEqual([
      [0, 50],
      [100, 50],
    ]);
  });

  it('ripple delete closes the gap', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 50);
    const second = place({ ...fx, doc }, fx.v1, 50, 50);
    doc = second.doc;
    doc = place({ ...fx, doc }, fx.v1, 100, 50).doc;

    const out = rippleDeleteClips(doc, [second.id]);
    expect(layout(out, fx.v1)).toEqual([
      [0, 50],
      [50, 50],
    ]);
  });

  it('ripple delete of several clips lands everything in the right place', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 20);
    const b = place({ ...fx, doc }, fx.v1, 20, 20);
    doc = b.doc;
    const c = place({ ...fx, doc }, fx.v1, 40, 20);
    doc = c.doc;
    doc = place({ ...fx, doc }, fx.v1, 60, 20).doc;

    const out = rippleDeleteClips(doc, [b.id, c.id]);
    expect(layout(out, fx.v1)).toEqual([
      [0, 20],
      [20, 20],
    ]);
  });

  it('ripple delete only touches the tracks it deleted from', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 50);
    const target = place({ ...fx, doc }, fx.v1, 50, 50);
    doc = target.doc;
    doc = place({ ...fx, doc }, fx.v2, 80, 40).doc;

    const out = rippleDeleteClips(doc, [target.id]);
    expect(layout(out, fx.v2)).toEqual([[80, 40]]);
  });

  it('deleteRange splits a clip that straddles the range', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.v1, 0, 100, 0);
    const out = deleteRange(doc, { start: f(30), duration: f(20) }, { trackIds: [fx.v1] });

    expect(layout(out, fx.v1)).toEqual([
      [0, 30],
      [50, 50],
    ]);
    expect(mediaIns(out, fx.v1)).toEqual([0, 50]);
  });

  it('deleteRange with ripple closes the hole it made', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.v1, 0, 100);
    const out = deleteRange(doc, { start: f(30), duration: f(20) }, {
      trackIds: [fx.v1],
      ripple: true,
    });
    expect(layout(out, fx.v1)).toEqual([
      [0, 30],
      [30, 50],
    ]);
  });
});

describe('move and overwrite', () => {
  it('overwrite trims what it lands on', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.v1, 0, 100);
    const incoming = createClip({
      trackId: fx.v1,
      start: f(80),
      duration: f(40),
      content: { kind: 'color', color: '#f00' },
    });
    const out = overwriteClip(doc, incoming);
    expect(layout(out, fx.v1)).toEqual([
      [0, 80],
      [80, 40],
    ]);
  });

  it('overwrite in the middle leaves a head and a tail', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.v1, 0, 100);
    const incoming = createClip({
      trackId: fx.v1,
      start: f(40),
      duration: f(20),
      content: { kind: 'color', color: '#f00' },
    });
    const out = overwriteClip(doc, incoming);
    expect(layout(out, fx.v1)).toEqual([
      [0, 40],
      [40, 20],
      [60, 40],
    ]);
  });

  it('append lands flush against the last clip', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.v1, 0, 50);
    const out = appendClip(
      doc,
      createClip({
        trackId: fx.v1,
        start: 0,
        duration: f(25),
        content: { kind: 'color', color: '#0f0' },
      }),
    );
    expect(layout(out, fx.v1)).toEqual([
      [0, 50],
      [50, 25],
    ]);
  });

  it('rejects a move onto a locked track', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 50);
    const locked = updateTrack(doc, fx.v2, { locked: true });
    expect(moveClip(locked, id, { trackId: fx.v2, start: f(0) })).toBe(locked);
  });

  it('reject policy refuses an overlapping move', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 50);
    const second = place({ ...fx, doc }, fx.v2, 0, 50);
    doc = second.doc;
    const out = moveClip(doc, second.id, { trackId: fx.v1, start: f(25), policy: 'reject' });
    expect(out).toBe(doc);
  });

  it('moves a clip between tracks', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 50);
    const out = moveClip(doc, id, { trackId: fx.v2, start: f(30) });
    expect(layout(out, fx.v1)).toEqual([]);
    expect(layout(out, fx.v2)).toEqual([[30, 50]]);
  });
});

describe('gaps', () => {
  it('closeAllGaps packs a track flush', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 10, 20);
    doc = place({ ...fx, doc }, fx.v1, 60, 20).doc;
    doc = place({ ...fx, doc }, fx.v1, 120, 20).doc;

    const out = closeAllGaps(doc, fx.v1);
    expect(layout(out, fx.v1)).toEqual([
      [10, 20],
      [30, 20],
      [50, 20],
    ]);
  });
});

describe('linked clips', () => {
  it('trimming one linked clip trims the other', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 100, 40);
    const video = doc.trackClips[fx.v1][0];
    const audio = place({ ...fx, doc }, fx.a1, 0, 100, 40);
    doc = linkClips(audio.doc, [video, audio.id]);

    const out = trimClipStart(doc, video, f(20));
    expect(layout(out, fx.v1)).toEqual([[20, 80]]);
    expect(layout(out, fx.a1)).toEqual([[20, 80]]);
  });

  it('deleting one linked clip deletes the group', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 100);
    const video = doc.trackClips[fx.v1][0];
    const audio = place({ ...fx, doc }, fx.a1, 0, 100);
    doc = linkClips(audio.doc, [video, audio.id]);

    const out = liftClips(doc, [video]);
    expect(Object.keys(out.clips)).toHaveLength(0);
  });
});

describe('track index invariants', () => {
  it('keeps clips sorted by start after arbitrary moves', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 200, 20);
    const b = place({ ...fx, doc }, fx.v1, 0, 20);
    doc = b.doc;
    doc = place({ ...fx, doc }, fx.v1, 100, 20).doc;

    const moved = moveClip(doc, b.id, { start: f(300), policy: 'overwrite' });
    const starts = layout(moved, fx.v1).map(([start]) => start);
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
  });

  it('never leaves a stale id in the track index', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 50);
    const out = liftClips(doc, [id]);
    expect(out.trackClips[fx.v1]).toEqual([]);
  });
});
