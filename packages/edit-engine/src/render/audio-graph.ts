import { intersectRanges, type Ticks, type TimeRange } from '../time/time.js';
import { evaluateNumber } from '../animation/keyframes.js';
import { instantaneousRate, sourceTimeAt } from '../speed/speed.js';
import { clipGainAt, dbToLinear, panGains, type EqBand } from '../audio/audio.js';
import type { EditDocument, Id } from '../model/types.js';
import { clipRange, clipsInRange } from '../document/queries.js';

/**
 * Compiling the timeline into an audio render graph.
 *
 * The mirror of `composeFrame`, for a time *range* rather than an instant,
 * because audio is rendered in blocks. The output is everything a mixer needs
 * to fill one buffer, with all envelopes already evaluated at the block
 * boundaries and gain reported both at the start and end so the mixer can ramp
 * between them instead of stepping (which would click).
 */

export interface AudioSourceRegion {
  readonly clipId: Id;
  readonly trackId: Id;
  readonly mediaId: Id;
  /** Where in the output block this region begins, in ticks from block start. */
  readonly offsetInBlock: Ticks;
  readonly duration: Ticks;
  /** Absolute source time of the region's first sample. */
  readonly sourceStart: Ticks;
  /** Playback rate; the resampler's ratio. */
  readonly rate: number;
  readonly reverse: boolean;
  /** Independent of rate when pitch correction is on. */
  readonly pitchSemitones: number;
  readonly pitchCorrection: boolean;
  /** Linear gain at the start and end of the region, to be ramped between. */
  readonly gainStart: number;
  readonly gainEnd: number;
  readonly panLeft: number;
  readonly panRight: number;
  readonly eq: readonly EqBand[];
  readonly noiseReduction: number;
}

export interface DuckRequest {
  /** Track being pulled down. */
  readonly targetTrackId: Id;
  readonly sidechainTrackId: Id;
  readonly amountDb: number;
  readonly attack: Ticks;
  readonly release: Ticks;
  readonly thresholdDb: number;
}

export interface AudioBlock {
  readonly range: TimeRange;
  readonly sampleRate: number;
  readonly regions: readonly AudioSourceRegion[];
  /** Post-fader track gains, already accounting for mute and solo. */
  readonly trackGain: Readonly<Record<Id, number>>;
  readonly ducks: readonly DuckRequest[];
}

/**
 * Build the audio graph for one block.
 *
 * Solo is resolved here rather than in the mixer: if any track is soloed every
 * other track's gain is zero, which is the behaviour every DAW has trained
 * users to expect and is cheaper to compute once per block than per sample.
 */
export function composeAudioBlock(doc: EditDocument, range: TimeRange): AudioBlock {
  const sampleRate = doc.project.settings.sampleRate;
  const audioTracks = doc.tracks.filter((t) => t.kind === 'audio' || t.kind === 'video');
  const anySolo = doc.tracks.some((t) => t.solo);

  const regions: AudioSourceRegion[] = [];
  const trackGain: Record<Id, number> = {};
  const ducks: DuckRequest[] = [];

  for (const track of doc.tracks) {
    const audible = track.enabled && !track.muted && (!anySolo || track.solo);
    trackGain[track.id] = audible ? dbToLinear(track.gainDb) : 0;
  }

  for (const track of audioTracks) {
    if (trackGain[track.id] === 0) continue;

    for (const clip of clipsInRange(doc, track.id, range)) {
      const params = clip.audio;
      if (!params || params.muted) continue;
      if (clip.content.kind !== 'media') continue;
      const media = doc.media[clip.content.mediaId];
      if (!media?.hasAudio) continue;

      const overlap = intersectRanges(clipRange(clip), range);
      if (!overlap) continue;

      const clipTimeStart = overlap.start - clip.start;
      const clipTimeEnd = clipTimeStart + overlap.duration;

      regions.push({
        clipId: clip.id,
        trackId: track.id,
        mediaId: clip.content.mediaId,
        offsetInBlock: overlap.start - range.start,
        duration: overlap.duration,
        sourceStart: sourceTimeAt(clip.speed, clip.mediaIn, clipTimeStart, clip.duration),
        rate: instantaneousRate(clip.speed, clipTimeStart, clip.duration),
        reverse: params.reverse || (clip.speed.kind !== 'freeze' && clip.speed.reverse),
        pitchSemitones: params.pitchSemitones,
        pitchCorrection: clip.speed.kind === 'freeze' ? true : clip.speed.pitchCorrection,
        gainStart: clipGainAt(params, clipTimeStart, clip.duration),
        gainEnd: clipGainAt(params, clipTimeEnd, clip.duration),
        panLeft: panGains(evaluateNumber(params.pan, clipTimeStart)).left,
        panRight: panGains(evaluateNumber(params.pan, clipTimeStart)).right,
        eq: params.eq,
        noiseReduction: params.noiseReduction,
      });

      if (params.ducking?.enabled && params.ducking.sidechainTrackId) {
        ducks.push({
          targetTrackId: track.id,
          sidechainTrackId: params.ducking.sidechainTrackId,
          amountDb: params.ducking.amountDb,
          attack: params.ducking.attack,
          release: params.ducking.release,
          thresholdDb: params.ducking.thresholdDb,
        });
      }
    }
  }

  return { range, sampleRate, regions, trackGain, ducks };
}

/**
 * Peak level per track over a block, for the mixer meters. Real levels come
 * from the renderer after mixing; this is the pre-render estimate used to draw
 * meters while scrubbing, when no audio is actually being played.
 */
export function estimatePeaks(block: AudioBlock): Record<Id, number> {
  const peaks: Record<Id, number> = {};
  for (const region of block.regions) {
    const gain = Math.max(region.gainStart, region.gainEnd) * (block.trackGain[region.trackId] ?? 0);
    peaks[region.trackId] = Math.max(peaks[region.trackId] ?? 0, gain);
  }
  return peaks;
}

/**
 * Ranges where nothing is audible — used by the "remove silence" action and to
 * skip decoding work during export.
 */
export function silentRanges(doc: EditDocument, range: TimeRange, step: Ticks): TimeRange[] {
  const out: TimeRange[] = [];
  let runStart: Ticks | null = null;

  for (let t = range.start; t < range.start + range.duration; t += step) {
    const block = composeAudioBlock(doc, { start: t, duration: step });
    const silent = block.regions.every(
      (r) => r.gainStart === 0 && r.gainEnd === 0,
    );
    if (silent && runStart === null) runStart = t;
    if (!silent && runStart !== null) {
      out.push({ start: runStart, duration: t - runStart });
      runStart = null;
    }
  }
  if (runStart !== null) {
    out.push({ start: runStart, duration: range.start + range.duration - runStart });
  }
  return out;
}
