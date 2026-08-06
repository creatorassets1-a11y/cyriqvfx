import {
  intersectRanges,
  rangeEnd,
  rangesOverlap,
  roundToFrame,
  type Ticks,
  type TimeRange,
} from '../time/time.js';
import { newId } from '../model/factory.js';
import type { Clip, EditDocument, Id, Track } from '../model/types.js';
import {
  clipEnd,
  clipRange,
  clipsOnTrack,
  documentDuration,
  gapAfter,
  getTrack,
  linkedClips,
  neighbours,
} from '../document/queries.js';
import { putClip, putClips, removeClip, removeClips, updateClip } from '../document/mutate.js';
import { minClipDuration, setClipHead, setClipTail, slipClip } from './clip-edit.js';

/**
 * Timeline operations.
 *
 * These are the verbs the UI binds to. Each takes a document and returns a new
 * one; none of them mutate. Operations that can fail (because a clip is locked,
 * or the move is impossible) return the document unchanged rather than
 * throwing, so a dropped gesture never breaks the session.
 */

export type CollisionPolicy = 'overwrite' | 'ripple' | 'reject';

const isLocked = (doc: EditDocument, trackId: Id): boolean =>
  getTrack(doc, trackId)?.locked ?? false;

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

/**
 * Split the clip under `time` on `trackId` into two.
 *
 * Both halves keep the full effect stack and grade — a split is a cut, not a
 * simplification — and the second half's media in point advances by however
 * much source the first half consumed, which is what makes a split under a
 * speed ramp land on the same frame it was showing.
 */
export function splitClip(doc: EditDocument, clipId: Id, time: Ticks): EditDocument {
  const clip = doc.clips[clipId];
  if (!clip || isLocked(doc, clip.trackId)) return doc;

  const rate = doc.project.settings.frameRate;
  const at = roundToFrame(time, rate);
  const min = minClipDuration(rate);
  if (at <= clip.start + min - 1 || at >= clipEnd(clip) - min + 1) return doc;

  const left = setClipTail(doc, clip, at);
  const rightBase = setClipHead(doc, clip, at);
  const right: Clip = {
    ...rightBase,
    id: newId('clip'),
    // A transition belongs to the cut it was authored on, not to the new one.
    transitionIn: null,
  };

  return putClips(doc, [left, right]);
}

