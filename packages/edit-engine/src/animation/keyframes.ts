import type { Ticks } from '../time/time.js';
import { cubicBezierEase, EASING_PRESETS } from './bezier.js';

/**
 * Keyframed properties.
 *
 * A property is either a constant or a sorted list of keyframes. Times are
 * relative to the start of the owning clip so that moving a clip on the
 * timeline never touches its animation.
 */

export type Interpolation = 'linear' | 'hold' | 'bezier' | 'smooth';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Keyframe<T> {
  readonly time: Ticks;
  readonly value: T;
  readonly interpolation: Interpolation;
  /**
   * Bézier handles for the segment leaving this keyframe, as
   * [outX, outY, inX, inY] of the next keyframe — the CSS convention. Only
   * read when `interpolation` is 'bezier'.
   */
  readonly bezier?: readonly [number, number, number, number];
}

export interface Animated<T> {
  readonly keyframes: readonly Keyframe<T>[];
  /** Used when `keyframes` is empty; also the value a new keyframe inherits. */
  readonly base: T;
}

export type AnimatableNumber = Animated<number>;
export type AnimatableVec2 = Animated<Vec2>;

export const constant = <T>(base: T): Animated<T> => ({ keyframes: [], base });

export const isAnimated = <T>(prop: Animated<T>): boolean => prop.keyframes.length > 0;

/** Comparator that keeps keyframe lists in ascending time order. */
const byTime = <T>(a: Keyframe<T>, b: Keyframe<T>) => a.time - b.time;

/**
 * Insert or replace a keyframe at `time`. Two keyframes may never share a
 * time, so an existing one at that exact tick is overwritten — which is also
 * what a user expects when they nudge a value with the playhead parked.
 */
export function setKeyframe<T>(
  prop: Animated<T>,
  time: Ticks,
  value: T,
  interpolation: Interpolation = 'linear',
  bezier?: readonly [number, number, number, number],
): Animated<T> {
  const kf: Keyframe<T> = bezier
    ? { time, value, interpolation, bezier }
    : { time, value, interpolation };
  const rest = prop.keyframes.filter((k) => k.time !== time);
  return { ...prop, keyframes: [...rest, kf].sort(byTime) };
}

export function removeKeyframe<T>(prop: Animated<T>, time: Ticks): Animated<T> {
  return { ...prop, keyframes: prop.keyframes.filter((k) => k.time !== time) };
}

/** Move a keyframe in time, preserving sort order. Collisions overwrite. */
export function moveKeyframe<T>(prop: Animated<T>, from: Ticks, to: Ticks): Animated<T> {
  const kf = prop.keyframes.find((k) => k.time === from);
  if (!kf) return prop;
  const rest = prop.keyframes.filter((k) => k.time !== from && k.time !== to);
  return { ...prop, keyframes: [...rest, { ...kf, time: to }].sort(byTime) };
}

/** Drop every keyframe, freezing the property at its value at `time`. */
export function flatten<T>(prop: Animated<T>, time: Ticks, lerp: Lerp<T>): Animated<T> {
  return { keyframes: [], base: evaluate(prop, time, lerp) };
}

export type Lerp<T> = (a: T, b: T, t: number) => T;

export const lerpNumber: Lerp<number> = (a, b, t) => a + (b - a) * t;

export const lerpVec2: Lerp<Vec2> = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/**
 * Catmull–Rom style smoothing: the eased progress is shaped by the neighbouring
 * segments so a run of 'smooth' keyframes reads as one continuous motion rather
 * than a sequence of straight lines.
 */
function smoothProgress(t: number): number {
  return t * t * (3 - 2 * t);
}

function segmentProgress<T>(
  from: Keyframe<T>,
  to: Keyframe<T>,
  time: Ticks,
): number {
  const span = to.time - from.time;
  if (span <= 0) return 1;
  const raw = (time - from.time) / span;

  switch (from.interpolation) {
    case 'hold':
      return 0;
    case 'smooth':
      return smoothProgress(raw);
    case 'bezier': {
      const b = from.bezier ?? EASING_PRESETS.easeInOut;
      return cubicBezierEase(raw, b[0], b[1], b[2], b[3]);
    }
    case 'linear':
    default:
      return raw;
  }
}

/**
 * Value of `prop` at clip-relative `time`.
 *
 * Outside the keyframed range the value is held at the first/last keyframe —
 * NLE convention, and the only behaviour that does not surprise a user who
 * animates the middle of a clip.
 */
export function evaluate<T>(prop: Animated<T>, time: Ticks, lerp: Lerp<T>): T {
  const kfs = prop.keyframes;
  if (kfs.length === 0) return prop.base;
  if (kfs.length === 1) return kfs[0].value;

  const first = kfs[0];
  const last = kfs[kfs.length - 1];
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;

  // Binary search for the segment containing `time`.
  let lo = 0;
  let hi = kfs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].time <= time) lo = mid;
    else hi = mid;
  }

  const from = kfs[lo];
  const to = kfs[hi];
  return lerp(from.value, to.value, segmentProgress(from, to, time));
}

export const evaluateNumber = (prop: AnimatableNumber, time: Ticks): number =>
  evaluate(prop, time, lerpNumber);

export const evaluateVec2 = (prop: AnimatableVec2, time: Ticks): Vec2 =>
  evaluate(prop, time, lerpVec2);

/**
 * Instantaneous rate of change, in units per second — what the velocity graph
 * in the keyframe editor draws. Computed by central difference because the
 * eased segments have no closed-form derivative worth deriving.
 */
export function velocity(
  prop: AnimatableNumber,
  time: Ticks,
  deltaTicks: number,
): number {
  const before = evaluateNumber(prop, time - deltaTicks);
  const after = evaluateNumber(prop, time + deltaTicks);
  return (after - before) / (2 * deltaTicks);
}

/**
 * Rescale keyframe times when a clip's duration changes under a retime or a
 * speed change, so animation stays pinned to the same relative moments.
 */
export function rescaleKeyframes<T>(
  prop: Animated<T>,
  oldDuration: Ticks,
  newDuration: Ticks,
): Animated<T> {
  if (oldDuration <= 0 || newDuration <= 0 || oldDuration === newDuration) return prop;
  const factor = newDuration / oldDuration;
  return {
    ...prop,
    keyframes: prop.keyframes.map((k) => ({ ...k, time: Math.round(k.time * factor) })),
  };
}

/**
 * Shift keyframes when media is slipped or a clip's head is trimmed, keeping
 * animation locked to the content rather than to the clip's new edge.
 */
export function shiftKeyframes<T>(prop: Animated<T>, delta: Ticks): Animated<T> {
  if (delta === 0) return prop;
  return { ...prop, keyframes: prop.keyframes.map((k) => ({ ...k, time: k.time + delta })) };
}

/** Keyframe times within a clip, deduplicated and sorted — for the timeline UI. */
export function keyframeTimes(props: readonly Animated<unknown>[]): Ticks[] {
  const set = new Set<Ticks>();
  for (const p of props) for (const k of p.keyframes) set.add(k.time);
  return [...set].sort((a, b) => a - b);
}
