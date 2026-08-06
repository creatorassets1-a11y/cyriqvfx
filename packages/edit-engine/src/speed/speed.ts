import type { Ticks } from '../time/time.js';
import { cubicBezierEase, EASING_PRESETS } from '../animation/bezier.js';

/**
 * Speed and retiming.
 *
 * A clip maps its own timeline-relative time onto an offset into its source
 * media. For a constant rate that map is a multiply; for a speed ramp it is the
 * integral of the rate curve, which we evaluate from a cumulative table.
 *
 * Every operation here works in the forward direction and applies `reverse` as
 * a final mirror, which keeps the ramp maths from having to special-case it.
 */

export const MIN_RATE = 0.1;
export const MAX_RATE = 100;

/** How intermediate frames are synthesised when slowing below 1×. */
export type FrameBlending = 'none' | 'blend' | 'optical-flow';

export interface SpeedPoint {
  /** Position along the clip, 0..1. */
  readonly at: number;
  /** Playback rate at this point. 0 is a hold; negative is not permitted. */
  readonly rate: number;
  readonly interpolation: 'linear' | 'bezier' | 'hold';
  readonly bezier?: readonly [number, number, number, number];
}

export type SpeedSpec =
  | {
      readonly kind: 'constant';
      readonly rate: number;
      readonly reverse: boolean;
      /** Keep formant/pitch natural when the rate changes. */
      readonly pitchCorrection: boolean;
      readonly frameBlending: FrameBlending;
    }
  | {
      /** A held frame. `sourceTime` is an absolute offset into the media. */
      readonly kind: 'freeze';
      readonly sourceTime: Ticks;
    }
  | {
      readonly kind: 'curve';
      readonly points: readonly SpeedPoint[];
      readonly reverse: boolean;
      readonly pitchCorrection: boolean;
      readonly frameBlending: FrameBlending;
    };

export const NORMAL_SPEED: SpeedSpec = {
  kind: 'constant',
  rate: 1,
  reverse: false,
  pitchCorrection: true,
  frameBlending: 'none',
};

export type ConstantSpeed = Extract<SpeedSpec, { kind: 'constant' }>;
export type CurveSpeed = Extract<SpeedSpec, { kind: 'curve' }>;
export type FreezeSpeed = Extract<SpeedSpec, { kind: 'freeze' }>;

export function constantSpeed(
  rate: number,
  opts: Partial<Omit<ConstantSpeed, 'kind' | 'rate'>> = {},
): ConstantSpeed {
  return {
    kind: 'constant',
    rate: clampRate(rate),
    reverse: opts.reverse ?? false,
    pitchCorrection: opts.pitchCorrection ?? true,
    frameBlending: opts.frameBlending ?? (rate < 1 ? 'optical-flow' : 'none'),
  };
}

export const clampRate = (rate: number): number =>
  Math.min(MAX_RATE, Math.max(MIN_RATE, rate));

export function isSpeedAltered(spec: SpeedSpec): boolean {
  if (spec.kind === 'freeze') return true;
  if (spec.kind === 'curve') return true;
  return spec.rate !== 1 || spec.reverse;
}

/** Human label for the clip badge: `2×`, `0.5× ramp`, `freeze`. */
export function describeSpeed(spec: SpeedSpec): string {
  switch (spec.kind) {
    case 'freeze':
      return 'Freeze';
    case 'curve': {
      const rates = spec.points.map((p) => p.rate);
      const lo = Math.min(...rates);
      const hi = Math.max(...rates);
      return `${trimNum(lo)}–${trimNum(hi)}× ramp${spec.reverse ? ' ⟲' : ''}`;
    }
    case 'constant':
      return `${trimNum(spec.rate)}×${spec.reverse ? ' ⟲' : ''}`;
  }
}

const trimNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ''));

// ---------------------------------------------------------------------------
// Rate curve evaluation
// ---------------------------------------------------------------------------

