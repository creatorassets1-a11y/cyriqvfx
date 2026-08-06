import type { Ticks } from '../time/time.js';
import {
  constant,
  evaluateNumber,
  type AnimatableNumber,
} from '../animation/keyframes.js';

/**
 * Colour grading parameters.
 *
 * Everything here is authored in scene-referred, human-meaningful units
 * (exposure in stops, temperature in Kelvin offset) and compiled by
 * `resolveGrade` into a flat set of numbers the shader consumes. The renderer
 * never sees a keyframe.
 */

export interface CurvePoint {
  /** Input 0..1. */
  readonly x: number;
  /** Output 0..1. */
  readonly y: number;
}

export interface ToneCurves {
  readonly luma: readonly CurvePoint[];
  readonly red: readonly CurvePoint[];
  readonly green: readonly CurvePoint[];
  readonly blue: readonly CurvePoint[];
}

export const IDENTITY_CURVE: readonly CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

export const IDENTITY_CURVES: ToneCurves = {
  luma: IDENTITY_CURVE,
  red: IDENTITY_CURVE,
  green: IDENTITY_CURVE,
  blue: IDENTITY_CURVE,
};

/** One of the six HSL bands the qualifier exposes. */
export type HslBand = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';

export const HSL_BANDS: readonly HslBand[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
];

export interface HslAdjustment {
  /** Degrees, −180..180. */
  readonly hue: number;
  /** −1..1. */
  readonly saturation: number;
  /** −1..1. */
  readonly luminance: number;
}

export const NEUTRAL_HSL: HslAdjustment = { hue: 0, saturation: 0, luminance: 0 };

/** A lift/gamma/gain wheel: an RGB offset plus a master. */
export interface ColorWheel {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly master: number;
}

export const NEUTRAL_WHEEL: ColorWheel = { r: 0, g: 0, b: 0, master: 0 };

export interface LutRef {
  /** Asset id of the imported .cube file. */
  readonly id: string;
  readonly name: string;
  /** 0..1 blend against the ungraded image. */
  readonly intensity: AnimatableNumber;
}

export interface ColorGrade {
  /** Stops. */
  readonly exposure: AnimatableNumber;
  /** −1..1. */
  readonly contrast: AnimatableNumber;
  readonly highlights: AnimatableNumber;
  readonly shadows: AnimatableNumber;
  readonly whites: AnimatableNumber;
  readonly blacks: AnimatableNumber;
  /** Kelvin offset, −100..100 mapped to a warm/cool shift. */
  readonly temperature: AnimatableNumber;
  readonly tint: AnimatableNumber;
  readonly saturation: AnimatableNumber;
  /** Saturation weighted towards already-desaturated pixels. */
  readonly vibrance: AnimatableNumber;
  readonly sharpen: AnimatableNumber;
  /** Positive blurs, used for the beauty/skin-soften path. */
  readonly blur: AnimatableNumber;
  readonly vignette: AnimatableNumber;
  readonly grain: AnimatableNumber;
  readonly fade: AnimatableNumber;
  readonly curves: ToneCurves;
  readonly hsl: Readonly<Record<HslBand, HslAdjustment>>;
  readonly lift: ColorWheel;
  readonly gamma: ColorWheel;
  readonly gain: ColorWheel;
  readonly offset: ColorWheel;
  readonly lut: LutRef | null;
}

export function neutralGrade(): ColorGrade {
  const zero = () => constant(0);
  return {
    exposure: zero(),
    contrast: zero(),
    highlights: zero(),
    shadows: zero(),
    whites: zero(),
    blacks: zero(),
    temperature: zero(),
    tint: zero(),
    saturation: zero(),
    vibrance: zero(),
    sharpen: zero(),
    blur: zero(),
    vignette: zero(),
    grain: zero(),
    fade: zero(),
    curves: IDENTITY_CURVES,
    hsl: Object.fromEntries(HSL_BANDS.map((b) => [b, NEUTRAL_HSL])) as Record<
      HslBand,
      HslAdjustment
    >,
    lift: NEUTRAL_WHEEL,
    gamma: NEUTRAL_WHEEL,
    gain: NEUTRAL_WHEEL,
    offset: NEUTRAL_WHEEL,
    lut: null,
  };
}

