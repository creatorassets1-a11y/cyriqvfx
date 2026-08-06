import {
  ticksToSeconds,
  type FrameRate,
  type Ticks,
} from '../time/time.js';
import type { AspectRatioPreset, EditDocument, Resolution } from '../model/types.js';
import { documentDuration } from '../document/queries.js';

/**
 * Export configuration and presets.
 *
 * Bitrates below are chosen per codec and resolution rather than by a single
 * multiplier, because HEVC needs roughly 60% of H.264's rate for the same
 * perceived quality and every platform's re-encode punishes an under-specified
 * upload far more than it punishes a large file.
 */

export type VideoCodec = 'h264' | 'hevc' | 'av1';
export type AudioCodec = 'aac' | 'opus';
export type Container = 'mp4' | 'mov' | 'webm';

export interface ExportSettings {
  readonly resolution: Resolution;
  readonly frameRate: FrameRate;
  readonly videoCodec: VideoCodec;
  readonly audioCodec: AudioCodec;
  readonly container: Container;
  /** Bits per second. */
  readonly videoBitrate: number;
  readonly audioBitrate: number;
  readonly hdr: boolean;
  /** Range to render; null exports the whole timeline. */
  readonly range: { start: Ticks; duration: Ticks } | null;
  readonly includeAudio: boolean;
  /** Constant quality where the encoder supports it, else bitrate-targeted. */
  readonly mode: 'quality' | 'bitrate';
  /** 0..100, higher is better. Only read in 'quality' mode. */
  readonly quality: number;
}

export interface ExportPreset {
  readonly id: string;
  readonly name: string;
  readonly group: 'social' | 'quality' | 'archive';
  readonly aspect: AspectRatioPreset | 'match';
  readonly longEdge: number;
  readonly videoCodec: VideoCodec;
  readonly container: Container;
  /** Max duration the destination accepts, for the pre-export warning. */
  readonly maxDurationSeconds?: number;
  readonly note?: string;
}

export const EXPORT_PRESETS: readonly ExportPreset[] = [
  {
    id: 'tiktok',
    name: 'TikTok',
    group: 'social',
    aspect: '9:16',
    longEdge: 1920,
    videoCodec: 'h264',
    container: 'mp4',
    maxDurationSeconds: 600,
    note: 'H.264 uploads re-encode less aggressively than HEVC here.',
  },
  {
    id: 'reels',
    name: 'Instagram Reels',
    group: 'social',
    aspect: '9:16',
    longEdge: 1920,
    videoCodec: 'h264',
    container: 'mp4',
    maxDurationSeconds: 900,
  },
  {
    id: 'shorts',
    name: 'YouTube Shorts',
    group: 'social',
    aspect: '9:16',
    longEdge: 1920,
    videoCodec: 'h264',
    container: 'mp4',
    maxDurationSeconds: 180,
  },
  {
    id: 'youtube-1080',
    name: 'YouTube 1080p',
    group: 'social',
    aspect: '16:9',
    longEdge: 1920,
    videoCodec: 'h264',
    container: 'mp4',
  },
  {
    id: 'youtube-4k',
    name: 'YouTube 4K',
    group: 'quality',
    aspect: '16:9',
    longEdge: 3840,
    videoCodec: 'hevc',
    container: 'mp4',
  },
  {
    id: 'feed-square',
    name: 'Feed Square',
    group: 'social',
    aspect: '1:1',
    longEdge: 1080,
    videoCodec: 'h264',
    container: 'mp4',
  },
  {
    id: 'feed-portrait',
    name: 'Feed Portrait',
    group: 'social',
    aspect: '4:5',
    longEdge: 1350,
    videoCodec: 'h264',
    container: 'mp4',
  },
  {
    id: 'master-4k',
    name: 'Master 4K',
    group: 'quality',
    aspect: 'match',
    longEdge: 3840,
    videoCodec: 'hevc',
    container: 'mov',
    note: 'High bitrate master for archiving or handing off to a desktop NLE.',
  },
  {
    id: 'master-hdr',
    name: 'Master 4K HDR',
    group: 'quality',
    aspect: 'match',
    longEdge: 3840,
    videoCodec: 'hevc',
    container: 'mov',
    note: 'Rec.2100 HLG. Only available when the project is HDR.',
  },
];

/**
 * Target video bitrate.
 *
 * Scales with pixel rate rather than resolution alone, so a 60 fps export gets
 * the extra bits it needs instead of the smearing a fixed-per-resolution table
 * produces.
 */
