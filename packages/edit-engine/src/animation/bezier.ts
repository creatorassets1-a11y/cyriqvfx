/**
 * Cubic Bézier easing solved the way browsers and NLEs do it: Newton–Raphson
 * on x to recover the parameter t, with a bisection fallback for the flat
 * regions where the derivative is too small to converge.
 */

const NEWTON_ITERATIONS = 8;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_EPSILON = 1e-7;
const SUBDIVISION_MAX_ITERATIONS = 12;

const A = (a1: number, a2: number) => 1.0 - 3.0 * a2 + 3.0 * a1;
const B = (a1: number, a2: number) => 3.0 * a2 - 6.0 * a1;
const C = (a1: number) => 3.0 * a1;

/** Value of the unit cubic Bézier with control points (a1, a2) at parameter t. */
export function bezierValue(t: number, a1: number, a2: number): number {
  return ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
}

/** Derivative of `bezierValue` with respect to t. */
export function bezierSlope(t: number, a1: number, a2: number): number {
  return 3.0 * A(a1, a2) * t * t + 2.0 * B(a1, a2) * t + C(a1);
}

function newtonRaphson(x: number, guess: number, x1: number, x2: number): number {
  let t = guess;
  for (let i = 0; i < NEWTON_ITERATIONS; i++) {
    const slope = bezierSlope(t, x1, x2);
    if (slope === 0) return t;
    t -= (bezierValue(t, x1, x2) - x) / slope;
  }
  return t;
}

function binarySubdivide(x: number, lower: number, upper: number, x1: number, x2: number): number {
  let a = lower;
  let b = upper;
  let t = 0;
  let error = 0;
  let i = 0;
  do {
    t = a + (b - a) / 2;
    error = bezierValue(t, x1, x2) - x;
    if (error > 0) b = t;
    else a = t;
  } while (Math.abs(error) > SUBDIVISION_EPSILON && ++i < SUBDIVISION_MAX_ITERATIONS);
  return t;
}

/**
 * Evaluate a CSS-style cubic-bezier(x1, y1, x2, y2) easing at progress `x`
 * in 0..1. Control x values are clamped to 0..1 so the curve stays a function.
 */
export function cubicBezierEase(
  x: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const cx1 = Math.min(1, Math.max(0, x1));
  const cx2 = Math.min(1, Math.max(0, x2));
  if (cx1 === y1 && cx2 === y2) return x; // linear
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const slope = bezierSlope(x, cx1, cx2);
  const t =
    slope >= NEWTON_MIN_SLOPE
      ? newtonRaphson(x, x, cx1, cx2)
      : binarySubdivide(x, 0, 1, cx1, cx2);

  return bezierValue(t, y1, y2);
}

export const EASING_PRESETS = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  /** Overshoots past the target and settles — the "pop" caption animation. */
  backOut: [0.34, 1.56, 0.64, 1],
  anticipate: [0.68, -0.55, 0.27, 1.55],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type EasingPresetName = keyof typeof EASING_PRESETS;