/** True when the grade would leave the image untouched — lets the renderer skip the pass. */
export function isNeutralGrade(g: ColorGrade | null): boolean {
  if (!g) return true;
  const scalars: AnimatableNumber[] = [
    g.exposure,
    g.contrast,
    g.highlights,
    g.shadows,
    g.whites,
    g.blacks,
    g.temperature,
    g.tint,
    g.saturation,
    g.vibrance,
    g.sharpen,
    g.blur,
    g.vignette,
    g.grain,
    g.fade,
  ];
  if (scalars.some((s) => s.keyframes.length > 0 || s.base !== 0)) return false;
  if (g.lut) return false;
  if (!isIdentityCurves(g.curves)) return false;
  for (const band of HSL_BANDS) {
    const h = g.hsl[band];
    if (h.hue !== 0 || h.saturation !== 0 || h.luminance !== 0) return false;
  }
  for (const w of [g.lift, g.gamma, g.gain, g.offset]) {
    if (w.r !== 0 || w.g !== 0 || w.b !== 0 || w.master !== 0) return false;
  }
  return true;
}

function isIdentityCurve(points: readonly CurvePoint[]): boolean {
  return (
    points.length === 2 &&
    points[0].x === 0 &&
    points[0].y === 0 &&
    points[1].x === 1 &&
    points[1].y === 1
  );
}

export function isIdentityCurves(c: ToneCurves): boolean {
  return (
    isIdentityCurve(c.luma) &&
    isIdentityCurve(c.red) &&
    isIdentityCurve(c.green) &&
    isIdentityCurve(c.blue)
  );
}

/**
 * A grade with every keyframe evaluated at a point in time — the exact struct
 * uploaded to the shader as a uniform block.
 */
export interface ResolvedGrade {
  readonly exposure: number;
  readonly contrast: number;
  readonly highlights: number;
  readonly shadows: number;
  readonly whites: number;
  readonly blacks: number;
  readonly temperature: number;
  readonly tint: number;
  readonly saturation: number;
  readonly vibrance: number;
  readonly sharpen: number;
  readonly blur: number;
  readonly vignette: number;
  readonly grain: number;
  readonly fade: number;
  readonly curves: ToneCurves;
  readonly hsl: Readonly<Record<HslBand, HslAdjustment>>;
  readonly lift: ColorWheel;
  readonly gamma: ColorWheel;
  readonly gain: ColorWheel;
  readonly offset: ColorWheel;
  readonly lut: { id: string; intensity: number } | null;
}

export function resolveGrade(g: ColorGrade, time: Ticks): ResolvedGrade {
  const n = (p: AnimatableNumber) => evaluateNumber(p, time);
  return {
    exposure: n(g.exposure),
    contrast: n(g.contrast),
    highlights: n(g.highlights),
    shadows: n(g.shadows),
    whites: n(g.whites),
    blacks: n(g.blacks),
    temperature: n(g.temperature),
    tint: n(g.tint),
    saturation: n(g.saturation),
    vibrance: n(g.vibrance),
    sharpen: n(g.sharpen),
    blur: n(g.blur),
    vignette: n(g.vignette),
    grain: n(g.grain),
    fade: n(g.fade),
    curves: g.curves,
    hsl: g.hsl,
    lift: g.lift,
    gamma: g.gamma,
    gain: g.gain,
    offset: g.offset,
    lut: g.lut ? { id: g.lut.id, intensity: n(g.lut.intensity) } : null,
  };
}

/**
 * Evaluate a tone curve as a monotone cubic (Fritsch–Carlson) spline, which is
 * the interpolation that will not overshoot and introduce banding artefacts the
 * way a natural cubic does.
 */
export function evaluateCurve(points: readonly CurvePoint[], x: number): number {
  if (points.length === 0) return x;
  if (points.length === 1) return points[0].y;

  const p = [...points].sort((a, b) => a.x - b.x);
  if (x <= p[0].x) return p[0].y;
  if (x >= p[p.length - 1].x) return p[p.length - 1].y;

  const n = p.length;
  const slopes = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const dx = p[i + 1].x - p[i].x;
    slopes[i] = dx === 0 ? 0 : (p[i + 1].y - p[i].y) / dx;
  }

  const tangents = new Array<number>(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slopes[i - 1] * slopes[i] <= 0) tangents[i] = 0;
    else tangents[i] = (slopes[i - 1] + slopes[i]) / 2;
  }
  // Fritsch–Carlson limiter keeps the spline monotone between control points.
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / slopes[i];
    const b = tangents[i + 1] / slopes[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      tangents[i] = t * a * slopes[i];
      tangents[i + 1] = t * b * slopes[i];
    }
  }

  let i = 0;
  while (i < n - 2 && x > p[i + 1].x) i++;
  const h = p[i + 1].x - p[i].x;
  const t = (x - p[i].x) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * p[i].y + h10 * h * tangents[i] + h01 * p[i + 1].y + h11 * h * tangents[i + 1];
}

/** Bake a curve into a 256-entry LUT for upload as a 1D texture. */
export function curveToLut(points: readonly CurvePoint[], size = 256): Float32Array {
  const lut = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    lut[i] = Math.min(1, Math.max(0, evaluateCurve(points, i / (size - 1))));
  }
  return lut;
}
