import { describe, expect, it } from 'vitest';
import {
  buildMatrix,
  composeAudioBlock,
  composeFrame,
  constantSpeed,
  createClip,
  estimateFileSize,
  EXPORT_PRESETS,
  exportWarnings,
  frameCost,
  neutralGrade,
  overwriteClip,
  putClip,
  recommendedBitrate,
  requiredMedia,
  setTransition,
  settingsFromPreset,
  updateClip,
  updateTrack,
  FRAME_RATES,
} from '../src/index.js';
import { f, fixture, place } from './helpers.js';

describe('composeFrame', () => {
  it('produces nothing for an empty timeline', () => {
    const fx = fixture();
    expect(composeFrame(fx.doc, 0).layers).toEqual([]);
  });

  it('includes only the clips covering the requested time', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 50);
    doc = place({ ...fx, doc }, fx.v1, 100, 50).doc;

    expect(composeFrame(doc, f(25)).layers).toHaveLength(1);
    expect(composeFrame(doc, f(75)).layers).toHaveLength(0);
    expect(composeFrame(doc, f(120)).layers).toHaveLength(1);
  });

  it('stacks higher tracks on top', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 50);
    doc = place({ ...fx, doc }, fx.v2, 0, 50).doc;

    const layers = composeFrame(doc, f(10)).layers;
    expect(layers).toHaveLength(2);
    expect(layers[0].trackId).toBe(fx.v1);
    expect(layers[1].trackId).toBe(fx.v2);
    expect(layers[1].z).toBeGreaterThan(layers[0].z);
  });

  it('skips disabled tracks and disabled clips', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 50);
    expect(composeFrame(updateTrack(doc, fx.v1, { enabled: false }), f(10)).layers).toHaveLength(0);
    expect(composeFrame(updateClip(doc, id, { enabled: false }), f(10)).layers).toHaveLength(0);
  });

  it('resolves the source time through the speed map', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100, 30);
    const fast = updateClip(doc, id, { speed: constantSpeed(2) });

    const layer = composeFrame(fast, f(10)).layers[0];
    expect(layer.source.kind).toBe('media');
    if (layer.source.kind === 'media') {
      // 10 frames in at 2× is 20 frames of source past a mediaIn of 30.
      expect(layer.source.sourceTime).toBe(f(50));
      expect(layer.source.rate).toBe(2);
    }
  });

  it('leaves no keyframes in the output', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    const animated = updateClip(doc, id, (clip) => ({
      transform: {
        ...clip.transform,
        opacity: {
          base: 1,
          keyframes: [
            { time: 0, value: 0, interpolation: 'linear' as const },
            { time: f(100), value: 1, interpolation: 'linear' as const },
          ],
        },
      },
    }));

    expect(composeFrame(animated, f(50)).layers[0].opacity).toBeCloseTo(0.5, 6);
  });

  it('culls fully transparent layers', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    const invisible = updateClip(doc, id, (clip) => ({
      transform: { ...clip.transform, opacity: { base: 0, keyframes: [] } },
    }));
    expect(composeFrame(invisible, f(10)).layers).toHaveLength(0);
    expect(composeFrame(invisible, f(10), { cullInvisible: false }).layers).toHaveLength(1);
  });

  it('omits a neutral grade so the renderer can skip the pass', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    const graded = updateClip(doc, id, { grade: neutralGrade() });
    expect(composeFrame(graded, f(10)).layers[0].grade).toBeNull();

    const lifted = updateClip(doc, id, {
      grade: { ...neutralGrade(), exposure: { base: 0.5, keyframes: [] } },
    });
    expect(composeFrame(lifted, f(10)).layers[0].grade).not.toBeNull();
  });

  it('reports both sides of a transition while it overlaps', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 0, 50, 100);
    doc = place({ ...fx, doc }, fx.v1, 50, 50, 100).doc;
    const second = doc.trackClips[fx.v1][1];
    doc = setTransition(doc, second, 'cross-dissolve', f(10));

    const frame = composeFrame(doc, f(48));
    expect(frame.transitions).toHaveLength(1);
    expect(frame.layers).toHaveLength(2);
    const transition = frame.transitions[0];
    expect(transition.progress).toBeGreaterThan(0);
    expect(transition.progress).toBeLessThan(1);
    expect(frame.layers[transition.fromLayer].clipId).not.toBe(
      frame.layers[transition.toLayer].clipId,
    );
  });

  it('lists the media a renderer must decode', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.v1, 0, 50);
    expect(requiredMedia(composeFrame(doc, f(10)))).toEqual([
      { mediaId: fx.mediaId, sourceTime: f(10) },
    ]);
  });

  it('scores a heavier stack as more expensive', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    const plain = frameCost(composeFrame(doc, f(10)));

    const heavy = updateClip(doc, id, {
      effects: [
        { id: 'e1', type: 'glitch', enabled: true, params: {} },
        { id: 'e2', type: 'bloom', enabled: true, params: {} },
      ],
      chromaKey: {
        enabled: true,
        keyColor: '#00ff00',
        similarity: { base: 0.4, keyframes: [] },
        smoothness: { base: 0.1, keyframes: [] },
        spillSuppression: { base: 0.5, keyframes: [] },
      },
    });
    expect(frameCost(composeFrame(heavy, f(10)))).toBeGreaterThan(plain);
  });
});

