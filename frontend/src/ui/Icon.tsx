/**
 * The icon set.
 *
 * Every glyph is a stroked 24×24 path drawn inline, so the interface never
 * waits on an icon font or a sprite request, and a single stroke width keeps
 * them looking like one family. Icons are decorative by default: anything an
 * icon alone communicates is also written out in text somewhere near it.
 */

const PATHS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4',
  download: 'M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  upload: 'M12 21V9m0 0 4.5 4.5M12 9 7.5 13.5M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2',
  check: 'm4 12.5 5 5L20 6.5',
  close: 'M5 5l14 14M19 5 5 19',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  'chevron-right': 'm9 5 7 7-7 7',
  'chevron-left': 'm15 5-7 7 7 7',
  'chevron-down': 'm5 9 7 7 7-7',
  'chevron-up': 'm5 15 7-7 7 7',
  'arrow-right': 'M4 12h15m0 0-6-6m6 6-6 6',
  'arrow-left': 'M20 12H5m0 0 6-6m-6 6 6 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0',
  bell: 'M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6ZM10 19a2 2 0 0 0 4 0',
  bookmark: 'M6 4h12v16l-6-4-6 4V4Z',
  share: 'M16 6.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0ZM3 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0Zm13 5.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0Zm-8.2-4.3 8.4 4.1m0-9.6-8.4 4.1',
  copy: 'M9 9h10v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V9Zm-2 6H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1.4 1.4M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1.4-1.4',
  external: 'M14 4h6v6m0-6L11 13M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-9v5m0-9v.5',
  alert: 'M12 8v5m0 3v.5M10.3 4.2 2.8 17.4A2 2 0 0 0 4.5 20.4h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5',
  trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V7',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z',
  eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3.5 2',
  calendar: 'M4 8h16M7 4v3m10-3v3M5 8h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z',
  tag: 'M4 4h7l9 9-7 7-9-9V4Zm3.5 3.5v.01',
  folder: 'M4 6a1 1 0 0 1 1-1h4l2 2.5h8a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6Z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.2-1.7l2-1.5-2-3.5-2.3 1a8 8 0 0 0-3-1.7L14 2h-4l-.5 2.6a8 8 0 0 0-3 1.7l-2.3-1-2 3.5 2 1.5a8 8 0 0 0 0 3.4l-2 1.5 2 3.5 2.3-1a8 8 0 0 0 3 1.7L10 22h4l.5-2.6a8 8 0 0 0 3-1.7l2.3 1 2-3.5-2-1.5c.1-.6.2-1.1.2-1.7Z',
  'sign-out': 'M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2m3-4H9m11 0-3.5-3.5M20 12l-3.5 3.5',
  play: 'M7 4.5v15l13-7.5-13-7.5Z',
  pause: 'M9 5v14M15 5v14',
  image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm2.5 4.5v.01M3.5 16l5-5 4.5 4.5 3-3 4.5 4.5',
  film: 'M3 5h18v14H3V5Zm4 0v14m10-14v14M3 9.5h4m10 0h4M3 14.5h4m10 0h4',
  sliders: 'M4 8h10m3 0h3M4 16h4m3 0h9M14 5.5v5M8 13.5v5',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  grid: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6v.01M4 12v.01M4 18v.01',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-7 9a7 7 0 0 1 14 0m2-15.5a3.5 3.5 0 0 1 0 7M17 20h5a6 6 0 0 0-4-5.6',
  chart: 'M4 20V4m0 16h16M8 17v-5m4 5V8m4 9v-7',
  flag: 'M5 21V4m0 0h11l-2 3.5L16 11H5',
  file: 'M13 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8m-5-5 5 5m-5-5v5h5',
  archive: 'M3 6h18v3H3V6Zm2 3v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4',
  heart: 'M12 20s-8-4.7-8-10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.3-8 10-8 10Z',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z',
  mail: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm0 1.5 8 6 8-6',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z',
} as const;

export type IconName = keyof typeof PATHS;

interface Props {
  name: IconName;
  size?: number;
  className?: string;
  /** Give a label only when the icon is the whole meaning of a control. */
  label?: string;
}

export function Icon({ name, size = 16, className, label }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {label ? <title>{label}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
