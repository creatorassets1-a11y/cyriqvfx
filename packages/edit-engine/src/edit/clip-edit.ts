import {
  roundToFrame,
  type FrameRate,
  type Ticks,
} from '../time/time.js';
import {
  rescaleKeyframes,
  shiftKeyframes,
  type Animated,
} from '../animation/keyframes.js';
import {
  durationForSourceSpan,
  sliceSpeed,
  sourceOffsetAt,
  sourceSpan,
} from '../speed/speed.js';
import { newId } from '../model/factory.js';
import type { Clip, EditDocument, MediaAsset } from '../model/types.js';

/**
 * Clip-level edits that do not touch neighbours.
 *
 * Everything that changes a clip's in point, out point or length goes through
 * here, so the media-limit clamping and the keyframe/ramp bookkeeping exist in
 * exactly one place.
 */

/** How much source media exists before the clip's current in point. */
export function headroom(clip: Clip, media: MediaAsset | undefined): Ticks {
  if (!isMediaLimited(clip, media)) return Infinity;
  return clip.mediaIn;
}

/** How much source media exists after the clip's current out point. */
export function tailroom(clip: Clip, media: MediaAsset | undefined): Ticks {
  if (!isMediaLimited(clip, media)) return Infinity;
  const consumed = sourceSpan(clip.speed, clip.duration);
  return Math.max(0, (media!.duration as number) - (clip.mediaIn + consumed));
}

/**
 * Generated content (colour, text, shapes) and stills have no source extent, so
 * they can be stretched arbitrarily. Only real time-based media is limited.
 */
function isMediaLimited(clip: Clip, media: MediaAsset | undefined): boolean {
  if (clip.content.kind !== 'media') return false;
  if (clip.speed.kind === 'freeze') return false;
  return !!media && media.duration !== null && media.kind !== 'image';
}

const mediaFor = (doc: EditDocument, clip: Clip): MediaAsset | undefined =>
  clip.content.kind === 'media' ? doc.media[clip.content.mediaId] : undefined;

/** Shortest a clip may become. One frame — below that it is not a clip. */
export function minClipDuration(rate: FrameRate): Ticks {
  return roundToFrame(1, rate) || Math.round(705_600_000 / (rate.num / rate.den));
}

/**
 * Move a clip's head to `newStart`, consuming or releasing source media.
 *
 * The clip's tail stays put. Keyframes shift with the content so animation
 * stays attached to the footage, and a speed ramp is sliced rather than
 * rescaled.
 */
export function setClipHead(doc: EditDocument, clip: Clip, newStart: Ticks): Clip {
  const rate = doc.project.settings.frameRate;
  const media = mediaFor(doc, clip);
  const end = clip.start + clip.duration;
  const minDuration = minClipDuration(rate);

  const earliest = clip.start - headroom(clip, media);
  const latest = end - minDuration;
  const target = roundToFrame(Math.min(Math.max(newStart, earliest), latest), rate);

  const delta = target - clip.start;
  if (delta === 0) return clip;

  const newDuration = clip.duration - delta;
  // Source offset the new head lands on, measured in the clip's own timeline.
  const sourceDelta =
    delta > 0
      ? sourceOffsetAt(clip.speed, delta, clip.duration)
      : -sourceOffsetAt(clip.speed, -delta, clip.duration);

  const p0 = clip.duration > 0 ? Math.max(0, delta) / clip.duration : 0;
  const speed = delta > 0 ? sliceSpeed(clip.speed, p0, 1) : clip.speed;

  return {
    ...clip,
    start: target,
    duration: newDuration,
    mediaIn: Math.max(0, clip.mediaIn + sourceDelta),
    speed,
    transform: shiftTransformKeyframes(clip, -delta),
    audio: clip.audio
      ? { ...clip.audio, gainDb: shiftKeyframes(clip.audio.gainDb, -delta), pan: shiftKeyframes(clip.audio.pan, -delta) }
      : null,
  };
}

/** Move a clip's tail to `newEnd`. The head stays put. */
export function setClipTail(doc: EditDocument, clip: Clip, newEnd: Ticks): Clip {
  const rate = doc.project.settings.frameRate;
  const media = mediaFor(doc, clip);
  const minDuration = minClipDuration(rate);

  const latest = clip.start + clip.duration + tailroom(clip, media);
  const earliest = clip.start + minDuration;
  const target = roundToFrame(Math.min(Math.max(newEnd, earliest), latest), rate);

  const newDuration = target - clip.start;
  if (newDuration === clip.duration) return clip;

  const p1 = clip.duration > 0 ? Math.min(1, newDuration / clip.duration) : 1;
  const speed = newDuration < clip.duration ? sliceSpeed(clip.speed, 0, p1) : clip.speed;

  return { ...clip, duration: newDuration, speed };
}

/**
 * Slip: change which part of the source plays without moving the clip or
 * changing its length. Clamped so the clip never runs off either end of its
 * media.
 */
