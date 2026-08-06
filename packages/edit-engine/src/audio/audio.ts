import type { Ticks } from '../time/time.js';
import {
  constant,
  evaluateNumber,
  setKeyframe,
  type AnimatableNumber,
} from '../animation/keyframes.js';

/**
 * Audio parameters.
 *
 * Gain is authored in decibels because that is what a fader means, and only
 * converted to linear amplitude at the boundary with the mixer. Fades are kept
 * separate from the volume envelope so that dragging a fade handle never
 * destroys hand-placed volume keyframes.
 */

export type FadeShape = 'linear' | 'equal-power' | 'exponential' | 's-curve';

export interface Fade {
  readonly duration: Ticks;
  readonly shape: FadeShape;
}

export interface EqBand {
  readonly frequency: number;
  readonly gainDb: number;
  readonly q: number;
  readonly type: 'low-shelf' | 'peaking' | 'high-shelf' | 'low-pass' | 'high-pass';
}

/** The three-band EQ the Simple mode exposes; Pro mode edits `bands` directly. */
export const DEFAULT_EQ: readonly EqBand[] = [
  { frequency: 120, gainDb: 0, q: 0.7, type: 'low-shelf' },
  { frequency: 1000, gainDb: 0, q: 1.0, type: 'peaking' },
  { frequency: 8000, gainDb: 0, q: 0.7, type: 'high-shelf' },
];

export interface DuckingRule {
  readonly enabled: boolean;
  /** Track whose signal triggers the duck — normally the voiceover track. */
  readonly sidechainTrackId: string | null;
  /** How far to pull this clip down, in dB. Negative. */
  readonly amountDb: number;
  readonly attack: Ticks;
  readonly release: Ticks;
  /** Level above which the sidechain triggers, in dBFS. */
  readonly thresholdDb: number;
}

export interface AudioClipParams {
  /** Fader in dB. −Infinity is silence; the UI clamps at −60. */
  readonly gainDb: AnimatableNumber;
  /** −1 hard left, 1 hard right. */
  readonly pan: AnimatableNumber;
  readonly fadeIn: Fade | null;
  readonly fadeOut: Fade | null;
  readonly muted: boolean;
  readonly eq: readonly EqBand[];
  /** 0..1 strength of the on-device denoiser. */
  readonly noiseReduction: number;
  /** Semitones, independent of speed when pitch correction is on. */
  readonly pitchSemitones: number;
  readonly ducking: DuckingRule | null;
  /** Play the source backwards, independent of the video speed spec. */
  readonly reverse: boolean;
}

export function defaultAudioParams(): AudioClipParams {
  return {
    gainDb: constant(0),
    pan: constant(0),
    fadeIn: null,
    fadeOut: null,
    muted: false,
    eq: DEFAULT_EQ,
    noiseReduction: 0,
    pitchSemitones: 0,
    ducking: null,
    reverse: false,
  };
}

export const MIN_GAIN_DB = -60;

export const dbToLinear = (db: number): number =>
  db <= MIN_GAIN_DB ? 0 : Math.pow(10, db / 20);

export const linearToDb = (linear: number): number =>
  linear <= 0 ? MIN_GAIN_DB : 20 * Math.log10(linear);

/** Fade multiplier at progress `p` (0 = silent end, 1 = full). */
export function fadeGain(shape: FadeShape, p: number): number {
  const t = Math.min(1, Math.max(0, p));
  switch (shape) {
    case 'equal-power':
      return Math.sin((t * Math.PI) / 2);
    case 'exponential':
      return t * t;
    case 's-curve':
      return t * t * (3 - 2 * t);
    case 'linear':
    default:
      return t;
  }
}

/**
 * Final linear gain for a clip at `clipTime`, combining the envelope, both
 * fades and the mute flag. Track gain and ducking are applied later, by the
 * mixer, because they depend on state outside the clip.
 */
export function clipGainAt(
  params: AudioClipParams,
  clipTime: Ticks,
  clipDuration: Ticks,
): number {
  if (params.muted) return 0;
  let gain = dbToLinear(evaluateNumber(params.gainDb, clipTime));

  const { fadeIn, fadeOut } = params;
  if (fadeIn && fadeIn.duration > 0 && clipTime < fadeIn.duration) {
    gain *= fadeGain(fadeIn.shape, clipTime / fadeIn.duration);
  }
  if (fadeOut && fadeOut.duration > 0) {
    const remaining = clipDuration - clipTime;
    if (remaining < fadeOut.duration) {
      gain *= fadeGain(fadeOut.shape, Math.max(0, remaining) / fadeOut.duration);
    }
  }
  return gain;
}

/** Constant-power stereo pan. Returns per-channel multipliers. */
export function panGains(pan: number): { left: number; right: number } {
  const p = Math.min(1, Math.max(-1, pan));
  const angle = ((p + 1) * Math.PI) / 4;
  return { left: Math.cos(angle), right: Math.sin(angle) };
}

/**
 * Add a volume keyframe pair that dips the clip around a range — the primitive
 * behind manual ducking and the "lower music under voice" one-tap action.
 */
export function dipVolume(
  params: AudioClipParams,
  start: Ticks,
  end: Ticks,
  amountDb: number,
  ramp: Ticks,
): AudioClipParams {
  const base = params.gainDb.base;
  let gain = params.gainDb;
  gain = setKeyframe(gain, Math.max(0, start - ramp), base);
  gain = setKeyframe(gain, start, base + amountDb);
  gain = setKeyframe(gain, end, base + amountDb);
  gain = setKeyframe(gain, end + ramp, base);
  return { ...params, gainDb: gain };
}