describe('transform matrix', () => {
  const identity = { x: 0, y: 0 };

  it('is the identity for a default transform', () => {
    expect(buildMatrix(identity, { x: 1, y: 1 }, 0, identity, false, false)).toEqual([
      1, 0, 0, 1, 0, 0,
    ]);
  });

  it('encodes translation', () => {
    const m = buildMatrix({ x: 0.25, y: -0.1 }, { x: 1, y: 1 }, 0, identity, false, false);
    expect(m[4]).toBeCloseTo(0.25, 9);
    expect(m[5]).toBeCloseTo(-0.1, 9);
  });

  it('encodes scale', () => {
    const m = buildMatrix(identity, { x: 2, y: 3 }, 0, identity, false, false);
    expect(m[0]).toBeCloseTo(2, 9);
    expect(m[3]).toBeCloseTo(3, 9);
  });

  it('rotates 90 degrees into a clean swap', () => {
    const m = buildMatrix(identity, { x: 1, y: 1 }, 90, identity, false, false);
    expect(m[0]).toBeCloseTo(0, 9);
    expect(m[1]).toBeCloseTo(1, 9);
    expect(m[2]).toBeCloseTo(-1, 9);
    expect(m[3]).toBeCloseTo(0, 9);
  });

  it('mirrors on flip', () => {
    expect(buildMatrix(identity, { x: 1, y: 1 }, 0, identity, true, false)[0]).toBeCloseTo(-1, 9);
    expect(buildMatrix(identity, { x: 1, y: 1 }, 0, identity, false, true)[3]).toBeCloseTo(-1, 9);
  });

  it('leaves the anchor point fixed under scaling', () => {
    const anchor = { x: 0.3, y: 0.2 };
    const m = buildMatrix(identity, { x: 2, y: 2 }, 0, anchor, false, false);
    // Applying the matrix to the anchor must return the anchor itself.
    const x = m[0] * anchor.x + m[2] * anchor.y + m[4];
    const y = m[1] * anchor.x + m[3] * anchor.y + m[5];
    expect(x).toBeCloseTo(anchor.x, 9);
    expect(y).toBeCloseTo(anchor.y, 9);
  });
});

