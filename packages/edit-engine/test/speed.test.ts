import { describe, expect, it } from 'vitest';
import {
  constantSpeed,
  describeSpeed,
  durationForSourceSpan,
  instantaneousRate,
  NORMAL_SPEED,
  rateAt,
  setClipSpeed,
  sliceSpeed,
  slowMoRamp,
  sourceOffsetAt,
  sourceTimeAt,
  sourceSpan,
  splitClip,
  type SpeedSpec,
} from '../src/index.js';
import { f, fixture, layout, place } from './helpers.js';

const CLIP = f(100);

describe('constant speed', () => {
  it('maps one-to-one at 1×', () => {
    expect(sourceOffsetAt(NORMAL_SPEED, f(40), CLIP)).toBe(f(40));
    expect(sourceSpan(NORMAL_SPEED, CLIP)).toBe(CLIP);
  });

  it('consumes twice the source at 2×', () => {
    const spec = constantSpeed(2);
    expect(sourceSpan(spec, CLIP)).toBe(f(200));
    expect(sourceOffsetAt(spec, f(50), CLIP)).toBe(f(100));
  });

  it('consumes half the source at 0.5×', () => {
    const spec = constantSpeed(0.5);
    expect(sourceSpan(spec, CLIP)).toBe(f(50));
  });

  it('clamps the rate to the supported range', () => {
    expect(constantSpeed(0.001)).toMatchObject({ rate: 0.1 });
    expect(constantSpeed(1000)).toMatchObject({ rate: 100 });
  });

  it('reverse plays the same span backwards', () => {
    const spec = constantSpeed(1, { reverse: true });
    expect(sourceOffsetAt(spec, 0, CLIP)).toBe(CLIP);
    expect(sourceOffsetAt(spec, CLIP, CLIP)).toBe(0);
    expect(sourceOffsetAt(spec, f(25), CLIP)).toBe(f(75));
  });

  it('defaults to optical flow when slowing down', () => {
    expect(constantSpeed(0.25).frameBlending).toBe('optical-flow');
    expect(constantSpeed(2).frameBlending).toBe('none');
  });
});

describe('freeze frame', () => {
  it('always samples the same source time', () => {
    const spec: SpeedSpec = { kind: 'freeze', sourceTime: f(123) };
    for (const t of [0, f(10), f(99)]) {
      expect(sourceTimeAt(spec, f(500), t, CLIP)).toBe(f(123));
    }
  });

  it('consumes no source at all', () => {
    expect(sourceSpan({ kind: 'freeze', sourceTime: 0 }, CLIP)).toBe(0);
  });
});

describe('speed ramps', () => {
  const ramp = slowMoRamp(0.25);

  it('is monotonically non-decreasing through the ramp', () => {
    let previous = -1;
    for (let i = 0; i <= 200; i++) {
      const offset = sourceOffsetAt(ramp, (CLIP * i) / 200, CLIP);
      expect(offset).toBeGreaterThanOrEqual(previous);
      previous = offset;
    }
  });

  it('starts at zero and ends at the full consumed span', () => {
    expect(sourceOffsetAt(ramp, 0, CLIP)).toBe(0);
    expect(sourceOffsetAt(ramp, CLIP, CLIP)).toBe(sourceSpan(ramp, CLIP));
  });

  it('consumes less source than 1× because it spends time in slow motion', () => {
    expect(sourceSpan(ramp, CLIP)).toBeLessThan(CLIP);
  });

  it('integrates a constant-rate curve to exactly that rate', () => {
    const flat: SpeedSpec = {
      kind: 'curve',
      reverse: false,
      pitchCorrection: true,
      frameBlending: 'none',
      points: [
        { at: 0, rate: 2, interpolation: 'linear' },
        { at: 1, rate: 2, interpolation: 'linear' },
      ],
    };
    // Trapezoidal integration of a constant is exact.
    expect(sourceSpan(flat, CLIP)).toBe(f(200));
  });

  it('integrates a linear ramp to the area under it', () => {
    const linear: SpeedSpec = {
      kind: 'curve',
      reverse: false,
      pitchCorrection: true,
      frameBlending: 'none',
      points: [
        { at: 0, rate: 0, interpolation: 'linear' },
        { at: 1, rate: 2, interpolation: 'linear' },
      ],
    };
    // Mean rate is 1, so the clip consumes its own length.
    expect(sourceSpan(linear, CLIP)).toBeCloseTo(CLIP, -3);
  });

  it('reports the instantaneous rate along the curve', () => {
    expect(instantaneousRate(ramp, 0, CLIP)).toBeCloseTo(1, 6);
    expect(instantaneousRate(ramp, CLIP / 2, CLIP)).toBeCloseTo(0.25, 6);
    expect(instantaneousRate(ramp, CLIP, CLIP)).toBeCloseTo(1, 6);
  });

  it('clamps rate lookups outside the curve', () => {
    const points = [
      { at: 0.2, rate: 2, interpolation: 'linear' as const },
      { at: 0.8, rate: 4, interpolation: 'linear' as const },
    ];
    expect(rateAt(points, 0)).toBe(2);
    expect(rateAt(points, 1)).toBe(4);
  });
});

