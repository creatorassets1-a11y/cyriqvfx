import type { FrameRate, Ticks } from '../time/time.js';
import type { AnimatableNumber, AnimatableVec2, Keyframe } from '../animation/keyframes.js';
import type { SpeedSpec } from '../speed/speed.js';
import type { ColorGrade } from '../color/grade.js';
import type { AudioClipParams } from '../audio/audio.js';

export type Id = string;

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export type AspectRatioPreset =
  | '9:16'
  | '16:9'
  | '1:1'
  | '4:5'
  | '4:3'
  | '2.35:1'
  | 'custom';

export interface Resolution {
  readonly width: number;
  readonly height: number;
}

export interface ProjectSettings {
  readonly aspectRatio: AspectRatioPreset;
  /** Working resolution of the sequence. Sources may be higher; they are scaled. */
  readonly resolution: Resolution;
  readonly frameRate: FrameRate;
  readonly sampleRate: number;
  /** Rec.709 for SDR delivery, Rec.2100 HLG/PQ for HDR. */
  readonly colorSpace: 'rec709' | 'rec2020-hlg' | 'rec2020-pq';
  /** Background behind all tracks, as #rrggbb. */
  readonly backgroundColor: string;
}

export interface Project {
  readonly id: Id;
  readonly name: string;
  readonly settings: ProjectSettings;
  readonly createdAt: number;
  readonly modifiedAt: number;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export type MediaKind = 'video' | 'audio' | 'image';

/**
 * A reference to media. The engine never holds pixel or sample data — only the
 * locator the host platform resolves. `localUri` is authoritative; `remoteUri`
 * exists only for media that originated in the cloud and may not be resident.
 */
export interface MediaAsset {
  readonly id: Id;
  readonly kind: MediaKind;
  readonly name: string;
  readonly localUri: string | null;
  readonly remoteUri?: string | null;
  /** Full source duration. Images are treated as infinite via `null`. */
  readonly duration: Ticks | null;
  readonly naturalSize?: Resolution;
  readonly frameRate?: FrameRate;
  readonly hasAudio: boolean;
  readonly audioChannels?: number;
  readonly sampleRate?: number;
  /** Rotation baked into container metadata, in degrees. */
  readonly orientation?: 0 | 90 | 180 | 270;
  /** Set once a low-res proxy has been generated for smooth scrubbing. */
  readonly proxyUri?: string | null;
  readonly proxyState?: 'none' | 'pending' | 'ready' | 'failed';
  /** Peak envelope for waveform drawing, normalised 0..1, min/max interleaved. */
  readonly waveformPeaks?: readonly number[] | null;
  /** Beat positions detected on-device, used for snapping and auto-cut. */
  readonly beats?: readonly Ticks[] | null;
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export type TrackKind = 'video' | 'audio';

export interface Track {
  readonly id: Id;
  readonly kind: TrackKind;
  readonly name: string;
  /** Higher index composites on top (video) / is listed lower (audio). */
  readonly index: number;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly muted: boolean;
  readonly solo: boolean;
  /** Track-level gain in dB, applied after clip gain. Audio tracks only. */
  readonly gainDb: number;
  /**
   * Magnetic tracks close gaps automatically on delete and push neighbours on
   * insert. Free tracks behave like a classic overwrite timeline.
   */
  readonly magnetic: boolean;
  /** UI row height in points; persisted so layout survives reopen. */
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'add';

export interface Transform {
  /** Normalised to the frame: 0 is centre, ±0.5 is an edge. */
  readonly position: AnimatableVec2;
  /** 1 = fit by the project's scale mode. Uniform unless `scaleY` is set. */
  readonly scale: AnimatableVec2;
  /** Degrees, clockwise. */
  readonly rotation: AnimatableNumber;
  /** 0..1. */
  readonly opacity: AnimatableNumber;
  /** Anchor for scale/rotation, normalised like `position`. */
  readonly anchor: AnimatableVec2;
  readonly flipH: boolean;
  readonly flipV: boolean;
  /** Source-space crop as normalised insets, before transform. */
  readonly crop: { top: number; right: number; bottom: number; left: number };
  readonly cornerRadius: AnimatableNumber;
}

export type MaskShape = 'rectangle' | 'ellipse' | 'polygon' | 'freehand';

export interface Mask {
  readonly id: Id;
  readonly shape: MaskShape;
  /** Normalised points. Rect/ellipse use the bounding two; others use all. */
  readonly points: readonly { x: number; y: number }[];
  readonly feather: AnimatableNumber;
  readonly opacity: AnimatableNumber;
  readonly inverted: boolean;
  readonly expansion: AnimatableNumber;
}

export interface ChromaKey {
  readonly enabled: boolean;
  /** #rrggbb sampled from the plate. */
  readonly keyColor: string;
  readonly similarity: AnimatableNumber;
  readonly smoothness: AnimatableNumber;
  readonly spillSuppression: AnimatableNumber;
}

export interface EffectInstance {
  readonly id: Id;
  /** Key into the effect registry. */
  readonly type: string;
  readonly enabled: boolean;
  /** Parameter values, animatable or scalar depending on the definition. */
  readonly params: Readonly<Record<string, unknown>>;
}

export interface TextStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly weight: number;
  readonly italic: boolean;
  readonly color: string;
  readonly align: 'left' | 'center' | 'right';
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly outline?: { color: string; width: number };
  readonly shadow?: { color: string; dx: number; dy: number; blur: number };
  readonly background?: { color: string; padding: number; cornerRadius: number };
}

export type ClipContent =
  | { readonly kind: 'media'; readonly mediaId: Id }
  | { readonly kind: 'color'; readonly color: string }
  | { readonly kind: 'text'; readonly text: string; readonly style: TextStyle }
  | { readonly kind: 'shape'; readonly shape: 'rect' | 'ellipse' | 'line'; readonly color: string }
  | { readonly kind: 'adjustment' };

export type TransitionType =
  | 'cross-dissolve'
  | 'dip-to-black'
  | 'dip-to-white'
  | 'wipe-left'
  | 'wipe-right'
  | 'slide-up'
  | 'slide-down'
  | 'zoom-blur'
  | 'glitch';

/** A transition owned by the incoming clip, centred on the cut before it. */
export interface Transition {
  readonly type: TransitionType;
  readonly duration: Ticks;
  /** How the overlap straddles the cut. 0.5 centres it. */
  readonly alignment: number;
}

export interface Clip {
  readonly id: Id;
  readonly trackId: Id;
  /** Position on the timeline. Always frame-aligned for video tracks. */
  readonly start: Ticks;
  /** Length on the timeline, after speed is applied. */
  readonly duration: Ticks;
  /** Offset into the source media of the first frame shown. */
  readonly mediaIn: Ticks;
  readonly content: ClipContent;
  readonly speed: SpeedSpec;
  readonly transform: Transform;
  readonly blendMode: BlendMode;
  readonly grade: ColorGrade | null;
  readonly audio: AudioClipParams | null;
  readonly masks: readonly Mask[];
  readonly chromaKey: ChromaKey | null;
  readonly effects: readonly EffectInstance[];
  readonly transitionIn: Transition | null;
  /** Clips sharing a link group move and trim together. */
  readonly linkGroup: Id | null;
  readonly label: string | null;
  /** UI colour tag, one of the palette keys. */
  readonly colorTag: string | null;
  /** Stabilisation strength 0..1; 0 disables. */
  readonly stabilization: number;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// Markers & captions
// ---------------------------------------------------------------------------

export interface Marker {
  readonly id: Id;
  readonly time: Ticks;
  readonly duration: Ticks;
  readonly name: string;
  readonly note: string;
  readonly color: string;
  /** Null for timeline markers; set for clip-anchored markers. */
  readonly clipId: Id | null;
}

export interface CaptionWord {
  readonly text: string;
  readonly start: Ticks;
  readonly end: Ticks;
  /** Recogniser confidence 0..1; drives the low-confidence review UI. */
  readonly confidence: number;
  /** Marked by filler-word detection so it can be removed in one action. */
  readonly filler?: boolean;
}

export interface CaptionCue {
  readonly id: Id;
  readonly start: Ticks;
  readonly end: Ticks;
  readonly text: string;
  readonly words: readonly CaptionWord[];
  readonly speaker?: string | null;
}

export interface CaptionTrack {
  readonly id: Id;
  readonly language: string;
  readonly name: string;
  readonly cues: readonly CaptionCue[];
  /** Which style preset renders these cues. */
  readonly styleId: string;
  readonly enabled: boolean;
  /** Whether this came from the on-device recogniser or the premium API. */
  readonly source: 'on-device' | 'server' | 'manual' | 'imported';
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/**
 * The complete, serialisable state of an open project.
 *
 * Treated as immutable throughout: every mutation returns a new document that
 * structurally shares everything it did not touch, which is what makes the
 * history stack cheap enough to keep unlimited undo.
 */
export interface EditDocument {
  readonly project: Project;
  readonly media: Readonly<Record<Id, MediaAsset>>;
  readonly tracks: readonly Track[];
  readonly clips: Readonly<Record<Id, Clip>>;
  /** Clip ids per track, kept sorted by start time. */
  readonly trackClips: Readonly<Record<Id, readonly Id[]>>;
  readonly markers: readonly Marker[];
  readonly captionTracks: readonly CaptionTrack[];
  /** Schema version, used by the migration chain on load. */
  readonly schemaVersion: number;
}

export type { Keyframe, FrameRate, Ticks };