describe('audio graph', () => {
  it('emits a region for each audible clip in the block', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.a1, 0, 100);
    const block = composeAudioBlock(doc, { start: 0, duration: f(10) });
    expect(block.regions).toHaveLength(1);
    expect(block.regions[0].duration).toBe(f(10));
  });

  it('clips the region to the overlap with the block', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.a1, 5, 10);
    const block = composeAudioBlock(doc, { start: 0, duration: f(20) });
    expect(block.regions[0].offsetInBlock).toBe(f(5));
    expect(block.regions[0].duration).toBe(f(10));
  });

  it('silences every non-soloed track when anything is soloed', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.a1, 0, 50);
    doc = updateTrack(doc, fx.v1, { solo: true });
    const block = composeAudioBlock(doc, { start: 0, duration: f(10) });
    expect(block.trackGain[fx.a1]).toBe(0);
    expect(block.trackGain[fx.v1]).toBeGreaterThan(0);
  });

  it('reports a muted track as silent', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.a1, 0, 50);
    doc = updateTrack(doc, fx.a1, { muted: true });
    expect(composeAudioBlock(doc, { start: 0, duration: f(10) }).trackGain[fx.a1]).toBe(0);
  });

  it('ramps gain across a fade rather than stepping', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.a1, 0, 100);
    const faded = updateClip(doc, id, (clip) => ({
      audio: { ...clip.audio!, fadeIn: { duration: f(50), shape: 'linear' as const } },
    }));
    const block = composeAudioBlock(faded, { start: 0, duration: f(25) });
    expect(block.regions[0].gainStart).toBeCloseTo(0, 6);
    expect(block.regions[0].gainEnd).toBeCloseTo(0.5, 6);
  });
});

describe('export settings', () => {
  it('scales bitrate with pixel rate', () => {
    const hd = recommendedBitrate({ width: 1920, height: 1080 }, FRAME_RATES.fps30, 'h264');
    const uhd = recommendedBitrate({ width: 3840, height: 2160 }, FRAME_RATES.fps30, 'h264');
    const hd60 = recommendedBitrate({ width: 1920, height: 1080 }, FRAME_RATES.fps60, 'h264');
    expect(uhd).toBeGreaterThan(hd);
    expect(hd60).toBeGreaterThan(hd);
  });

  it('asks less of HEVC than H.264 for the same frame', () => {
    const res = { width: 1920, height: 1080 };
    expect(recommendedBitrate(res, FRAME_RATES.fps30, 'hevc')).toBeLessThan(
      recommendedBitrate(res, FRAME_RATES.fps30, 'h264'),
    );
  });

  it('derives even dimensions from every preset', () => {
    const fx = fixture();
    for (const preset of EXPORT_PRESETS) {
      const settings = settingsFromPreset(fx.doc, preset);
      expect(settings.resolution.width % 2).toBe(0);
      expect(settings.resolution.height % 2).toBe(0);
    }
  });

  it('warns when the timeline is empty', () => {
    const fx = fixture();
    const settings = settingsFromPreset(fx.doc, EXPORT_PRESETS[0]);
    expect(exportWarnings(fx.doc, settings).some((w) => w.message.includes('empty'))).toBe(true);
  });

  it('warns when the export is longer than the destination allows', () => {
    const fx = fixture({ mediaFrames: 60 * 30 * 10 });
    // Ten minutes of timeline against the Shorts limit of three.
    const doc = overwriteClip(
      fx.doc,
      createClip({
        trackId: fx.v1,
        start: 0,
        duration: f(60 * 30 * 10),
        content: { kind: 'media', mediaId: fx.mediaId },
      }),
    );
    const shorts = EXPORT_PRESETS.find((p) => p.id === 'shorts')!;
    const settings = settingsFromPreset(doc, shorts);
    expect(exportWarnings(doc, settings, shorts).some((w) => w.severity === 'warning')).toBe(true);
  });

  it('estimates a plausible file size', () => {
    const fx = fixture();
    const doc = putClip(
      fx.doc,
      createClip({
        trackId: fx.v1,
        start: 0,
        duration: f(30 * 60),
        content: { kind: 'media', mediaId: fx.mediaId },
      }),
    );
    const settings = settingsFromPreset(doc, EXPORT_PRESETS[0]);
    const bytes = estimateFileSize(doc, settings);
    // One minute at roughly 12 Mbps is on the order of 90 MB.
    expect(bytes).toBeGreaterThan(50_000_000);
    expect(bytes).toBeLessThan(200_000_000);
  });
});