/** Split every clip crossing `time` on the given tracks (or all of them). */
export function splitAt(doc: EditDocument, time: Ticks, trackIds?: readonly Id[]): EditDocument {
  const ids = trackIds ?? doc.tracks.map((t) => t.id);
  let out = doc;
  for (const trackId of ids) {
    if (isLocked(doc, trackId)) continue;
    const clip = clipsOnTrack(out, trackId).find(
      (c) => time > c.start && time < clipEnd(c),
    );
    if (clip) out = splitClip(out, clip.id, time);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Remove clips, leaving gaps where they were. */
export function liftClips(doc: EditDocument, clipIds: readonly Id[]): EditDocument {
  const deletable = clipIds.filter((id) => {
    const clip = doc.clips[id];
    return clip && !isLocked(doc, clip.trackId);
  });
  return removeClips(doc, expandToLinked(doc, deletable));
}

/**
 * Remove clips and close the gap behind them, pulling later clips earlier.
 *
 * Ripple only shifts the tracks the deleted clips were on. Rippling every track
 * would silently destroy sync with overlays the user never selected — if they
 * want that, they select those clips too.
 */
export function rippleDeleteClips(doc: EditDocument, clipIds: readonly Id[]): EditDocument {
  const ids = expandToLinked(doc, clipIds).filter((id) => {
    const clip = doc.clips[id];
    return clip && !isLocked(doc, clip.trackId);
  });
  if (ids.length === 0) return doc;

  // Group by track and process each track's removals from the end backwards,
  // so earlier shifts never invalidate later positions.
  const byTrack = new Map<Id, Clip[]>();
  for (const id of ids) {
    const clip = doc.clips[id];
    const list = byTrack.get(clip.trackId) ?? [];
    list.push(clip);
    byTrack.set(clip.trackId, list);
  }

  let out = doc;
  for (const [trackId, clips] of byTrack) {
    const sorted = [...clips].sort((a, b) => b.start - a.start);
    for (const clip of sorted) {
      out = removeClip(out, clip.id);
      out = shiftClipsAfter(out, trackId, clip.start, -clip.duration);
    }
  }
  return out;
}

/** Close the gap immediately after `clipId` by pulling later clips back. */
export function closeGapAfter(doc: EditDocument, clipId: Id): EditDocument {
  const gap = gapAfter(doc, clipId);
  const clip = doc.clips[clipId];
  if (!gap || !clip || isLocked(doc, clip.trackId)) return doc;
  return shiftClipsAfter(doc, clip.trackId, gap.start, -gap.duration);
}

/** Close every gap on a track, packing clips flush from the first one. */
export function closeAllGaps(doc: EditDocument, trackId: Id): EditDocument {
  if (isLocked(doc, trackId)) return doc;
  const clips = clipsOnTrack(doc, trackId);
  let out = doc;
  let cursor = clips.length > 0 ? clips[0].start : 0;
  for (const clip of clips) {
    if (clip.start !== cursor) out = updateClip(out, clip.id, { start: cursor });
    cursor += clip.duration;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trim
// ---------------------------------------------------------------------------

export interface TrimOptions {
  /** Push or pull everything after the clip by the same amount. */
  readonly ripple?: boolean;
}

export function trimClipStart(
  doc: EditDocument,
  clipId: Id,
  newStart: Ticks,
  opts: TrimOptions = {},
): EditDocument {
  const clip = doc.clips[clipId];
  if (!clip || isLocked(doc, clip.trackId)) return doc;

  const limited = opts.ripple
    ? newStart
    : Math.max(newStart, previousEnd(doc, clipId) ?? Number.NEGATIVE_INFINITY);

  const trimmed = setClipHead(doc, clip, limited);
  const delta = trimmed.start - clip.start;
  if (delta === 0) return doc;

  let out = putClip(doc, trimmed);
  if (opts.ripple) {
    // The clip's head moved by `delta`; slide it and everything after back so
    // the cut lands where the user dragged rather than opening a gap.
    out = updateClip(out, clipId, { start: clip.start });
    out = shiftClipsAfter(out, clip.trackId, clip.start, -delta);
  }
  return applyToLinked(out, doc, clipId, (linked) => setClipHead(doc, linked, limited));
}

export function trimClipEnd(
  doc: EditDocument,
  clipId: Id,
  newEnd: Ticks,
  opts: TrimOptions = {},
): EditDocument {
  const clip = doc.clips[clipId];
  if (!clip || isLocked(doc, clip.trackId)) return doc;

  const limited = opts.ripple
    ? newEnd
    : Math.min(newEnd, nextStart(doc, clipId) ?? Number.POSITIVE_INFINITY);

  const trimmed = setClipTail(doc, clip, limited);
  const delta = trimmed.duration - clip.duration;
  if (delta === 0) return doc;

  let out = putClip(doc, trimmed);
  if (opts.ripple) {
    out = shiftClipsAfter(out, clip.trackId, clipEnd(clip), delta);
  }
  return applyToLinked(out, doc, clipId, (linked) => setClipTail(doc, linked, limited));
}

/**
 * Roll: move the cut between `clipId` and the clip after it. The outgoing clip's
 * tail and the incoming clip's head move together, so total length is unchanged.
 */
export function rollEdit(doc: EditDocument, clipId: Id, newCutTime: Ticks): EditDocument {
  const clip = doc.clips[clipId];
  if (!clip || isLocked(doc, clip.trackId)) return doc;
  const { next } = neighbours(doc, clipId);
  // Roll is only defined across a hard cut; a gap means there is nothing to roll.
  if (!next || next.start !== clipEnd(clip)) return doc;

  const left = setClipTail(doc, clip, newCutTime);
  // Only commit if the outgoing side could actually reach the requested cut,
  // otherwise the two sides would disagree and open a gap.
  const cut = clipEnd(left);
  const right = setClipHead(doc, next, cut);
  if (right.start !== cut) return doc;

  return putClips(doc, [left, right]);
}

/**
 * Slide: move a clip within its neighbours. The clip keeps its content and
 * length; the clip before it absorbs the change on its tail and the one after
 * on its head.
 */
export function slideClip(doc: EditDocument, clipId: Id, delta: Ticks): EditDocument {
  const clip = doc.clips[clipId];
  if (!clip || isLocked(doc, clip.trackId)) return doc;
  const { previous, next } = neighbours(doc, clipId);

  const rate = doc.project.settings.frameRate;
  const min = minClipDuration(rate);

  // Bound the slide by how much the neighbours can give up.
  let lower = Number.NEGATIVE_INFINITY;
  let upper = Number.POSITIVE_INFINITY;
  if (previous && clipEnd(previous) === clip.start) {
    lower = Math.max(lower, previous.start + min - clip.start);
  }
  if (next && next.start === clipEnd(clip)) {
    upper = Math.min(upper, clipEnd(next) - min - clipEnd(clip));
  }
  const applied = roundToFrame(Math.min(Math.max(delta, lower), upper), rate);
  if (applied === 0) return doc;

  let out = updateClip(doc, clipId, { start: clip.start + applied });
  if (previous && clipEnd(previous) === clip.start) {
    out = putClip(out, setClipTail(out, previous, clip.start + applied));
  }
  if (next && next.start === clipEnd(clip)) {
    out = putClip(out, setClipHead(out, next, clipEnd(clip) + applied));
  }
  return out;
}

/** Slip: change the visible portion of the source without moving the clip. */
export function slipClipBy(doc: EditDocument, clipId: Id, delta: Ticks): EditDocument {
  const clip = doc.clips[clipId];
  if (!clip || isLocked(doc, clip.trackId)) return doc;
  const slipped = slipClip(doc, clip, delta);
  const out = putClip(doc, slipped);
  return applyToLinked(out, doc, clipId, (linked) => slipClip(doc, linked, delta));
}

// ---------------------------------------------------------------------------
// Move & insert
// ---------------------------------------------------------------------------

export interface MoveOptions {
  readonly trackId?: Id;
  readonly start?: Ticks;
  readonly policy?: CollisionPolicy;
}

/**
 * Move a clip to a new track and/or start time.
 *
 * On a magnetic track the default is to ripple: neighbours make room. On a free
 * track the default is to overwrite, which is what dragging an overlay on top
 * of another one should do.
 */
export function moveClip(doc: EditDocument, clipId: Id, opts: MoveOptions): EditDocument {
  const clip = doc.clips[clipId];
  if (!clip) return doc;

  const targetTrackId = opts.trackId ?? clip.trackId;
  const target = getTrack(doc, targetTrackId);
  if (!target || target.locked || isLocked(doc, clip.trackId)) return doc;

  // Audio cannot live on a video track and vice versa.
  if (!trackAccepts(target, clip)) return doc;

  const rate = doc.project.settings.frameRate;
  const start = roundToFrame(Math.max(0, opts.start ?? clip.start), rate);
  if (start === clip.start && targetTrackId === clip.trackId) return doc;

  const policy = opts.policy ?? (target.magnetic ? 'ripple' : 'overwrite');
  const moved: Clip = { ...clip, trackId: targetTrackId, start };
  const range: TimeRange = { start, duration: clip.duration };

  let out = removeClip(doc, clipId);

  switch (policy) {
    case 'reject':
      if (clipsOnTrack(out, targetTrackId).some((c) => rangesOverlap(clipRange(c), range))) {
        return doc;
      }
      break;
    case 'ripple':
      out = openSpace(out, targetTrackId, range);
      break;
    case 'overwrite':
      out = overwriteRange(out, targetTrackId, range);
      break;
  }

  return putClip(out, moved);
}

/** Insert a clip, pushing later clips on the track back to make room. */
export function insertClip(doc: EditDocument, clip: Clip): EditDocument {
  const track = getTrack(doc, clip.trackId);
  if (!track || track.locked || !trackAccepts(track, clip)) return doc;
  const out = openSpace(doc, clip.trackId, clipRange(clip));
  return putClip(out, clip);
}

/** Place a clip over whatever is already there, trimming or splitting it. */
export function overwriteClip(doc: EditDocument, clip: Clip): EditDocument {
  const track = getTrack(doc, clip.trackId);
  if (!track || track.locked || !trackAccepts(track, clip)) return doc;
  const out = overwriteRange(doc, clip.trackId, clipRange(clip));
  return putClip(out, clip);
}

/** Append to the end of a track — what "add to timeline" does from the bin. */
export function appendClip(doc: EditDocument, clip: Clip): EditDocument {
  const clips = clipsOnTrack(doc, clip.trackId);
  const start = clips.length > 0 ? clipEnd(clips[clips.length - 1]) : 0;
  return overwriteClip(doc, { ...clip, start });
}

/**
 * Clear a time range on a track, trimming partial overlaps and splitting clips
 * that straddle it. This is the primitive behind overwrite and range delete.
 */
export function overwriteRange(
  doc: EditDocument,
  trackId: Id,
  range: TimeRange,
  exceptClipId?: Id,
): EditDocument {
  let out = doc;
  const end = rangeEnd(range);

  for (const clip of clipsOnTrack(doc, trackId)) {
    if (clip.id === exceptClipId) continue;
    if (!rangesOverlap(clipRange(clip), range)) continue;

    const startsBefore = clip.start < range.start;
    const endsAfter = clipEnd(clip) > end;

    if (startsBefore && endsAfter) {
      // Straddles the range: keep the head, keep the tail, drop the middle.
      const head = setClipTail(out, clip, range.start);
      const tailBase = setClipHead(out, clip, end);
      out = putClip(out, head);
      out = putClip(out, { ...tailBase, id: newId('clip'), transitionIn: null });
    } else if (startsBefore) {
      out = putClip(out, setClipTail(out, clip, range.start));
    } else if (endsAfter) {
      out = putClip(out, setClipHead(out, clip, end));
    } else {
      out = removeClip(out, clip.id);
    }
  }
  return out;
}

/** Delete a time range across tracks, optionally closing the gap. */
export function deleteRange(
  doc: EditDocument,
  range: TimeRange,
  opts: { trackIds?: readonly Id[]; ripple?: boolean } = {},
): EditDocument {
  const ids = (opts.trackIds ?? doc.tracks.map((t) => t.id)).filter((id) => !isLocked(doc, id));
  let out = doc;
  for (const trackId of ids) {
    out = overwriteRange(out, trackId, range);
    if (opts.ripple) out = shiftClipsAfter(out, trackId, range.start, -range.duration);
  }
  return out;
}

/** Push clips at or after `range.start` back so `range` is empty. */
function openSpace(doc: EditDocument, trackId: Id, range: TimeRange): EditDocument {
  const blocking = clipsOnTrack(doc, trackId).filter(
    (c) => clipEnd(c) > range.start && rangesOverlap(clipRange(c), range),
  );
  if (blocking.length === 0) return doc;
  // Shift from the first clip the new range touches, by the full range length,
  // so nothing is left half-covered.
  const from = Math.min(range.start, ...blocking.map((c) => c.start));
  return shiftClipsAfter(doc, trackId, from, range.duration, { inclusive: true });
}

/** Move every clip starting at or after `from` by `delta`. */
export function shiftClipsAfter(
  doc: EditDocument,
  trackId: Id,
  from: Ticks,
  delta: Ticks,
  opts: { inclusive?: boolean } = {},
): EditDocument {
  if (delta === 0) return doc;
  const inclusive = opts.inclusive ?? true;
  let out = doc;
  for (const clip of clipsOnTrack(doc, trackId)) {
    const affected = inclusive ? clip.start >= from : clip.start > from;
    if (!affected) continue;
    out = updateClip(out, clip.id, { start: Math.max(0, clip.start + delta) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Linking & grouping
// ---------------------------------------------------------------------------

/** Link clips so they move and trim together — video with its detached audio. */
export function linkClips(doc: EditDocument, clipIds: readonly Id[]): EditDocument {
  if (clipIds.length < 2) return doc;
  const group = newId('grp');
  let out = doc;
  for (const id of clipIds) out = updateClip(out, id, { linkGroup: group });
  return out;
}

export function unlinkClips(doc: EditDocument, clipIds: readonly Id[]): EditDocument {
  let out = doc;
  for (const id of clipIds) out = updateClip(out, id, { linkGroup: null });
  return out;
}

/**
 * Detach a clip's audio onto an audio track, keeping the two linked so they
 * stay in sync until the user explicitly unlinks them.
 */
export function detachAudio(doc: EditDocument, clipId: Id, audioTrackId: Id): EditDocument {
  const clip = doc.clips[clipId];
  const track = getTrack(doc, audioTrackId);
  if (!clip || !track || track.kind !== 'audio' || !clip.audio) return doc;

  const group = clip.linkGroup ?? newId('grp');
  const audioClip: Clip = {
    ...clip,
    id: newId('clip'),
    trackId: audioTrackId,
    linkGroup: group,
    grade: null,
    effects: [],
    masks: [],
    chromaKey: null,
    transitionIn: null,
  };

  let out = updateClip(doc, clipId, { audio: null, linkGroup: group });
  return overwriteClip(out, audioClip);
}

const expandToLinked = (doc: EditDocument, ids: readonly Id[]): Id[] => {
  const set = new Set<Id>();
  for (const id of ids) for (const clip of linkedClips(doc, id)) set.add(clip.id);
  return [...set];
};

/**
 * Re-apply an edit to every clip linked to `clipId`. `mutate` receives each
 * linked clip and returns its edited form.
 */
function applyToLinked(
  out: EditDocument,
  original: EditDocument,
  clipId: Id,
  mutate: (clip: Clip) => Clip,
): EditDocument {
  const clip = original.clips[clipId];
  if (!clip?.linkGroup) return out;
  let next = out;
  for (const linked of linkedClips(original, clipId)) {
    if (linked.id === clipId) continue;
    if (isLocked(original, linked.trackId)) continue;
    next = putClip(next, mutate(linked));
  }
  return next;
}

const trackAccepts = (track: Track, clip: Clip): boolean => {
  if (track.kind === 'video') return true;
  // An audio track only holds clips that actually carry audio.
  return clip.content.kind === 'media' || clip.audio !== null;
};

const previousEnd = (doc: EditDocument, clipId: Id): Ticks | null => {
  const { previous } = neighbours(doc, clipId);
  return previous ? clipEnd(previous) : null;
};

const nextStart = (doc: EditDocument, clipId: Id): Ticks | null => {
  const { next } = neighbours(doc, clipId);
  return next ? next.start : null;
};

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Apply a transition on the cut before `clipId`.
 *
 * A transition needs media on both sides to dissolve through, so its duration
 * is clamped to the shorter of the two clips' available handles.
 */
export function setTransition(
  doc: EditDocument,
  clipId: Id,
  type: Clip['transitionIn'] extends null ? never : NonNullable<Clip['transitionIn']>['type'],
  duration: Ticks,
): EditDocument {
  const clip = doc.clips[clipId];
  if (!clip) return doc;
  const { previous } = neighbours(doc, clipId);
  if (!previous || clipEnd(previous) !== clip.start) return doc;

  const rate = doc.project.settings.frameRate;
  const max = Math.min(clip.duration, previous.duration);
  const clamped = roundToFrame(Math.min(Math.max(duration, 0), max), rate);
  if (clamped <= 0) return updateClip(doc, clipId, { transitionIn: null });

  return updateClip(doc, clipId, {
    transitionIn: { type, duration: clamped, alignment: 0.5 },
  });
}

export function removeTransition(doc: EditDocument, clipId: Id): EditDocument {
  return updateClip(doc, clipId, { transitionIn: null });
}

/**
 * The overlap a transition occupies on the timeline, in absolute time, or null
 * when the clip has none.
 */
export function transitionRange(doc: EditDocument, clipId: Id): TimeRange | null {
  const clip = doc.clips[clipId];
  if (!clip?.transitionIn) return null;
  const { duration, alignment } = clip.transitionIn;
  const start = clip.start - Math.round(duration * alignment);
  const range = { start, duration };
  // Never let the overlap run past either clip's extent.
  const { previous } = neighbours(doc, clipId);
  const bound: TimeRange = {
    start: previous ? previous.start : clip.start,
    duration: (previous ? previous.duration : 0) + clip.duration,
  };
  return intersectRanges(range, bound);
}

/** Total timeline length after the edit — convenience for the UI ruler. */
export const timelineDuration = documentDuration;