describe('inverse mapping', () => {
  it('recovers the duration for a source span at constant rate', () => {
    const spec = constantSpeed(4);
    expect(durationForSourceSpan(spec, f(400), CLIP)).toBe(f(100));
  });

  it('round-trips a ramp within a frame', () => {
    const ramp = slowMoRamp(0.5);
    const span = sourceSpan(ramp, CLIP);
    const recovered = durationForSourceSpan(ramp, span, CLIP);
    expect(Math.abs(recovered - CLIP)).toBeLessThan(f(1));
  });
});

describe('slicing a ramp', () => {
  const ramp = slowMoRamp(0.25);

  it('preserves the rate at the slice boundaries', () => {
    const sliced = sliceSpeed(ramp, 0.35, 0.65);
    expect(rateAt((sliced as Extract<SpeedSpec, { kind: 'curve' }>).points, 0)).toBeCloseTo(0.25, 5);
    expect(rateAt((sliced as Extract<SpeedSpec, { kind: 'curve' }>).points, 1)).toBeCloseTo(0.25, 5);
  });

  it('keeps a slice of a constant-rate spec untouched', () => {
    const spec = constantSpeed(2);
    expect(sliceSpeed(spec, 0.2, 0.8)).toBe(spec);
  });

  it('carries interior control points across, renormalised', () => {
    const sliced = sliceSpeed(ramp, 0, 0.5) as Extract<SpeedSpec, { kind: 'curve' }>;
    // The 0.35 point of the original lands at 0.7 of a half-length slice.
    expect(sliced.points.some((p) => Math.abs(p.at - 0.7) < 1e-9)).toBe(true);
  });
});

describe('applying speed to a clip', () => {
  it('keep-source doubles the clip length when halving the rate', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    const clip = setClipSpeed(doc, doc.clips[id], constantSpeed(0.5));
    expect(clip.duration).toBe(f(200));
  });

  it('keep-source halves the clip length when doubling the rate', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    const clip = setClipSpeed(doc, doc.clips[id], constantSpeed(2));
    expect(clip.duration).toBe(f(50));
  });

  it('keep-duration holds the slot and eats more footage', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    const clip = setClipSpeed(doc, doc.clips[id], constantSpeed(2), 'keep-duration');
    expect(clip.duration).toBe(f(100));
    expect(sourceSpan(clip.speed, clip.duration)).toBe(f(200));
  });

  it('keep-duration shortens rather than running off the end of the media', () => {
    const fx = fixture({ mediaFrames: 120 });
    const { doc, id } = place(fx, fx.v1, 0, 100);
    const clip = setClipSpeed(doc, doc.clips[id], constantSpeed(4), 'keep-duration');
    // Only 120 frames of source exist, so at 4× the clip can only last 30.
    expect(clip.duration).toBe(f(30));
  });

  it('rescales keyframes so animation stays on the same content', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    const withKeys = {
      ...doc.clips[id],
      transform: {
        ...doc.clips[id].transform,
        opacity: {
          base: 1,
          keyframes: [
            { time: 0, value: 0, interpolation: 'linear' as const },
            { time: f(100), value: 1, interpolation: 'linear' as const },
          ],
        },
      },
    };
    const slowed = setClipSpeed(doc, withKeys, constantSpeed(0.5));
    expect(slowed.transform.opacity.keyframes[1].time).toBe(f(200));
  });
});

describe('labels', () => {
  it('describes each kind of retime', () => {
    expect(describeSpeed(NORMAL_SPEED)).toBe('1×');
    expect(describeSpeed(constantSpeed(2, { reverse: true }))).toBe('2× ⟲');
    expect(describeSpeed({ kind: 'freeze', sourceTime: 0 })).toBe('Freeze');
    expect(describeSpeed(slowMoRamp(0.25))).toContain('ramp');
  });
});

describe('split under a ramp', () => {
  it('lands the second half on the frame the first half ended on', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    const ramped = { ...doc.clips[id], speed: slowMoRamp(0.25) };
    const withRamp = { ...doc, clips: { ...doc.clips, [id]: ramped } };

    const expectedSource = sourceOffsetAt(ramped.speed, f(40), f(100));
    const out = splitClip(withRamp, id, f(40));

    const [, secondId] = out.trackClips[fx.v1];
    expect(Math.abs(out.clips[secondId].mediaIn - expectedSource)).toBeLessThan(f(1));
    expect(layout(out, fx.v1)).toEqual([
      [0, 40],
      [40, 60],
    ]);
  });
});