export function recommendedBitrate(
  resolution: Resolution,
  frameRate: FrameRate,
  codec: VideoCodec,
  hdr = false,
): number {
  const pixels = resolution.width * resolution.height;
  const fps = frameRate.num / frameRate.den;
  const pixelRate = pixels * fps;

  // Bits per pixel per second, calibrated at 1080p30 ≈ 12 Mbps for H.264.
  const bppsByCodec: Record<VideoCodec, number> = {
    h264: 0.19e-6,
    hevc: 0.12e-6,
    av1: 0.1e-6,
  };

  let bitrate = pixelRate * bppsByCodec[codec] * 1e6;
  if (hdr) bitrate *= 1.25;
  // Clamp to a range that stays playable on phones and useful for delivery.
  return Math.round(Math.min(Math.max(bitrate, 2_000_000), 150_000_000));
}

export function settingsFromPreset(
  doc: EditDocument,
  preset: ExportPreset,
  overrides: Partial<ExportSettings> = {},
): ExportSettings {
  const projectRes = doc.project.settings.resolution;
  const aspect =
    preset.aspect === 'match'
      ? projectRes.width / projectRes.height
      : ASPECT_VALUES[preset.aspect] ?? projectRes.width / projectRes.height;

  const resolution =
    aspect >= 1
      ? { width: even(preset.longEdge), height: even(Math.round(preset.longEdge / aspect)) }
      : { width: even(Math.round(preset.longEdge * aspect)), height: even(preset.longEdge) };

  const frameRate = doc.project.settings.frameRate;
  const hdr = preset.id === 'master-hdr' && doc.project.settings.colorSpace !== 'rec709';

  return {
    resolution,
    frameRate,
    videoCodec: preset.videoCodec,
    audioCodec: preset.container === 'webm' ? 'opus' : 'aac',
    container: preset.container,
    videoBitrate: recommendedBitrate(resolution, frameRate, preset.videoCodec, hdr),
    audioBitrate: 256_000,
    hdr,
    range: null,
    includeAudio: true,
    mode: 'quality',
    quality: 80,
    ...overrides,
  };
}

const ASPECT_VALUES: Record<string, number> = {
  '9:16': 9 / 16,
  '16:9': 16 / 9,
  '1:1': 1,
  '4:5': 4 / 5,
  '4:3': 4 / 3,
  '2.35:1': 2.35,
};

const even = (n: number) => (n % 2 === 0 ? n : n + 1);

/** Estimated output size in bytes, for the pre-export summary. */
export function estimateFileSize(doc: EditDocument, settings: ExportSettings): number {
  const durationTicks = settings.range?.duration ?? documentDuration(doc);
  const seconds = ticksToSeconds(durationTicks);
  const bits = seconds * (settings.videoBitrate + (settings.includeAudio ? settings.audioBitrate : 0));
  // ~2% container overhead for MP4/MOV atoms and interleaving.
  return Math.round((bits / 8) * 1.02);
}

export interface ExportWarning {
  readonly severity: 'info' | 'warning';
  readonly message: string;
}

/**
 * Everything worth telling the user before they commit to a long render — all
 * of it derived, none of it blocking.
 */
export function exportWarnings(
  doc: EditDocument,
  settings: ExportSettings,
  preset?: ExportPreset,
): ExportWarning[] {
  const out: ExportWarning[] = [];
  const durationTicks = settings.range?.duration ?? documentDuration(doc);
  const seconds = ticksToSeconds(durationTicks);

  if (durationTicks === 0) {
    out.push({ severity: 'warning', message: 'The timeline is empty — there is nothing to export.' });
  }

  if (preset?.maxDurationSeconds && seconds > preset.maxDurationSeconds) {
    out.push({
      severity: 'warning',
      message: `${preset.name} accepts up to ${Math.round(preset.maxDurationSeconds / 60)} minutes; this export is ${Math.ceil(seconds / 60)}.`,
    });
  }

  const projectRes = doc.project.settings.resolution;
  if (settings.resolution.width > projectRes.width) {
    out.push({
      severity: 'info',
      message: 'Exporting above the project resolution will not add detail.',
    });
  }

  if (settings.hdr && doc.project.settings.colorSpace === 'rec709') {
    out.push({
      severity: 'warning',
      message: 'This project is set up for SDR; an HDR export will not carry HDR detail.',
    });
  }

  const size = estimateFileSize(doc, settings);
  if (size > 4 * 1024 ** 3 && settings.container === 'mp4') {
    out.push({
      severity: 'info',
      message: 'Estimated file is over 4 GB. Some destinations reject files that large.',
    });
  }

  return out;
}

/** A render job's observable state, shared by preview export and background export. */
export interface ExportProgress {
  readonly phase: 'preparing' | 'rendering' | 'encoding' | 'finalizing' | 'done' | 'failed';
  /** 0..1. */
  readonly progress: number;
  readonly framesRendered: number;
  readonly framesTotal: number;
  readonly estimatedSecondsRemaining: number | null;
  readonly error?: string;
}

export function totalFrames(doc: EditDocument, settings: ExportSettings): number {
  const durationTicks = settings.range?.duration ?? documentDuration(doc);
  const fps = settings.frameRate.num / settings.frameRate.den;
  return Math.max(0, Math.round(ticksToSeconds(durationTicks) * fps));
}
