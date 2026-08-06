import {
  rangeContains,
  rangesOverlap,
  type Ticks,
  type TimeRange,
} from '../time/time.js';
import type { Clip, EditDocument, Id, MediaAsset, Track } from '../model/types.js';

/** Read-only accessors. Every one is O(1) or O(clips on one track). */

export const getClip = (doc: EditDocument, id: Id): Clip | undefined => doc.clips[id];

export const getTrack = (doc: EditDocument, id: Id): Track | undefined =>
  doc.tracks.find((t) => t.id === id);

export const getMedia = (doc: EditDocument, id: Id): MediaAsset | undefined => doc.media[id];

/** Clips on a track, already sorted by start time. */
export function clipsOnTrack(doc: EditDocument, trackId: Id): Clip[] {
  const ids = doc.trackClips[trackId] ?? [];
  const out: Clip[] = [];
  for (const id of ids) {
    const clip = doc.clips[id];
    if (clip) out.push(clip);
  }
  return out;
}

export function allClips(doc: EditDocument): Clip[] {
  return Object.values(doc.clips);
}

export const videoTracks = (doc: EditDocument): Track[] =>
  doc.tracks.filter((t) => t.kind === 'video').sort((a, b) => a.index - b.index);

export const audioTracks = (doc: EditDocument): Track[] =>
  doc.tracks.filter((t) => t.kind === 'audio').sort((a, b) => a.index - b.index);

export const clipRange = (clip: Clip): TimeRange => ({
  start: clip.start,
  duration: clip.duration,
});

export const clipEnd = (clip: Clip): Ticks => clip.start + clip.duration;

/** Total timeline length: the furthest clip end. Empty projects are zero. */
export function documentDuration(doc: EditDocument): Ticks {
  let max = 0;
  for (const clip of Object.values(doc.clips)) {
    const end = clipEnd(clip);
    if (end > max) max = end;
  }
  return max;
}

/** The clip occupying `time` on `trackId`, if any. */
export function clipAt(doc: EditDocument, trackId: Id, time: Ticks): Clip | undefined {
  return clipsOnTrack(doc, trackId).find((c) => rangeContains(clipRange(c), time));
}

/** Every clip intersecting `time`, topmost video track first. */
export function clipsAt(doc: EditDocument, time: Ticks): Clip[] {
  const out: Clip[] = [];
  for (const track of doc.tracks) {
    const clip = clipAt(doc, track.id, time);
    if (clip) out.push(clip);
  }
  return out;
}

export function clipsInRange(doc: EditDocument, trackId: Id, range: TimeRange): Clip[] {
  return clipsOnTrack(doc, trackId).filter((c) => rangesOverlap(clipRange(c), range));
}

export function neighbours(
  doc: EditDocument,
  clipId: Id,
): { previous: Clip | undefined; next: Clip | undefined } {
  const clip = doc.clips[clipId];
  if (!clip) return { previous: undefined, next: undefined };
  const ids = doc.trackClips[clip.trackId] ?? [];
  const i = ids.indexOf(clipId);
  return {
    previous: i > 0 ? doc.clips[ids[i - 1]] : undefined,
    next: i >= 0 && i < ids.length - 1 ? doc.clips[ids[i + 1]] : undefined,
  };
}

/** Gap immediately after `clipId` before the next clip, or null if flush. */
export function gapAfter(doc: EditDocument, clipId: Id): TimeRange | null {
  const clip = doc.clips[clipId];
  if (!clip) return null;
  const { next } = neighbours(doc, clipId);
  if (!next) return null;
  const start = clipEnd(clip);
  const duration = next.start - start;
  return duration > 0 ? { start, duration } : null;
}

/** All gaps on a track between its first and last clip. */
export function gapsOnTrack(doc: EditDocument, trackId: Id): TimeRange[] {
  const clips = clipsOnTrack(doc, trackId);
  const out: TimeRange[] = [];
  for (let i = 0; i < clips.length - 1; i++) {
    const start = clipEnd(clips[i]);
    const duration = clips[i + 1].start - start;
    if (duration > 0) out.push({ start, duration });
  }
  return out;
}

/** Every clip sharing a link group with `clipId`, including itself. */
export function linkedClips(doc: EditDocument, clipId: Id): Clip[] {
  const clip = doc.clips[clipId];
  if (!clip) return [];
  if (!clip.linkGroup) return [clip];
  return Object.values(doc.clips).filter((c) => c.linkGroup === clip.linkGroup);
}

/**
 * Cut points on a track — the positions the playhead snaps to and the
 * "next edit" navigation jumps between.
 */
export function editPoints(doc: EditDocument, trackIds?: readonly Id[]): Ticks[] {
  const ids = trackIds ?? doc.tracks.map((t) => t.id);
  const set = new Set<Ticks>([0]);
  for (const trackId of ids) {
    for (const clip of clipsOnTrack(doc, trackId)) {
      set.add(clip.start);
      set.add(clipEnd(clip));
    }
  }
  for (const marker of doc.markers) set.add(marker.time);
  return [...set].sort((a, b) => a - b);
}

/** Nearest edit point to `time` within `tolerance`, for magnetic snapping. */
export function snapTarget(
  doc: EditDocument,
  time: Ticks,
  tolerance: Ticks,
  opts: { trackIds?: readonly Id[]; exclude?: readonly Id[] } = {},
): Ticks | null {
  const excluded = new Set(opts.exclude ?? []);
  const ids = opts.trackIds ?? doc.tracks.map((t) => t.id);
  let best: Ticks | null = null;
  let bestDistance = tolerance + 1;

  const consider = (candidate: Ticks) => {
    const distance = Math.abs(candidate - time);
    if (distance <= tolerance && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  };

  consider(0);
  for (const trackId of ids) {
    for (const clip of clipsOnTrack(doc, trackId)) {
      if (excluded.has(clip.id)) continue;
      consider(clip.start);
      consider(clipEnd(clip));
    }
  }
  for (const marker of doc.markers) consider(marker.time);
  return best;
}

/** Media referenced by at least one clip — what a project package must bundle. */
export function usedMediaIds(doc: EditDocument): Id[] {
  const set = new Set<Id>();
  for (const clip of Object.values(doc.clips)) {
    if (clip.content.kind === 'media') set.add(clip.content.mediaId);
  }
  return [...set];
}

/** Media in the bin that no clip uses — offered for cleanup to reclaim space. */
export function orphanedMediaIds(doc: EditDocument): Id[] {
  const used = new Set(usedMediaIds(doc));
  return Object.keys(doc.media).filter((id) => !used.has(id));
}

/** Clips whose media has gone missing, so the UI can prompt to relink. */
export function offlineClips(doc: EditDocument): Clip[] {
  return Object.values(doc.clips).filter((clip) => {
    if (clip.content.kind !== 'media') return false;
    const asset = doc.media[clip.content.mediaId];
    return !asset || (asset.localUri === null && !asset.remoteUri);
  });
}
