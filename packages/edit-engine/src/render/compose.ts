import {
  rangeContains,
  roundToFrame,
  type Ticks,
} from '../time/time.js';
import { evaluateNumber, evaluateVec2, type Vec2 } from '../animation/keyframes.js';
import { instantaneousRate, sourceTimeAt } from '../speed/speed.js';
import { isNeutralGrade, resolveGrade, type ResolvedGrade } from '../color/grade.js';
import { sanitizeParams } from '../effects/registry.js';
import type {
  BlendMode,
  Clip,
  EditDocument,
  EffectInstance,
  Id,
  Mask,
  Resolution,
  TextStyle,
  Transition,
} from '../model/types.js';
import { clipEnd, clipRange, clipsOnTrack, videoTracks } from '../document/queries.js';
import { transitionRange } from '../edit/operations.js';

/**
 * Compiling a timeline position into a render description.
 *
 * The engine does not touch pixels. It answers one question — "what should be
 * on screen at tick T, and how" — as a flat, fully-resolved structure with no
 * keyframes, no speed curves and no document lookups left in it. Each platform
 * renderer (Metal, Vulkan/GL, WebGL in the prototype) consumes exactly this.
 *
 * Keeping the compile step platform-agnostic is what lets the same edit produce
 * an identical frame in the phone preview and in the export encoder.
 */

export interface SourceRef {
  readonly kind: 'media';
  readonly mediaId: Id;
  /** Absolute time in the source to sample, already speed-mapped. */
  readonly sourceTime: Ticks;
  /** Prefer the proxy when scrubbing; the exporter always asks for the original. */
  readonly preferProxy: boolean;
  /** Instantaneous playback rate, for frame blending and audio pitch. */
  readonly rate: number;
  readonly frameBlending: 'none' | 'blend' | 'optical-flow';
}

export type LayerSource =
  | SourceRef
  | { readonly kind: 'color'; readonly color: string }
  | { readonly kind: 'text'; readonly text: string; readonly style: TextStyle }
  | { readonly kind: 'shape'; readonly shape: 'rect' | 'ellipse' | 'line'; readonly color: string }
  | { readonly kind: 'adjustment' };

/** A 2D affine transform, row-major: [a, b, c, d, tx, ty]. */
export type Matrix2D = readonly [number, number, number, number, number, number];

export interface ResolvedMask {
  readonly shape: Mask['shape'];
  readonly points: readonly Vec2[];
  readonly feather: number;
  readonly opacity: number;
  readonly inverted: boolean;
  readonly expansion: number;
}