/** Rate at normalised progress `p` (0..1) along the clip. */
export function rateAt(points: readonly SpeedPoint[], p: number): number {
  if (points.length === 0) return 1;
  const sorted = points;
  if (p <= sorted[0].at) return Math.max(0, sorted[0].rate);
  const last = sorted[sorted.length - 1];
  if (p >= last.at) return Math.max(0, last.rate);

  let lo = 0;
  let hi = sorted.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].at <= p) lo = mid;
    else hi = mid;
  }
  const from = sorted[lo];
  const to = sorted[hi];
  const span = to.at - from.at;
  if (span <= 0) return Math.max(0, to.rate);

  const raw = (p - from.at) / span;
  let eased: number;
  switch (from.interpolation) {
    case 'hold':
      eased = 0;
      break;
    case 'bezier': {
      const b = from.bezier ?? EASING_PRESETS.easeInOut;
      eased = cubicBezierEase(raw, b[0], b[1], b[2], b[3]);
      break;
    }
    default:
      eased = raw;
  }
  return Math.max(0, from.rate + (to.rate - from.rate) * eased);
}

/**
 * Cumulative source-time table for a ramp, sampled uniformly across the clip.
 *
 * Resolution scales with clip length so a long ramp is not integrated more
 * coarsely than a short one, and is bounded so a 20-minute clip does not
 * allocate an unreasonable table.
 */
interface RampTable {
  /** `samples[i]` is the source ticks consumed by clip progress i/(n-1). */
  readonly samples: Float64Array;
  /** Total source ticks consumed over the whole clip. */
  readonly total: number;
}

const RAMP_CACHE = new WeakMap<readonly SpeedPoint[], Map<number, RampTable>>();

function buildRampTable(points: readonly SpeedPoint[], clipDuration: Ticks): RampTable {
  const n = Math.min(4096, Math.max(256, Math.ceil(clipDuration / 1e6)));
  const samples = new Float64Array(n + 1);
  const step = clipDuration / n;

  // Trapezoidal integration of rate over clip time. The rate curve is
  // piecewise-smooth, so trapezoid at this density is well inside a frame.
  let acc = 0;
  let prevRate = rateAt(points, 0);
  samples[0] = 0;
  for (let i = 1; i <= n; i++) {
    const rate = rateAt(points, i / n);
    acc += ((prevRate + rate) / 2) * step;
    samples[i] = acc;
    prevRate = rate;
  }
  return { samples, total: acc };
}

function rampTable(points: readonly SpeedPoint[], clipDuration: Ticks): RampTable {
  let byDuration = RAMP_CACHE.get(points);
  if (!byDuration) {
    byDuration = new Map();
    RAMP_CACHE.set(points, byDuration);
  }
  let table = byDuration.get(clipDuration);
  if (!table) {
    table = buildRampTable(points, clipDuration);
    byDuration.set(clipDuration, table);
  }
  return table;
}

// ---------------------------------------------------------------------------
// The two mappings every retime operation is built from
// ---------------------------------------------------------------------------

/**
 * Source ticks consumed by the whole clip — i.e. how much media a clip of
 * `clipDuration` on the timeline eats at this speed.
 */
export function sourceSpan(spec: SpeedSpec, clipDuration: Ticks): Ticks {
  switch (spec.kind) {
    case 'freeze':
      return 0;
    case 'constant':
      return Math.round(clipDuration * spec.rate);
    case 'curve':
      return Math.round(rampTable(spec.points, clipDuration).total);
  }
}

/**
 * Inverse of `sourceSpan`: the timeline duration needed to play `span` source
 * ticks. Used when the user changes speed and expects the clip to grow or
 * shrink while showing the same footage.
 */
export function durationForSourceSpan(spec: SpeedSpec, span: Ticks, hint: Ticks): Ticks {
  switch (spec.kind) {
    case 'freeze':
      return hint;
    case 'constant':
      return Math.round(span / spec.rate);
    case 'curve': {
      // The ramp is defined over normalised progress, so scaling the clip
      // duration scales the consumed span linearly. One probe recovers it.
      const probe = Math.max(1, hint);
      const consumed = rampTable(spec.points, probe).total;
      if (consumed <= 0) return hint;
      return Math.round((span / consumed) * probe);
    }
  }
}

/**
 * Offset into the source media, measured from the clip's `mediaIn`, at
 * `clipTime` ticks into the clip.
 *
 * `reverse` mirrors the result within the consumed span so that the clip plays
 * its footage backwards while still occupying the same timeline range.
 */
