import { describe, expect, it } from 'vitest';
import {
  buildPackageManifest,
  createClip,
  deserialize,
  documentDuration,
  ProjectLoadError,
  putClip,
  SCHEMA_VERSION,
  serialize,
  splitClip,
  updateClip,
} from '../src/index.js';
import { f, fixture, layout, place } from './helpers.js';

describe('round trip', () => {
  it('preserves the timeline exactly', () => {
    const fx = fixture();
    let { doc, id } = place(fx, fx.v1, 0, 100, 40);
    doc = splitClip(doc, id, f(50));
    doc = place({ ...fx, doc }, fx.a1, 20, 60).doc;

    const { document } = deserialize(serialize(doc));
    expect(layout(document, fx.v1)).toEqual(layout(doc, fx.v1));
    expect(layout(document, fx.a1)).toEqual(layout(doc, fx.a1));
    expect(documentDuration(document)).toBe(documentDuration(doc));
  });

  it('preserves keyframes', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    const animated = updateClip(doc, id, (clip) => ({
      transform: {
        ...clip.transform,
        opacity: {
          base: 1,
          keyframes: [
            { time: 0, value: 0, interpolation: 'bezier' as const, bezier: [0.42, 0, 0.58, 1] as const },
            { time: f(100), value: 1, interpolation: 'linear' as const },
          ],
        },
      },
    }));

    const { document } = deserialize(serialize(animated));
    const opacity = document.clips[id].transform.opacity;
    expect(opacity.keyframes).toHaveLength(2);
    expect(opacity.keyframes[0].bezier).toEqual([0.42, 0, 0.58, 1]);
  });

  it('does not write the derived track index', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.v1, 0, 100);
    expect(JSON.parse(serialize(doc)).document.trackClips).toBeUndefined();
  });

  it('rebuilds the track index on load', () => {
    const fx = fixture();
    let { doc } = place(fx, fx.v1, 100, 50);
    doc = place({ ...fx, doc }, fx.v1, 0, 50).doc;

    const { document } = deserialize(serialize(doc));
    const starts = document.trackClips[fx.v1].map((id) => document.clips[id].start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('is stable across a second round trip', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.v1, 0, 100);
    const once = deserialize(serialize(doc)).document;
    const twice = deserialize(serialize(once)).document;
    // Compare the documents, not the envelopes — `writtenAt` differs by design.
    expect(JSON.parse(serialize(twice)).document).toEqual(
      JSON.parse(serialize(once)).document,
    );
  });
});

describe('rejection', () => {
  it('refuses malformed JSON', () => {
    expect(() => deserialize('{ not json')).toThrow(ProjectLoadError);
  });

  it('refuses a file that is not a project', () => {
    expect(() => deserialize(JSON.stringify({ format: 'something-else' }))).toThrow(
      ProjectLoadError,
    );
  });

  it('refuses a file from a newer build, with an actionable message', () => {
    const file = JSON.stringify({
      format: 'apexedit-project',
      schemaVersion: SCHEMA_VERSION + 5,
      document: {},
    });
    expect(() => deserialize(file)).toThrow(/newer version/i);
  });

  it('refuses a document with no settings', () => {
    const file = JSON.stringify({
      format: 'apexedit-project',
      schemaVersion: SCHEMA_VERSION,
      document: { project: {}, tracks: [], clips: {} },
    });
    expect(() => deserialize(file)).toThrow(ProjectLoadError);
  });
});