export interface ResolvedEffect {
  readonly type: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface RenderLayer {
  readonly clipId: Id;
  readonly trackId: Id;
  /** Composite order; higher draws later, i.e. on top. */
  readonly z: number;
  readonly source: LayerSource;
  /** Maps the source's unit rect into normalised frame space. */
  readonly matrix: Matrix2D;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  /** Normalised source-space crop applied before the transform. */
  readonly crop: { top: number; right: number; bottom: number; left: number };
  readonly cornerRadius: number;
  readonly grade: ResolvedGrade | null;
  readonly masks: readonly ResolvedMask[];
  readonly chromaKey: {
    keyColor: string;
    similarity: number;
    smoothness: number;
    spillSuppression: number;
  } | null;
  readonly effects: readonly ResolvedEffect[];
  readonly stabilization: number;
  /** Time within the clip, so a renderer can drive its own per-clip animation. */
  readonly clipTime: Ticks;
}

export interface RenderTransition {
  readonly type: Transition['type'];
  /** 0 at the start of the overlap, 1 at the end. */
  readonly progress: number;
  /** Layer index of the outgoing side. */
  readonly fromLayer: number;
  /** Layer index of the incoming side. */
  readonly toLayer: number;
}

export interface RenderFrame {
  readonly time: Ticks;
  readonly resolution: Resolution;
  readonly backgroundColor: string;
  readonly layers: readonly RenderLayer[];
  readonly transitions: readonly RenderTransition[];
  readonly captions: readonly RenderCaption[];
}

export interface RenderCaption {
  readonly trackId: Id;
  readonly styleId: string;
  readonly text: string;
  /** Word timings relative to now, so the renderer can animate per word. */
  readonly words: readonly { text: string; progress: number; active: boolean }[];
}

export interface ComposeOptions {
  /** Scrubbing prefers proxies; export never does. */
  readonly preferProxy?: boolean;
  /** Skip layers that would be invisible anyway. Off for debugging. */
  readonly cullInvisible?: boolean;
  /** Override the output size, e.g. for a small preview or a thumbnail. */
  readonly resolution?: Resolution;
}

/**
 * Build the render description for `time`.
 *
 * Video tracks composite bottom-up: track index 0 is the base and higher
 * indices draw over it, matching how the timeline is stacked on screen.
 */
export function composeFrame(
  doc: EditDocument,
  time: Ticks,
  opts: ComposeOptions = {},
): RenderFrame {
  const rate = doc.project.settings.frameRate;
  const at = roundToFrame(time, rate);
  const preferProxy = opts.preferProxy ?? false;
  const cull = opts.cullInvisible ?? true;

  const layers: RenderLayer[] = [];
  const transitions: RenderTransition[] = [];

  for (const track of videoTracks(doc)) {
    if (!track.enabled) continue;

    const trackClips = clipsOnTrack(doc, track.id);

    for (let i = 0; i < trackClips.length; i++) {
      const clip = trackClips[i];
      if (!clip.enabled) continue;

      // A clip is on screen either during its own range, or during a
      // transition overlap — as the incoming side of its own transition
      // (drawn before it starts) or the outgoing side of the next clip's
      // (still drawn after it ends).
      const asIncoming = transitionRange(doc, clip.id);
      const next = trackClips[i + 1];
      const asOutgoing = next ? transitionRange(doc, next.id) : null;

      const visible =
        rangeContains(clipRange(clip), at) ||
        (asIncoming != null && rangeContains(asIncoming, at)) ||
        (asOutgoing != null && rangeContains(asOutgoing, at));
      if (!visible) continue;

      const layer = resolveLayer(doc, clip, at, layers.length, preferProxy);
      if (cull && layer.opacity <= 0.001) continue;
      layers.push(layer);
    }

    // Pair each active transition's two sides by clip id, now that the layer
    // list for this track is settled.
    for (let i = 1; i < trackClips.length; i++) {
      const clip = trackClips[i];
      if (!clip.transitionIn) continue;
      const range = transitionRange(doc, clip.id);
      if (!range || !rangeContains(range, at)) continue;

      const toLayer = layers.findIndex((l) => l.clipId === clip.id);
      const fromLayer = layers.findIndex((l) => l.clipId === trackClips[i - 1].id);
      if (toLayer < 0 || fromLayer < 0) continue;

      transitions.push({
        type: clip.transitionIn.type,
        progress: range.duration > 0 ? (at - range.start) / range.duration : 1,
        fromLayer,
        toLayer,
      });
    }
  }

  return {
    time: at,
    resolution: opts.resolution ?? doc.project.settings.resolution,
    backgroundColor: doc.project.settings.backgroundColor,
    layers,
    transitions,
    captions: resolveCaptions(doc, at),
  };
}

function resolveLayer(
  doc: EditDocument,
  clip: Clip,
  at: Ticks,
  z: number,
  preferProxy: boolean,
): RenderLayer {
  const clipTime = at - clip.start;
  const t = clip.transform;

  const position = evaluateVec2(t.position, clipTime);
  const scale = evaluateVec2(t.scale, clipTime);
  const anchor = evaluateVec2(t.anchor, clipTime);
  const rotation = evaluateNumber(t.rotation, clipTime);
  const opacity = evaluateNumber(t.opacity, clipTime);

  return {
    clipId: clip.id,
    trackId: clip.trackId,
    z,
    source: resolveSource(clip, clipTime, preferProxy),
    matrix: buildMatrix(position, scale, rotation, anchor, t.flipH, t.flipV),
    opacity: clamp01(opacity),
    blendMode: clip.blendMode,
    crop: t.crop,
    cornerRadius: evaluateNumber(t.cornerRadius, clipTime),
    grade: clip.grade && !isNeutralGrade(clip.grade) ? resolveGrade(clip.grade, clipTime) : null,
    masks: clip.masks.map((m) => resolveMask(m, clipTime)),
    chromaKey:
      clip.chromaKey?.enabled === true
        ? {
            keyColor: clip.chromaKey.keyColor,
            similarity: evaluateNumber(clip.chromaKey.similarity, clipTime),
            smoothness: evaluateNumber(clip.chromaKey.smoothness, clipTime),
            spillSuppression: evaluateNumber(clip.chromaKey.spillSuppression, clipTime),
          }
        : null,
    effects: clip.effects.filter((e) => e.enabled).map(resolveEffect),
    stabilization: clip.stabilization,
    clipTime,
  };
}

function resolveSource(clip: Clip, clipTime: Ticks, preferProxy: boolean): LayerSource {
  if (clip.content.kind !== 'media') return clip.content;
  return {
    kind: 'media',
    mediaId: clip.content.mediaId,
    sourceTime: sourceTimeAt(clip.speed, clip.mediaIn, clipTime, clip.duration),
    preferProxy,
    rate: instantaneousRate(clip.speed, clipTime, clip.duration),
    frameBlending: clip.speed.kind === 'freeze' ? 'none' : clip.speed.frameBlending,
  };
}

const resolveEffect = (e: EffectInstance): ResolvedEffect => ({
  type: e.type,
  params: sanitizeParams(e.type, e.params),
});

function resolveMask(mask: Mask, clipTime: Ticks): ResolvedMask {
  return {
    shape: mask.shape,
    points: mask.points,
    feather: evaluateNumber(mask.feather, clipTime),
    opacity: clamp01(evaluateNumber(mask.opacity, clipTime)),
    inverted: mask.inverted,
    expansion: evaluateNumber(mask.expansion, clipTime),
  };
}

/**
 * Compose translate · rotate · scale about an anchor into one matrix.
 *
 * Working in normalised frame space (−0.5..0.5 on both axes) keeps the matrix
 * independent of output resolution, so the same edit renders identically to a
 * 480p preview and a 4K export.
 */
export function buildMatrix(
  position: Vec2,
  scale: Vec2,
  rotationDegrees: number,
  anchor: Vec2,
  flipH: boolean,
  flipV: boolean,
): Matrix2D {
  const rad = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = scale.x * (flipH ? -1 : 1);
  const sy = scale.y * (flipV ? -1 : 1);

  // Scale then rotate. `+ 0` normalises the signed zeros that fall out of
  // trigonometry at right angles, so an untouched transform compares equal to
  // the identity matrix instead of differing by the sign bit.
  const a = cos * sx + 0;
  const b = sin * sx + 0;
  const c = -sin * sy + 0;
  const d = cos * sy + 0;

  // Translate so the anchor is the fixed point of the scale/rotation.
  const tx = position.x - (a * anchor.x + c * anchor.y) + anchor.x;
  const ty = position.y - (b * anchor.x + d * anchor.y) + anchor.y;

  return [a, b, c, d, tx, ty];
}

function resolveCaptions(doc: EditDocument, at: Ticks): RenderCaption[] {
  const out: RenderCaption[] = [];
  for (const track of doc.captionTracks) {
    if (!track.enabled) continue;
    const cue = track.cues.find((c) => at >= c.start && at < c.end);
    if (!cue) continue;
    out.push({
      trackId: track.id,
      styleId: track.styleId,
      text: cue.text,
      words: cue.words.map((w) => {
        const span = Math.max(1, w.end - w.start);
        return {
          text: w.text,
          progress: clamp01((at - w.start) / span),
          active: at >= w.start && at < w.end,
        };
      }),
    });
  }
  return out;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Media the renderer must have decoded to draw `frame` — the input to the
 * decoder pre-roll that keeps scrubbing from stalling.
 */
export function requiredMedia(frame: RenderFrame): { mediaId: Id; sourceTime: Ticks }[] {
  const out: { mediaId: Id; sourceTime: Ticks }[] = [];
  for (const layer of frame.layers) {
    if (layer.source.kind === 'media') {
      out.push({ mediaId: layer.source.mediaId, sourceTime: layer.source.sourceTime });
    }
  }
  return out;
}

/**
 * A cheap complexity score used to decide whether the preview can run at full
 * resolution or should drop to a proxy path. Tuned so a single ungraded layer
 * scores 1 and a stack that a mid-range phone cannot sustain scores above 10.
 */
export function frameCost(frame: RenderFrame): number {
  let cost = 0;
  for (const layer of frame.layers) {
    cost += 1;
    if (layer.grade) cost += 0.5;
    if (layer.chromaKey) cost += 1.5;
    cost += layer.masks.length * 0.5;
    cost += layer.effects.length * 1.0;
    if (layer.source.kind === 'media' && layer.source.frameBlending === 'optical-flow') cost += 3;
    if (layer.stabilization > 0) cost += 1;
  }
  cost += frame.transitions.length * 0.5;
  return cost;
}
