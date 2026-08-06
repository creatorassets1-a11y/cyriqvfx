import {
  FRAME_RATES,
  framesToTicks,
  TICKS_PER_SECOND,
  type FrameRate,
  type Ticks,
} from '../time/time.js';
import { constant } from '../animation/keyframes.js';
import { NORMAL_SPEED } from '../speed/speed.js';
import { defaultAudioParams } from '../audio/audio.js';
import { neutralGrade } from '../color/grade.js';
import type {
  AspectRatioPreset,
  Clip,
  ClipContent,
  EditDocument,
  Id,
  MediaAsset,
  Project,
  ProjectSettings,
  Resolution,
  TextStyle,
  Track,
  TrackKind,
  Transform,
} from './types.js';

export const SCHEMA_VERSION = 3;

/**
 * Id generation.
 *
 * Ids must be unique across devices without coordination, because two people
 * can edit the same project offline and sync later. A time-ordered random id
 * gives us that plus a natural creation ordering that makes diffs readable.
 */
let idCounter = 0;

export function newId(prefix = 'x'): Id {
  const time = Date.now().toString(36);
  const seq = (idCounter++ & 0xffff).toString(36).padStart(3, '0');
  const rand = Math.floor(Math.random() * 0x10000).toString(36).padStart(3, '0');
  return `${prefix}_${time}${seq}${rand}`;
}

/** Deterministic ids for tests and fixtures. */
export function withIdSequence<T>(startAt: number, fn: () => T): T {
  const saved = idCounter;
  idCounter = startAt;
  try {
    return fn();
  } finally {
    idCounter = saved;
  }
}

// ---------------------------------------------------------------------------
// Project settings
// ---------------------------------------------------------------------------

export const ASPECT_RATIOS: Record<Exclude<AspectRatioPreset, 'custom'>, number> = {
  '9:16': 9 / 16,
  '16:9': 16 / 9,
  '1:1': 1,
  '4:5': 4 / 5,
  '4:3': 4 / 3,
  '2.35:1': 2.35,
};

/**
 * Working resolution for an aspect ratio, targeting a ~2160px long edge so the
 * timeline renders at delivery quality without forcing every device to
 * composite a full 4K frame when the export is smaller.
 */
export function resolutionFor(aspect: AspectRatioPreset, longEdge = 2160): Resolution {
  if (aspect === 'custom') return { width: longEdge, height: longEdge };
  const ratio = ASPECT_RATIOS[aspect];
  if (ratio >= 1) {
    const width = longEdge;
    return { width, height: even(Math.round(width / ratio)) };
  }
  const height = longEdge;
  return { width: even(Math.round(height * ratio)), height };
}

// Encoders reject odd dimensions for 4:2:0 chroma subsampling.
const even = (n: number) => (n % 2 === 0 ? n : n + 1);

export function defaultSettings(
  aspect: AspectRatioPreset = '9:16',
  frameRate: FrameRate = FRAME_RATES.fps30,
): ProjectSettings {
  return {
    aspectRatio: aspect,
    resolution: resolutionFor(aspect),
    frameRate,
    sampleRate: 48000,
    colorSpace: 'rec709',
    backgroundColor: '#000000',
  };
}

// ---------------------------------------------------------------------------
// Clip pieces
// ---------------------------------------------------------------------------

export function defaultTransform(): Transform {
  return {
    position: constant({ x: 0, y: 0 }),
    scale: constant({ x: 1, y: 1 }),
    rotation: constant(0),
    opacity: constant(1),
    anchor: constant({ x: 0, y: 0 }),
    flipH: false,
    flipV: false,
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    cornerRadius: constant(0),
  };
}

export function defaultTextStyle(): TextStyle {
  return {
    fontFamily: 'Inter',
    fontSize: 72,
    weight: 700,
    italic: false,
    color: '#ffffff',
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    outline: { color: '#000000', width: 0 },
    shadow: { color: '#00000099', dx: 0, dy: 4, blur: 12 },
  };
}

export interface CreateClipOptions {
  readonly trackId: Id;
  readonly start: Ticks;
  readonly duration: Ticks;
  readonly content: ClipContent;
  readonly mediaIn?: Ticks;
  readonly withAudio?: boolean;
  readonly label?: string;
}

