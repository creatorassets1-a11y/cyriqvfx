/**
 * Frame-accurate time.
 *
 * Floating-point seconds are not a legal time representation anywhere in this
 * engine. Every timeline position, duration and media offset is an integer
 * number of ticks.
 *
 * TICKS_PER_SECOND is chosen so that a single frame at every frame rate we
 * support is an exact integer number of ticks, including the NTSC /1001 rates
 * and the two common audio sample rates:
 *
 *   705600000 / 24     = 29400000
 *   705600000 / 25     = 28224000
 *   705600000 / 30     = 23520000
 *   705600000 / 50     = 14112000
 *   705600000 / 60     = 11760000
 *   705600000 / (24000/1001) = 29429400
 *   705600000 / (30000/1001) = 23543520
 *   705600000 / (60000/1001) = 11771760
 *   705600000 / 48000  = 14700
 *   705600000 / 44100  = 16000
 *
 * At this rate Number.MAX_SAFE_INTEGER is ~147 days of timeline, which is
 * several orders of magnitude beyond any real project.
 */
export const TICKS_PER_SECOND = 705_600_000;

/** An integer number of ticks. Always exact. */
export type Ticks = number;

/** A frame rate expressed exactly, as a rational. */
export interface FrameRate {
  /** Numerator, e.g. 30000 for 29.97. */
  readonly num: number;
  /** Denominator, e.g. 1001 for 29.97. */
  readonly den: number;
  /**
   * Whether timecode for this rate is displayed drop-frame. Only meaningful
   * for the /1001 rates; ignored otherwise.
   */
  readonly dropFrame?: boolean;
}

export const FRAME_RATES = {
  fps23_976: { num: 24000, den: 1001 } as FrameRate,
  fps24: { num: 24, den: 1 } as FrameRate,
  fps25: { num: 25, den: 1 } as FrameRate,
  fps29_97: { num: 30000, den: 1001, dropFrame: true } as FrameRate,
  fps30: { num: 30, den: 1 } as FrameRate,
  fps50: { num: 50, den: 1 } as FrameRate,
  fps59_94: { num: 60000, den: 1001, dropFrame: true } as FrameRate,
  fps60: { num: 60, den: 1 } as FrameRate,
} as const;

export const ALL_FRAME_RATES: readonly FrameRate[] = Object.values(FRAME_RATES);

/** Exact tick count of one frame at `rate`. Throws if the rate is not exact. */
export function ticksPerFrame(rate: FrameRate): Ticks {
  const exact = (TICKS_PER_SECOND * rate.den) / rate.num;
  if (!Number.isInteger(exact)) {
    throw new RangeError(
      `Frame rate ${rate.num}/${rate.den} does not divide the tick base exactly`,
    );
  }
  return exact;
}

export function frameRateToNumber(rate: FrameRate): number {
  return rate.num / rate.den;
}

export function frameRatesEqual(a: FrameRate, b: FrameRate): boolean {
  return a.num * b.den === b.num * a.den;
}

/**
 * Convert seconds to ticks. Only for crossing the boundary with the outside
 * world (decoders, UI gestures); never for internal arithmetic.
 */
export function secondsToTicks(seconds: number): Ticks {
  return Math.round(seconds * TICKS_PER_SECOND);
}

export function ticksToSeconds(ticks: Ticks): number {
  return ticks / TICKS_PER_SECOND;
}

export function framesToTicks(frames: number, rate: FrameRate): Ticks {
  return Math.round(frames * ticksPerFrame(rate));
}

/** Frame index containing `ticks`. Floors, so a position mid-frame maps to that frame. */
export function ticksToFrames(ticks: Ticks, rate: FrameRate): number {
  return Math.floor(ticks / ticksPerFrame(rate));
}

/** Snap a position down to the frame boundary that contains it. */
export function floorToFrame(ticks: Ticks, rate: FrameRate): Ticks {
  const tpf = ticksPerFrame(rate);
  return Math.floor(ticks / tpf) * tpf;
}

/** Snap a position to the nearest frame boundary. */
export function roundToFrame(ticks: Ticks, rate: FrameRate): Ticks {
  const tpf = ticksPerFrame(rate);
  return Math.round(ticks / tpf) * tpf;
}

export function ceilToFrame(ticks: Ticks, rate: FrameRate): Ticks {
  const tpf = ticksPerFrame(rate);
  return Math.ceil(ticks / tpf) * tpf;
}

/** True when `ticks` sits exactly on a frame boundary. */
export function isOnFrame(ticks: Ticks, rate: FrameRate): boolean {
  return ticks % ticksPerFrame(rate) === 0;
}

/** Snap to an audio sample boundary — used when trimming audio-only clips. */
export function roundToSample(ticks: Ticks, sampleRate: number): Ticks {
  const tps = TICKS_PER_SECOND / sampleRate;
  if (!Number.isInteger(tps)) {
    // Non-exact sample rates fall back to nearest tick, which is sub-microsecond.
    return Math.round(ticks);
  }
  return Math.round(ticks / tps) * tps;
}

