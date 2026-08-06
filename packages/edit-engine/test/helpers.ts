import {
  addMedia,
  createDocument,
  createMediaAsset,
  FRAME_RATES,
  framesToTicks,
  putClip,
  createClip,
  videoTracks,
  audioTracks,
  type EditDocument,
  type FrameRate,
  type Id,
  type Ticks,
} from '../src/index.js';

/** 30 fps everywhere unless a test says otherwise. */
export const RATE: FrameRate = FRAME_RATES.fps30;

export const f = (frames: number, rate: FrameRate = RATE): Ticks => framesToTicks(frames, rate);

export interface Fixture {
  doc: EditDocument;
  v1: Id;
  v2: Id;
  a1: Id;
  mediaId: Id;
}

/**
 * A document with one 600-frame (20 s) source registered and no clips, plus
 * handles for the first two video tracks and the first audio track.
 */
export function fixture(opts: { mediaFrames?: number } = {}): Fixture {
  let doc = createDocument({ name: 'Test', aspectRatio: '16:9', frameRate: RATE });
  const asset = createMediaAsset({
    kind: 'video',
    name: 'source.mp4',
    localUri: 'file:///source.mp4',
    duration: f(opts.mediaFrames ?? 600),
    naturalSize: { width: 1920, height: 1080 },
    frameRate: RATE,
    hasAudio: true,
  });
  doc = addMedia(doc, asset);

  const vs = videoTracks(doc);
  const as = audioTracks(doc);
  return { doc, v1: vs[0].id, v2: vs[1].id, a1: as[0].id, mediaId: asset.id };
}

/** Place a clip in frames, returning the updated document and the clip id. */
export function place(
  fx: Fixture,
  trackId: Id,
  startFrames: number,
  durationFrames: number,
  mediaInFrames = 0,
): { doc: EditDocument; id: Id } {
  const clip = createClip({
    trackId,
    start: f(startFrames),
    duration: f(durationFrames),
    mediaIn: f(mediaInFrames),
    content: { kind: 'media', mediaId: fx.mediaId },
    withAudio: true,
  });
  return { doc: putClip(fx.doc, clip), id: clip.id };
}

/** Compact `[start, duration]` pairs in frames for readable assertions. */
export function layout(doc: EditDocument, trackId: Id): [number, number][] {
  const tpf = f(1);
  return (doc.trackClips[trackId] ?? []).map((id) => {
    const clip = doc.clips[id];
    return [clip.start / tpf, clip.duration / tpf];
  });
}

export const mediaIns = (doc: EditDocument, trackId: Id): number[] => {
  const tpf = f(1);
  return (doc.trackClips[trackId] ?? []).map((id) => doc.clips[id].mediaIn / tpf);
};
