import type { Clip, EditDocument, Id, Marker, Track } from '../model/types.js';

/**
 * Low-level document mutation.
 *
 * These are the only functions permitted to construct a new `EditDocument`.
 * They maintain the two invariants everything else assumes:
 *
 *   1. `trackClips[trackId]` lists exactly the clips whose `trackId` matches,
 *   2. and that list is sorted ascending by `start`.
 *
 * Editing operations in `../edit` are written in terms of these, so no
 * operation can leave the index inconsistent with the clip table.
 */

function sortedInsert(ids: readonly Id[], clips: Record<Id, Clip>, id: Id): Id[] {
  const clip = clips[id];
  const out = [...ids];
  const start = clip.start;
  let i = out.length;
  while (i > 0 && clips[out[i - 1]].start > start) i--;
  out.splice(i, 0, id);
  return out;
}

const resort = (ids: readonly Id[], clips: Record<Id, Clip>): Id[] =>
  [...ids].sort((a, b) => clips[a].start - clips[b].start || (a < b ? -1 : 1));

export function putClip(doc: EditDocument, clip: Clip): EditDocument {
  const existing = doc.clips[clip.id];
  const clips = { ...doc.clips, [clip.id]: clip };

  // Same track and same start: the index is untouched.
  if (existing && existing.trackId === clip.trackId && existing.start === clip.start) {
    return { ...doc, clips };
  }

  const trackClips = { ...doc.trackClips };
  if (existing && existing.trackId !== clip.trackId) {
    trackClips[existing.trackId] = (trackClips[existing.trackId] ?? []).filter(
      (id) => id !== clip.id,
    );
  }

  const target = trackClips[clip.trackId] ?? [];
  trackClips[clip.trackId] =
    existing && existing.trackId === clip.trackId
      ? resort(target, clips)
      : sortedInsert(target, clips, clip.id);

  return { ...doc, clips, trackClips };
}

export function putClips(doc: EditDocument, clips: readonly Clip[]): EditDocument {
  return clips.reduce(putClip, doc);
}

export function removeClip(doc: EditDocument, clipId: Id): EditDocument {
  const clip = doc.clips[clipId];
  if (!clip) return doc;
  const clips = { ...doc.clips };
  delete clips[clipId];
  return {
    ...doc,
    clips,
    trackClips: {
      ...doc.trackClips,
      [clip.trackId]: (doc.trackClips[clip.trackId] ?? []).filter((id) => id !== clipId),
    },
  };
}

export function removeClips(doc: EditDocument, clipIds: readonly Id[]): EditDocument {
  return clipIds.reduce(removeClip, doc);
}

/** Apply a partial update to a clip. No-ops if the clip is gone. */
export function updateClip(
  doc: EditDocument,
  clipId: Id,
  patch: Partial<Clip> | ((clip: Clip) => Partial<Clip>),
): EditDocument {
  const clip = doc.clips[clipId];
  if (!clip) return doc;
  const delta = typeof patch === 'function' ? patch(clip) : patch;
  return putClip(doc, { ...clip, ...delta });
}

export function updateTrack(
  doc: EditDocument,
  trackId: Id,
  patch: Partial<Track> | ((track: Track) => Partial<Track>),
): EditDocument {
  return {
    ...doc,
    tracks: doc.tracks.map((t) => {
      if (t.id !== trackId) return t;
      const delta = typeof patch === 'function' ? patch(t) : patch;
      return { ...t, ...delta };
    }),
  };
}

export function addTrack(doc: EditDocument, track: Track): EditDocument {
  return {
    ...doc,
    tracks: [...doc.tracks, track],
    trackClips: { ...doc.trackClips, [track.id]: [] },
  };
}

/** Remove a track and every clip on it. */
export function removeTrack(doc: EditDocument, trackId: Id): EditDocument {
  const ids = doc.trackClips[trackId] ?? [];
  const cleared = removeClips(doc, ids);
  const trackClips = { ...cleared.trackClips };
  delete trackClips[trackId];
  return {
    ...cleared,
    tracks: cleared.tracks.filter((t) => t.id !== trackId),
    trackClips,
  };
}

export function addMarker(doc: EditDocument, marker: Marker): EditDocument {
  return { ...doc, markers: [...doc.markers, marker].sort((a, b) => a.time - b.time) };
}

export function removeMarker(doc: EditDocument, markerId: Id): EditDocument {
  return { ...doc, markers: doc.markers.filter((m) => m.id !== markerId) };
}

export function updateMarker(
  doc: EditDocument,
  markerId: Id,
  patch: Partial<Marker>,
): EditDocument {
  return {
    ...doc,
    markers: doc.markers
      .map((m) => (m.id === markerId ? { ...m, ...patch } : m))
      .sort((a, b) => a.time - b.time),
  };
}

export function touch(doc: EditDocument): EditDocument {
  return { ...doc, project: { ...doc.project, modifiedAt: Date.now() } };
}

/**
 * Rebuild the track index from scratch. Only used after loading a project file,
 * where the index is derived rather than trusted.
 */
export function reindex(doc: EditDocument): EditDocument {
  const trackClips: Record<Id, Id[]> = {};
  for (const track of doc.tracks) trackClips[track.id] = [];
  for (const clip of Object.values(doc.clips)) {
    (trackClips[clip.trackId] ??= []).push(clip.id);
  }
  for (const key of Object.keys(trackClips)) {
    trackClips[key] = resort(trackClips[key], doc.clips as Record<Id, Clip>);
  }
  return { ...doc, trackClips };
}