export interface TimecodeParts {
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
  /** True when the value was clamped at zero because the input was negative. */
  negative: boolean;
}

/**
 * SMPTE timecode. Implements true drop-frame counting for the /1001 rates:
 * the first two frame numbers of every minute are skipped except on minutes
 * divisible by ten, which keeps the clock aligned with wall time.
 */
export function ticksToTimecodeParts(ticks: Ticks, rate: FrameRate): TimecodeParts {
  const negative = ticks < 0;
  const frameIndex = Math.max(0, ticksToFrames(Math.abs(ticks), rate));
  const nominal = Math.round(frameRateToNumber(rate)); // 30 for 29.97, 24 for 23.976

  if (rate.dropFrame && rate.den === 1001) {
    const dropPerMinute = nominal === 30 ? 2 : nominal === 60 ? 4 : 0;
    if (dropPerMinute > 0) {
      const framesPer10Min = nominal * 60 * 10 - dropPerMinute * 9;
      const framesPerMin = nominal * 60 - dropPerMinute;

      const tenMinBlocks = Math.floor(frameIndex / framesPer10Min);
      let rem = frameIndex % framesPer10Min;

      // The first minute of each 10-minute block drops nothing.
      let minutesInBlock = 0;
      if (rem >= nominal * 60) {
        rem -= nominal * 60;
        minutesInBlock = 1 + Math.floor(rem / framesPerMin);
        rem = rem % framesPerMin;
        rem += dropPerMinute; // re-add the skipped frame numbers
      }

      const totalMinutes = tenMinBlocks * 10 + minutesInBlock;
      return {
        hours: Math.floor(totalMinutes / 60),
        minutes: totalMinutes % 60,
        seconds: Math.floor(rem / nominal),
        frames: rem % nominal,
        negative,
      };
    }
  }

  return {
    hours: Math.floor(frameIndex / (nominal * 3600)),
    minutes: Math.floor(frameIndex / (nominal * 60)) % 60,
    seconds: Math.floor(frameIndex / nominal) % 60,
    frames: frameIndex % nominal,
    negative,
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `01:23:45:12`, or `01:23:45;12` for drop-frame. */
export function formatTimecode(ticks: Ticks, rate: FrameRate): string {
  const p = ticksToTimecodeParts(ticks, rate);
  const sep = rate.dropFrame && rate.den === 1001 ? ';' : ':';
  const sign = p.negative ? '-' : '';
  return `${sign}${pad2(p.hours)}:${pad2(p.minutes)}:${pad2(p.seconds)}${sep}${pad2(p.frames)}`;
}

/** Compact `1:23.4` form for the timeline ruler, where SMPTE is too dense. */
export function formatDuration(ticks: Ticks, opts: { tenths?: boolean } = {}): string {
  const total = Math.max(0, ticksToSeconds(ticks));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = Math.floor(total) % 60;
  const base = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  if (!opts.tenths) return base;
  return `${base}.${Math.floor((total % 1) * 10)}`;
}

/** Parse `HH:MM:SS:FF` / `MM:SS:FF` / `SS:FF` timecode back to ticks. */
export function parseTimecode(text: string, rate: FrameRate): Ticks | null {
  const cleaned = text.trim().replace(/;/g, ':');
  if (!/^\d+(:\d+){0,3}$/.test(cleaned)) return null;
  const parts = cleaned.split(':').map((n) => parseInt(n, 10));
  while (parts.length < 4) parts.unshift(0);
  const [h, m, s, f] = parts as [number, number, number, number];
  const nominal = Math.round(frameRateToNumber(rate));
  if (f >= nominal) return null;

  let frameIndex: number;
  if (rate.dropFrame && rate.den === 1001) {
    const dropPerMinute = nominal === 30 ? 2 : nominal === 60 ? 4 : 0;
    const totalMinutes = h * 60 + m;
    const droppedMinutes = totalMinutes - Math.floor(totalMinutes / 10);
    frameIndex = totalMinutes * 60 * nominal + s * nominal + f - droppedMinutes * dropPerMinute;
  } else {
    frameIndex = ((h * 60 + m) * 60 + s) * nominal + f;
  }
  return framesToTicks(frameIndex, rate);
}

export function clampTicks(value: Ticks, min: Ticks, max: Ticks): Ticks {
  return value < min ? min : value > max ? max : value;
}

/** Half-open interval `[start, start + duration)`. */
export interface TimeRange {
  readonly start: Ticks;
  readonly duration: Ticks;
}

export const rangeEnd = (r: TimeRange): Ticks => r.start + r.duration;

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < rangeEnd(b) && b.start < rangeEnd(a);
}

export function rangeContains(r: TimeRange, t: Ticks): boolean {
  return t >= r.start && t < rangeEnd(r);
}

export function intersectRanges(a: TimeRange, b: TimeRange): TimeRange | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(rangeEnd(a), rangeEnd(b));
  return end > start ? { start, duration: end - start } : null;
}