describe('migration', () => {
  it('converts a version 0 file from seconds to ticks', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.v1, 0, 100);
    const clipId = doc.trackClips[fx.v1][0];

    const legacy = JSON.parse(serialize(doc));
    legacy.schemaVersion = 0;
    legacy.document.schemaVersion = 0;
    // Rewrite the clip the way the old build stored it: float seconds and a
    // linear `volume` scalar, with none of the fields added since.
    legacy.document.clips[clipId] = {
      ...legacy.document.clips[clipId],
      start: 0,
      duration: 2,
      mediaIn: 1,
      volume: 0.5,
    };
    delete legacy.document.clips[clipId].audio;
    delete legacy.document.captionTracks;

    const { document, migratedFrom, warnings } = deserialize(JSON.stringify(legacy));
    expect(migratedFrom).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);

    const clip = document.clips[clipId];
    expect(clip.duration).toBe(705_600_000 * 2);
    expect(clip.mediaIn).toBe(705_600_000);
    // Linear 0.5 is about −6 dB.
    expect(clip.audio?.gainDb.base).toBeCloseTo(-6.02, 1);
  });

  it('adds caption tracks to a version 2 file', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.v1, 0, 100);
    const legacy = JSON.parse(serialize(doc));
    legacy.schemaVersion = 2;
    delete legacy.document.captionTracks;

    const { document, migratedFrom } = deserialize(JSON.stringify(legacy));
    expect(migratedFrom).toBe(2);
    expect(document.captionTracks).toEqual([]);
    expect(document.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('repair', () => {
  it('drops clips pointing at a track that no longer exists, with a warning', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.v1, 0, 100);
    const file = JSON.parse(serialize(doc));
    const clipId = Object.keys(file.document.clips)[0];
    file.document.clips[clipId].trackId = 'gone';

    const { document, warnings } = deserialize(JSON.stringify(file));
    expect(Object.keys(document.clips)).toHaveLength(0);
    expect(warnings.some((w) => w.includes('track'))).toBe(true);
  });

  it('clamps a negative start and a zero duration rather than failing', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.v1, 0, 100);
    const file = JSON.parse(serialize(doc));
    const clipId = Object.keys(file.document.clips)[0];
    file.document.clips[clipId].start = -5000;
    file.document.clips[clipId].duration = 0;

    const { document } = deserialize(JSON.stringify(file));
    expect(document.clips[clipId].start).toBe(0);
    expect(document.clips[clipId].duration).toBeGreaterThan(0);
  });

  it('drops an effect this build does not know about', () => {
    const fx = fixture();
    const { doc, id } = place(fx, fx.v1, 0, 100);
    const withUnknown = updateClip(doc, id, {
      effects: [
        { id: 'e1', type: 'quantum-shimmer-from-2029', enabled: true, params: { amount: 1 } },
        { id: 'e2', type: 'glitch', enabled: true, params: { intensity: 0.5 } },
      ],
    });

    const { document, warnings } = deserialize(serialize(withUnknown));
    expect(document.clips[id].effects).toHaveLength(1);
    expect(document.clips[id].effects[0].type).toBe('glitch');
    expect(warnings.some((w) => w.includes('not supported'))).toBe(true);
  });
});

describe('project package', () => {
  it('rewrites media locators to package-relative paths', () => {
    const fx = fixture();
    const { doc } = place(fx, fx.v1, 0, 100);
    const { manifest, document } = buildPackageManifest(doc, { [fx.mediaId]: 5_000_000 });

    expect(manifest.media[fx.mediaId]).toMatch(/^media\/.*\.mp4$/);
    expect(document.media[fx.mediaId].localUri).toBe(manifest.media[fx.mediaId]);
    expect(manifest.totalBytes).toBe(5_000_000);
  });

  it('clears proxies, which do not belong in a package', () => {
    const fx = fixture();
    const doc = putClip(
      fx.doc,
      createClip({
        trackId: fx.v1,
        start: 0,
        duration: f(10),
        content: { kind: 'media', mediaId: fx.mediaId },
      }),
    );
    const withProxy = {
      ...doc,
      media: {
        ...doc.media,
        [fx.mediaId]: { ...doc.media[fx.mediaId], proxyUri: 'file:///proxy.mp4', proxyState: 'ready' as const },
      },
    };
    const { document } = buildPackageManifest(withProxy, {});
    expect(document.media[fx.mediaId].proxyUri).toBeNull();
  });
});
