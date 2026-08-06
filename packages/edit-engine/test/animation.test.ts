import { describe, expect, it } from 'vitest';
import {
  constant,
  cubicBezierEase,
  EASING_PRESETS,
  evaluateCurve,
  evaluateNumber,
  evaluateVec2,
  keyframeTimes,
  lerpNumber,
  moveKeyframe,
  removeKeyframe,
  rescaleKeyframes,
  setKeyframe,
  shiftKeyframes,
  velocity,
  type AnimatableNumber,
} from '../src/index.js';

const animated = (points: [number, number][], interpolation: 'linear' | 'hold' | 'smooth' | 'bezier' = 'linear'): AnimatableNumber => {
  let prop = constant(0);
  for (const [time, value] of points) prop = setKeyframe(prop, time, value, interpolation);
  return prop;
};

describe('keyframe evaluation', () => {
  it('returns the base value when there are no keyframes', () => {
    expect(evaluateNumber(constant(7), 1000)).toBe(7);
  });

  it('interpolates linearly between two keyframes', () => {
    const prop = animated([
      [0, 0],
      [100, 10],
    ]);
    expect(evaluateNumber(prop, 0)).toBe(0);
    expect(evaluateNumber(prop, 50)).toBe(5);
    expect(evaluateNumber(prop, 100)).toBe(10);
  });

  it('holds the value outside the keyframed range', () => {
    const prop = animated([
      [100, 3],
      [200, 9],
    ]);
    expect(evaluateNumber(prop, 0)).toBe(3);
    expect(evaluateNumber(prop, 1_000_000)).toBe(9);
  });

  it('hold interpolation steps rather than ramps', () => {
    const prop = animated(
      [
        [0, 0],
        [100, 10],
      ],
      'hold',
    );
    expect(evaluateNumber(prop, 99)).toBe(0);
    expect(evaluateNumber(prop, 100)).toBe(10);
  });

  it('keeps keyframes sorted regardless of insertion order', () => {
    let prop = constant(0);
    prop = setKeyframe(prop, 300, 3);
    prop = setKeyframe(prop, 100, 1);
    prop = setKeyframe(prop, 200, 2);
    expect(prop.keyframes.map((k) => k.time)).toEqual([100, 200, 300]);
  });

  it('overwrites a keyframe at an identical time instead of duplicating', () => {
    let prop = setKeyframe(constant(0), 100, 1);
    prop = setKeyframe(prop, 100, 5);
    expect(prop.keyframes).toHaveLength(1);
    expect(prop.keyframes[0].value).toBe(5);
  });

  it('removes and moves keyframes', () => {
    let prop = animated([
      [0, 0],
      [100, 1],
      [200, 2],
    ]);
    expect(removeKeyframe(prop, 100).keyframes).toHaveLength(2);
    prop = moveKeyframe(prop, 100, 150);
    expect(prop.keyframes.map((k) => k.time)).toEqual([0, 150, 200]);
  });

  it('interpolates vectors component-wise', () => {
    let prop = constant({ x: 0, y: 0 });
    prop = setKeyframe(prop, 0, { x: 0, y: 10 });
    prop = setKeyframe(prop, 100, { x: 10, y: 0 });
    expect(evaluateVec2(prop, 50)).toEqual({ x: 5, y: 5 });
  });

  it('finds the right segment with many keyframes', () => {
    let prop = constant(0);
    for (let i = 0; i <= 100; i++) prop = setKeyframe(prop, i * 10, i);
    expect(evaluateNumber(prop, 555)).toBeCloseTo(55.5, 6);
  });

  it('reports velocity as units per tick', () => {
    const prop = animated([
      [0, 0],
      [1000, 10],
    ]);
    expect(velocity(prop, 500, 10)).toBeCloseTo(0.01, 8);
  });

  it('rescales keyframes proportionally when a clip is retimed', () => {
    const prop = animated([
      [0, 0],
      [100, 1],
      [200, 2],
    ]);
    const scaled = rescaleKeyframes(prop, 200, 400);
    expect(scaled.keyframes.map((k) => k.time)).toEqual([0, 200, 400]);
  });

  it('shifts keyframes when a clip head moves', () => {
    const prop = animated([
      [100, 1],
      [200, 2],
    ]);
    expect(shiftKeyframes(prop, -50).keyframes.map((k) => k.time)).toEqual([50, 150]);
  });

  it('collects distinct keyframe times across properties', () => {
    const a = animated([
      [0, 0],
      [100, 1],
    ]);
    const b = animated([
      [100, 0],
      [300, 1],
    ]);
    expect(keyframeTimes([a, b])).toEqual([0, 100, 300]);
  });
});