export function createClip(opts: CreateClipOptions): Clip {
  return {
    id: newId('clip'),
    trackId: opts.trackId,
    start: opts.start,
    duration: opts.duration,
    mediaIn: opts.mediaIn ?? 0,
    content: opts.content,
    speed: NORMAL_SPEED,
    transform: defaultTransform(),
    blendMode: 'normal',
    grade: null,
    audio: opts.withAudio ? defaultAudioParams() : null,
    masks: [],
    chromaKey: null,
    effects: [],
    transitionIn: null,
    linkGroup: null,
    label: opts.label ?? null,
    colorTag: null,
    stabilization: 0,
    enabled: true,
  };
}

/** A clip that fills the frame with a solid colour — the backing for titles. */
export function createColorClip(trackId: Id, start: Ticks, duration: Ticks, color = '#000000'): Clip {
  return createClip({ trackId, start, duration, content: { kind: 'color', color } });
}

export function createTextClip(
  trackId: Id,
  start: Ticks,
  duration: Ticks,
  text: string,
  style: Partial<TextStyle> = {},
): Clip {
  return createClip({
    trackId,
    start,
    duration,
    content: { kind: 'text', text, style: { ...defaultTextStyle(), ...style } },
    label: text.slice(0, 24),
  });
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export function createTrack(kind: TrackKind, index: number, name?: string): Track {
  return {
    id: newId(kind === 'video' ? 'vt' : 'at'),
    kind,
    name: name ?? `${kind === 'video' ? 'V' : 'A'}${index + 1}`,
    index,
    enabled: true,
    locked: false,
    muted: false,
    solo: false,
    gainDb: 0,
    // Only the bottom video track is magnetic by default: it behaves like the
    // familiar single-strip mobile timeline, while overlays float freely.
    magnetic: kind === 'video' ? index === 0 : false,
    height: kind === 'video' ? 64 : 44,
  };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface CreateProjectOptions {
  readonly name?: string;
  readonly aspectRatio?: AspectRatioPreset;
  readonly frameRate?: FrameRate;
  readonly videoTracks?: number;
  readonly audioTracks?: number;
}

/**
 * A new, empty project.
 *
 * The MVP ships six video and six audio tracks, which is enough for every
 * template we ship and cheap to raise later — track count is a pure data
 * concern with no engine assumptions behind it.
 */
export function createDocument(opts: CreateProjectOptions = {}): EditDocument {
  const now = Date.now();
  const settings = defaultSettings(opts.aspectRatio ?? '9:16', opts.frameRate ?? FRAME_RATES.fps30);
  const project: Project = {
    id: newId('proj'),
    name: opts.name ?? 'Untitled',
    settings,
    createdAt: now,
    modifiedAt: now,
  };

  const videoCount = opts.videoTracks ?? 6;
  const audioCount = opts.audioTracks ?? 6;
  const tracks: Track[] = [];
  for (let i = 0; i < videoCount; i++) tracks.push(createTrack('video', i));
  for (let i = 0; i < audioCount; i++) tracks.push(createTrack('audio', i));

  return {
    project,
    media: {},
    tracks,
    clips: {},
    trackClips: Object.fromEntries(tracks.map((t) => [t.id, [] as Id[]])),
    markers: [],
    captionTracks: [],
    schemaVersion: SCHEMA_VERSION,
  };
}

/** Register a media asset. Images get a default 5-second on-timeline length. */
export function addMedia(doc: EditDocument, asset: MediaAsset): EditDocument {
  return { ...doc, media: { ...doc.media, [asset.id]: asset } };
}

export function createMediaAsset(init: Partial<MediaAsset> & Pick<MediaAsset, 'kind' | 'name'>): MediaAsset {
  return {
    id: init.id ?? newId('med'),
    kind: init.kind,
    name: init.name,
    localUri: init.localUri ?? null,
    remoteUri: init.remoteUri ?? null,
    duration: init.duration ?? (init.kind === 'image' ? null : 0),
    naturalSize: init.naturalSize,
    frameRate: init.frameRate,
    hasAudio: init.hasAudio ?? init.kind === 'audio',
    audioChannels: init.audioChannels,
    sampleRate: init.sampleRate,
    orientation: init.orientation ?? 0,
    proxyUri: init.proxyUri ?? null,
    proxyState: init.proxyState ?? 'none',
    waveformPeaks: init.waveformPeaks ?? null,
    beats: init.beats ?? null,
  };
}

/** Default on-timeline duration for a still image. */
export const DEFAULT_IMAGE_DURATION: Ticks = TICKS_PER_SECOND * 5;

/** Default duration for a newly added title, in frames so it lands on a cut. */
export function defaultTitleDuration(rate: FrameRate): Ticks {
  return framesToTicks(Math.round((rate.num / rate.den) * 3), rate);
}

export { neutralGrade };
