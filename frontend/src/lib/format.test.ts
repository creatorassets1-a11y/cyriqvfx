import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatRelative,
  flagLabel,
  skillLabel,
} from './format';

/**
 * Formatting rules the interface depends on.
 *
 * These are the only pure functions in the frontend whose output a visitor
 * reads directly, so the edge cases are worth pinning: a count must never be
 * rounded up into a claim the database cannot support, and an absent value
 * must render as nothing rather than as a placeholder glyph.
 */

describe('formatCount', () => {
  it('shows small numbers exactly', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(7)).toBe('7');
    expect(formatCount(999)).toBe('999');
  });

  it('abbreviates thousands without inflating them', () => {
    expect(formatCount(1000)).toBe('1k');
    expect(formatCount(1240)).toBe('1.2k');
    expect(formatCount(12_400)).toBe('12k');
    expect(formatCount(1_240_000)).toBe('1.2M');
  });
});

describe('formatBytes', () => {
  it('keeps byte-scale values literal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('steps up units and drops a pointless decimal', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024 * 5)).toBe('5 MB');
    expect(formatBytes(1024 ** 3 * 2.5)).toBe('2.5 GB');
  });

  it('renders nothing when there is no size to show', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(undefined)).toBe('');
  });
});

describe('formatDuration', () => {
  it('pads the seconds so timestamps line up in a column', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3600)).toBe('60:00');
  });

  it('renders nothing for an unknown duration', () => {
    expect(formatDuration(null)).toBe('');
  });
});

describe('formatRelative', () => {
  it('describes recent moments in the units a person would use', () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(formatRelative(ago(10_000))).toBe('just now');
    expect(formatRelative(ago(5 * 60_000))).toBe('5m ago');
    expect(formatRelative(ago(3 * 3_600_000))).toBe('3h ago');
    expect(formatRelative(ago(4 * 86_400_000))).toBe('4d ago');
  });

  it('falls back to a date once relative time stops helping', () => {
    const longAgo = new Date(Date.now() - 200 * 86_400_000).toISOString();
    expect(formatRelative(longAgo)).not.toMatch(/ago/);
    expect(formatRelative(longAgo)).not.toBe('');
  });

  it('renders nothing when there is no timestamp', () => {
    expect(formatRelative(null)).toBe('');
  });
});

describe('label helpers', () => {
  it('reads enum values back as sentence case', () => {
    expect(skillLabel('BEGINNER')).toBe('Beginner');
    expect(flagLabel('CREATOR_PICK')).toBe('Creator Pick');
    expect(flagLabel('EXPERIMENTAL')).toBe('Experimental');
  });
});