export function slipClip(doc: EditDocument, clip: Clip, delta: Ticks): Clip {
  const media = mediaFor(doc, clip);
  const back = headroom(clip, media);
  const forward = tailroom(clip, media);
  const applied = Math.min(Math.max(delta, -back), forward);
  if (applied === 0 || !Number.isFinite(applied)) return clip;
  return { ...clip, mediaIn: Math.max(0, clip.mediaIn + applied) };
}

/**
 * Change a clip's speed.
 *
 * `mode` decides which of the two things the user might mean:
 *   - 'keep-source' plays the same footage over a different length (the clip
 *     grows when slowed) — what the speed dial does,
 *   - 'keep-duration' keeps the clip's slot on the timeline and consumes more
 *     or less footage — what a ramp applied under a fixed music cue needs.
 */
export function setClipSpeed(
  doc: EditDocument,
  clip: Clip,
  speed: Clip['speed'],
  mode: 'keep-source' | 'keep-duration' = 'keep-source',
): Clip {
  const rate = doc.project.settings.frameRate;
  const media = mediaFor(doc, clip);

  if (mode === 'keep-duration') {
    const available = media?.duration != null ? media.duration - clip.mediaIn : Infinity;
    const wanted = sourceSpan(speed, clip.duration);
    if (wanted <= available) return { ...clip, speed };
    // Not enough footage at the new rate: shorten to what is actually there.
    const duration = roundToFrame(durationForSourceSpan(speed, available, clip.duration), rate);
    return { ...clip, speed, duration: Math.max(minClipDuration(rate), duration) };
  }

  const currentSource = sourceSpan(clip.speed, clip.duration);
  const newDuration = Math.max(
    minClipDuration(rate),
    roundToFrame(durationForSourceSpan(speed, currentSource, clip.duration), rate),
  );

  return {
    ...clip,
    speed,
    duration: newDuration,
    transform: rescaleTransformKeyframes(clip, clip.duration, newDuration),
    audio: clip.audio
      ? {
          ...clip.audio,
          gainDb: rescaleKeyframes(clip.audio.gainDb, clip.duration, newDuration),
          pan: rescaleKeyframes(clip.audio.pan, clip.duration, newDuration),
        }
      : null,
  };
}

/** Reverse playback, preserving position and length. */
export function reverseClip(clip: Clip): Clip {
  if (clip.speed.kind === 'freeze') return clip;
  return { ...clip, speed: { ...clip.speed, reverse: !clip.speed.reverse } };
}

/**
 * Freeze the frame at `clipTime` into a still of `duration`. Returns the three
 * pieces the caller splices back in: the part before, the freeze, and the part
 * after. Either outer piece may be null when the freeze is at an edge.
 */
export function freezeFrameAt(
  doc: EditDocument,
  clip: Clip,
  clipTime: Ticks,
  duration: Ticks,
): { before: Clip | null; freeze: Clip; after: Clip | null } {
  const rate = doc.project.settings.frameRate;
  const at = roundToFrame(Math.min(Math.max(clipTime, 0), clip.duration), rate);
  const sourceTime = clip.mediaIn + sourceOffsetAt(clip.speed, at, clip.duration);

  const before = at > 0 ? setClipTail(doc, clip, clip.start + at) : null;
  const afterSource = at < clip.duration ? setClipHead(doc, clip, clip.start + at) : null;

  const freeze: Clip = {
    ...clip,
    id: newId('clip'),
    start: clip.start + at,
    duration,
    speed: { kind: 'freeze', sourceTime },
    // A held frame has no motion to blend and no audio to play.
    audio: null,
  };

  const after = afterSource
    ? { ...afterSource, id: newId('clip'), start: freeze.start + duration }
    : null;

  return { before, freeze, after };
}

// ---------------------------------------------------------------------------
// Keyframe bookkeeping
// ---------------------------------------------------------------------------

function shiftTransformKeyframes(clip: Clip, delta: Ticks): Clip['transform'] {
  const t = clip.transform;
  return {
    ...t,
    position: shiftKeyframes(t.position, delta),
    scale: shiftKeyframes(t.scale, delta),
    rotation: shiftKeyframes(t.rotation, delta),
    opacity: shiftKeyframes(t.opacity, delta),
    anchor: shiftKeyframes(t.anchor, delta),
    cornerRadius: shiftKeyframes(t.cornerRadius, delta),
  };
}

function rescaleTransformKeyframes(
  clip: Clip,
  oldDuration: Ticks,
  newDuration: Ticks,
): Clip['transform'] {
  const t = clip.transform;
  const r = <T>(p: Animated<T>) => rescaleKeyframes(p, oldDuration, newDuration);
  return {
    ...t,
    position: r(t.position),
    scale: r(t.scale),
    rotation: r(t.rotation),
    opacity: r(t.opacity),
    anchor: r(t.anchor),
    cornerRadius: r(t.cornerRadius),
  };
}
