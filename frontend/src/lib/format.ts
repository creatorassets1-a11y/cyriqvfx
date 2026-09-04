/**
 * Formatting.
 *
 * Everything a visitor reads as a number or a date passes through here. The
 * rule the whole file follows: show what the database says. A count is never
 * rounded up into a claim the rows cannot support, and a value that is absent
 * renders as nothing at all rather than as a zero or a placeholder glyph.
 */

const SIZES = ['KB', 'MB', 'GB', 'TB'];

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Relative time, in the units a person would actually say out loud. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '';

  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  // Past a month, "37d ago" stops meaning anything; a date is more useful.
  return formatShortDate(iso);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes / 1024;
  let step = 0;
  while (value >= 1024 && step < SIZES.length - 1) {
    value /= 1024;
    step += 1;
  }

  const rounded = value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${SIZES[step]}`;
}

/** Download counts, abbreviated but never inflated. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** SHOUTING_ENUM values, read back as a person would write them. */
export function titleCase(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export const skillLabel = titleCase;
export const flagLabel = titleCase;
export const statusLabel = titleCase;

/** A number with thousands separators, for tables and metrics. */
export function formatExact(n: number): string {
  return n.toLocaleString();
}