describe('cubic bezier easing', () => {
  it('is the identity for a linear curve', () => {
    for (const x of [0, 0.25, 0.5, 0.75, 1]) {
      expect(cubicBezierEase(x, 0, 0, 1, 1)).toBeCloseTo(x, 6);
    }
  });

  it('pins both endpoints', () => {
    const [x1, y1, x2, y2] = EASING_PRESETS.easeInOut;
    expect(cubicBezierEase(0, x1, y1, x2, y2)).toBe(0);
    expect(cubicBezierEase(1, x1, y1, x2, y2)).toBe(1);
  });

  it('is symmetric for easeInOut', () => {
    const [x1, y1, x2, y2] = EASING_PRESETS.easeInOut;
    const a = cubicBezierEase(0.25, x1, y1, x2, y2);
    const b = cubicBezierEase(0.75, x1, y1, x2, y2);
    expect(a + b).toBeCloseTo(1, 4);
  });

  it('increases monotonically for standard presets', () => {
    for (const preset of ['ease', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      const [x1, y1, x2, y2] = EASING_PRESETS[preset];
      let previous = -Infinity;
      for (let i = 0; i <= 100; i++) {
        const value = cubicBezierEase(i / 100, x1, y1, x2, y2);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = value;
      }
    }
  });

  it('overshoots for backOut, which is the point of it', () => {
    const [x1, y1, x2, y2] = EASING_PRESETS.backOut;
    const peak = Math.max(
      ...Array.from({ length: 101 }, (_, i) => cubicBezierEase(i / 100, x1, y1, x2, y2)),
    );
    expect(peak).toBeGreaterThan(1);
  });

  it('solves the flat region without diverging', () => {
    // A curve with a near-zero derivative at the start exercises the bisection
    // fallback rather than Newton–Raphson.
    const value = cubicBezierEase(0.01, 1, 0, 1, 1);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  });
});

describe('tone curves', () => {
  it('is the identity for the default two-point curve', () => {
    const identity = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    for (const x of [0, 0.3, 0.5, 0.9, 1]) {
      expect(evaluateCurve(identity, x)).toBeCloseTo(x, 6);
    }
  });

  it('stays monotone through an S-curve, so it cannot band', () => {
    const s = [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.15 },
      { x: 0.75, y: 0.85 },
      { x: 1, y: 1 },
    ];
    let previous = -Infinity;
    for (let i = 0; i <= 200; i++) {
      const value = evaluateCurve(s, i / 200);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });

  it('does not overshoot past a flat shoulder', () => {
    const shoulder = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.9 },
      { x: 1, y: 0.9 },
    ];
    for (let i = 0; i <= 100; i++) {
      expect(evaluateCurve(shoulder, i / 100)).toBeLessThanOrEqual(0.9 + 1e-9);
    }
  });

  it('clamps outside the control point range', () => {
    const curve = [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.7 },
    ];
    expect(evaluateCurve(curve, 0)).toBe(0.3);
    expect(evaluateCurve(curve, 1)).toBe(0.7);
  });
});

describe('lerp', () => {
  it('is exact at both ends', () => {
    expect(lerpNumber(3, 9, 0)).toBe(3);
    expect(lerpNumber(3, 9, 1)).toBe(9);
  });
});