export function sourceOffsetAt(
  spec: SpeedSpec,
  clipTime: Ticks,
  clipDuration: Ticks,
): Ticks {
  if (spec.kind === 'freeze') return 0;

  const t = Math.min(Math.max(clipTime, 0), clipDuration);
  let forward: number;

  if (spec.kind === 'constant') {
    forward = t * spec.rate;
  } else {
    const { samples } = rampTable(spec.points, clipDuration);
    const n = samples.length - 1;
    const pos = (t / clipDuration) * n;
    const i = Math.min(n - 1, Math.floor(pos));
    const frac = pos - i;
    forward = samples[i] + (samples[i + 1] - samples[i]) * frac;
  }

  if (!spec.reverse) return Math.round(forward);
  return Math.round(sourceSpan(spec, clipDuration) - forward);
}

/**
 * Absolute source time to sample for a clip, accounting for freeze frames.
 * This is the single call a renderer needs.
 */
export function sourceTimeAt(
  spec: SpeedSpec,
  mediaIn: Ticks,
  clipTime: Ticks,
  clipDuration: Ticks,
): Ticks {
  if (spec.kind === 'freeze') return spec.sourceTime;
  return mediaIn + sourceOffsetAt(spec, clipTime, clipDuration);
}

/**
 * Instantaneous rate at `clipTime`, before `reverse`. Drives pitch shifting in
 * the audio graph and the frame-blending decision in the renderer.
 */
export function instantaneousRate(spec: SpeedSpec, clipTime: Ticks, clipDuration: Ticks): number {
  switch (spec.kind) {
    case 'freeze':
      return 0;
    case 'constant':
      return spec.rate;
    case 'curve':
      return rateAt(spec.points, clipDuration > 0 ? clipTime / clipDuration : 0);
  }
}

/**
 * Sample the ramp for drawing the speed-curve editor: `count` evenly spaced
 * rates across the clip.
 */
export function sampleRateCurve(spec: SpeedSpec, count = 64): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const p = count === 1 ? 0 : i / (count - 1);
    switch (spec.kind) {
      case 'freeze':
        out.push(0);
        break;
      case 'constant':
        out.push(spec.rate);
        break;
      case 'curve':
        out.push(rateAt(spec.points, p));
        break;
    }
  }
  return out;
}

/**
 * Restrict a speed spec to the sub-range `[p0, p1]` of the clip it belongs to,
 * renormalised back onto 0..1.
 *
 * This is what keeps a speed ramp intact when the clip carrying it is split or
 * trimmed: each piece keeps the portion of the curve it actually covered,
 * instead of the ramp snapping back to the piece's new edges.
 */
export function sliceSpeed(spec: SpeedSpec, p0: number, p1: number): SpeedSpec {
  if (spec.kind !== 'curve') return spec;
  const lo = Math.min(Math.max(p0, 0), 1);
  const hi = Math.min(Math.max(p1, 0), 1);
  if (hi <= lo) return spec;
  const span = hi - lo;

  const points: SpeedPoint[] = [];
  // Keep the endpoints exact by evaluating the curve there, then carry across
  // every authored point that falls strictly inside the slice.
  points.push({ at: 0, rate: rateAt(spec.points, lo), interpolation: 'linear' });
  for (const p of spec.points) {
    if (p.at > lo && p.at < hi) {
      points.push({ ...p, at: (p.at - lo) / span });
    }
  }
  points.push({ at: 1, rate: rateAt(spec.points, hi), interpolation: 'linear' });

  // Re-derive the interpolation of the leading point from whichever authored
  // segment it landed in, so an eased ramp does not become linear at the seam.
  const containing = [...spec.points].reverse().find((p) => p.at <= lo);
  if (containing) {
    points[0] = containing.bezier
      ? { ...points[0], interpolation: containing.interpolation, bezier: containing.bezier }
      : { ...points[0], interpolation: containing.interpolation };
  }

  return { ...spec, points: points.sort((a, b) => a.at - b.at) };
}

/** Default ramp used by the "Speed ramp" preset: dip to slow motion and back. */
export function slowMoRamp(slowRate = 0.25): SpeedSpec {
  return {
    kind: 'curve',
    reverse: false,
    pitchCorrection: true,
    frameBlending: 'optical-flow',
    points: [
      { at: 0, rate: 1, interpolation: 'bezier', bezier: EASING_PRESETS.easeInOut },
      { at: 0.35, rate: clampRate(slowRate), interpolation: 'linear' },
      { at: 0.65, rate: clampRate(slowRate), interpolation: 'bezier', bezier: EASING_PRESETS.easeInOut },
      { at: 1, rate: 1, interpolation: 'linear' },
    ],
  };
}
