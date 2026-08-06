import { describe, expect, it } from 'vitest';
import {
  ALL_FRAME_RATES,
  FRAME_RATES,
  formatTimecode,
  framesToTicks,
  isOnFrame,
  parseTimecode,
  roundToFrame,
  secondsToTicks,
  TICKS_PER_SECOND,
  ticksPerFrame,
  ticksToFrames,
  ticksToSeconds,
  ticksToTimecodeParts,
} from '../src/index.js';

describe('tick base', () => {
  it('divides every supported frame rate exactly', () => {
    for (const rate of ALL_FRAME_RATES) {
      expect(Number.isInteger(ticksPerFrame(rate))).toBe(true);
    }
  });

  it('divides both audio sample rates exactly', () => {
    expect(TICKS_PER_SECOND % 48000).toBe(0);
    expect(TICKS_PER_SECOND % 44100).toBe(0);
  });

  it('round-trips frames without drift over a long timeline', () => {
    // Three hours at 29.97 is where float-seconds implementations fall apart.
    const rate = FRAME_RATES.fps29_97;
    const frames = 3 * 60 * 60 * 30;
    expect(ticksToFrames(framesToTicks(frames, rate), rate)).toBe(frames);
  });

  it('keeps a full second of frames distinct at 60 fps', () => {
    const rate = FRAME_RATES.fps60;
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) seen.add(framesToTicks(i, rate));
    expect(seen.size).toBe(60);
  });
});

describe('frame snapping', () => {
  it('snaps to the nearest boundary', () => {
    const rate = FRAME_RATES.fps30;
    const tpf = ticksPerFrame(rate);
    expect(roundToFrame(tpf * 2 + 10, rate)).toBe(tpf * 2);
    expect(roundToFrame(tpf * 2 - 10, rate)).toBe(tpf * 2);
    expect(roundToFrame(Math.floor(tpf * 2.5) + 1, rate)).toBe(tpf * 3);
  });

  it('recognises exact frame boundaries', () => {
    const rate = FRAME_RATES.fps25;
    expect(isOnFrame(framesToTicks(7, rate), rate)).toBe(true);
    expect(isOnFrame(framesToTicks(7, rate) + 1, rate)).toBe(false);
  });
});

describe('timecode', () => {
  it('formats non-drop rates', () => {
    const rate = FRAME_RATES.fps25;
    const t = framesToTicks(25 * 60 * 61 + 12, rate); // 1h 01m 00s 12f
    expect(formatTimecode(t, rate)).toBe('01:01:00:12');
  });

  it('uses a semicolon separator for drop-frame', () => {
    const rate = FRAME_RATES.fps29_97;
    expect(formatTimecode(0, rate)).toBe('00:00:00;00');
  });

  it('skips the first two frame numbers of a non-tenth minute', () => {
    const rate = FRAME_RATES.fps29_97;
    // Frame 1800 is exactly one minute of counted frames; drop-frame labels it
    // 00:01:00;02 because ;00 and ;01 of that minute do not exist.
    const parts = ticksToTimecodeParts(framesToTicks(1800, rate), rate);
    expect([parts.minutes, parts.seconds, parts.frames]).toEqual([1, 0, 2]);
  });

  it('does not skip on the tenth minute', () => {
    const rate = FRAME_RATES.fps29_97;
    const framesPer10Min = 30 * 60 * 10 - 2 * 9;
    const parts = ticksToTimecodeParts(framesToTicks(framesPer10Min, rate), rate);
    expect([parts.minutes, parts.seconds, parts.frames]).toEqual([10, 0, 0]);
  });

  it('stays within a couple of frames of wall clock over an hour of drop-frame', () => {
    const rate = FRAME_RATES.fps29_97;
    const oneHourOfFrames = Math.round(3600 * (30000 / 1001));
    const parts = ticksToTimecodeParts(framesToTicks(oneHourOfFrames, rate), rate);
    expect(parts.hours).toBe(1);
    expect(parts.minutes).toBe(0);
    expect(parts.seconds).toBe(0);
  });

  it('round-trips through parsing', () => {
    for (const rate of ALL_FRAME_RATES) {
      const original = framesToTicks(12_345, rate);
      const text = formatTimecode(original, rate);
      expect(parseTimecode(text, rate)).toBe(original);
    }
  });

  it('rejects a frame number the rate cannot produce', () => {
    expect(parseTimecode('00:00:00:30', FRAME_RATES.fps30)).toBeNull();
    expect(parseTimecode('not a timecode', FRAME_RATES.fps30)).toBeNull();
  });
});

describe('seconds conversion', () => {
  it('round-trips whole seconds exactly', () => {
    expect(ticksToSeconds(secondsToTicks(12))).toBe(12);
  });
});
