/**
 * One coherent icon set (PRD §80). Line icons on a 24px grid, inheriting
 * currentColor. No emoji in navigation or controls.
 */

export type IconName =
  | 'search' | 'download' | 'bookmark' | 'bookmark-filled' | 'share' | 'link'
  | 'check' | 'close' | 'chevron-down' | 'chevron-right' | 'chevron-left' | 'arrow-right'
  | 'menu' | 'filter' | 'bell' | 'user' | 'settings' | 'logout' | 'play' | 'pause'
  | 'film' | 'sparkles' | 'scissors' | 'aperture' | 'palette' | 'sliders' | 'shuffle'
  | 'layers' | 'volume' | 'terminal' | 'layout' | 'type' | 'grid' | 'list' | 'clock'
  | 'alert' | 'info' | 'plus' | 'trash' | 'edit' | 'eye' | 'upload' | 'file' | 'folder'
  | 'chart' | 'users' | 'flag' | 'history' | 'external' | 'copy' | 'spinner' | 'star'
  | 'shield' | 'refresh' | 'image' | 'video' | 'music' | 'more' | 'drag' | 'inbox' | 'lock';

const paths: Record<IconName, string> = {
  search: 'M11 3a8 8 0 105.29 14.03l3.84 3.84 1.41-1.41-3.84-3.84A8 8 0 0011 3zm0 2a6 6 0 110 12 6 6 0 010-12z',
  download: 'M12 3v10.17l3.59-3.58L17 11l-5 5-5-5 1.41-1.41L12 13.17V3zM5 19h14v2H5z',
  bookmark: 'M6 3h12a1 1 0 011 1v17l-7-4-7 4V4a1 1 0 011-1zm1 2v13.3l5-2.86 5 2.86V5z',
  'bookmark-filled': 'M6 3h12a1 1 0 011 1v17l-7-4-7 4V4a1 1 0 011-1z',
  share: 'M18 2a3 3 0 00-2.83 4L8.7 9.6a3 3 0 100 4.8l6.47 3.6a3 3 0 101-1.73L9.7 12.67a3 3 0 000-1.34l6.47-3.6A3 3 0 1018 2z',
  link: 'M10.6 13.4a1 1 0 001.41 0l3.54-3.53a2 2 0 10-2.83-2.83l-1.06 1.06 1.42 1.42 1.06-1.07a.5.5 0 01.7.71l-3.53 3.53a1 1 0 000 .71zm-4.24 4.24a2 2 0 002.83 0l1.06-1.06-1.42-1.42-1.06 1.07a.5.5 0 01-.71-.71l3.54-3.53-1.42-1.42-3.53 3.54a2 2 0 00-.71 3.53z',
  check: 'M9.55 17.6L4 12.05l1.41-1.41 4.14 4.13 9.04-9.03L20 7.15z',
  close: 'M18.3 5.71L12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71l-1.42-1.42L9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.3-6.3z',
  'chevron-down': 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  'chevron-right': 'M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z',
  'chevron-left': 'M15.41 7.41L10.83 12l4.58 4.59L14 18l-6-6 6-6z',
  'arrow-right': 'M13.17 12l-4.58 4.59L10 18l6-6-6-6-1.41 1.41z M4 11h11v2H4z',
  menu: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z',
  filter: 'M3 5h18v2l-7 7v6l-4-2v-4L3 7z',
  bell: 'M12 2a6 6 0 016 6v4l1.5 3H4.5L6 12V8a6 6 0 016-6zm0 2a4 4 0 00-4 4v4.47L7.24 15h9.52L16 12.47V8a4 4 0 00-4-4zm-2 13h4a2 2 0 11-4 0z',
  user: 'M12 3a4 4 0 110 8 4 4 0 010-8zm0 2a2 2 0 100 4 2 2 0 000-4zm0 8c3.87 0 7 2.24 7 5v2H5v-2c0-2.76 3.13-5 7-5zm0 2c-2.9 0-5 1.5-5 3h10c0-1.5-2.1-3-5-3z',
  settings: 'M12 8a4 4 0 110 8 4 4 0 010-8zm0 2a2 2 0 100 4 2 2 0 000-4zm7.4 2l1.5 1.2-1.5 2.6-1.85-.6a6.8 6.8 0 01-1.4.8L15.4 21h-3l-.75-1.9a6.8 6.8 0 01-1.4-.8l-1.85.6-1.5-2.6L8.4 15a6.8 6.8 0 010-1.6L6.9 12.2l1.5-2.6 1.85.6c.44-.32.9-.6 1.4-.8L12.4 3h3l.75 1.9c.5.2.96.48 1.4.8l1.85-.6 1.5 2.6L19.4 9c.06.53.06 1.07 0 1.6z',
  logout: 'M10 3v2H5v14h5v2H3V3zm5.5 4.5L20 12l-4.5 4.5-1.41-1.41L16.17 13H9v-2h7.17l-2.08-2.09z',
  play: 'M8 5l12 7-12 7z',
  pause: 'M7 5h4v14H7zm6 0h4v14h-4z',
  film: 'M3 4h18v16H3zm2 2v2h2V6zm12 0v2h2V6zM5 10v4h14v-4zm0 6v2h2v-2zm12 0v2h2v-2z',
  sparkles: 'M12 2l1.9 5.6L19.5 9l-5.6 1.9L12 16.5l-1.9-5.6L4.5 9l5.6-1.4zM18 14l.9 2.6L21.5 18l-2.6.9L18 21.5l-.9-2.6L14.5 18l2.6-.4z',
  scissors: 'M9.64 7.64a3 3 0 10-2.28 1.06L10 12l-2.64 3.3a3 3 0 102.28 1.06L12 13.5l5.5 6.5H21l-7.5-9L21 4h-3.5L12 10.5zM6 5a1 1 0 110 2 1 1 0 010-2zm0 12a1 1 0 110 2 1 1 0 010-2z',
  aperture: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 2a7 7 0 016.32 4h-6.9l3.03-3.7A6.9 6.9 0 0012 5zm-4.6 1.9L10.4 12l-3.1 5.1A7 7 0 017.4 6.9zM12 19a7 7 0 01-2.7-.54L12.3 15h6.14A7 7 0 0112 19z',
  palette: 'M12 3a9 9 0 000 18c1.1 0 2-.9 2-2 0-.5-.2-.96-.5-1.3-.3-.34-.5-.8-.5-1.2 0-1.1.9-2 2-2h1.5A4.5 4.5 0 0021 10c0-3.87-4.03-7-9-7zm-4.5 8a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm3-4a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm5 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z',
  sliders: 'M4 6h9v2H4zm11-2h2v6h-2zm4 2h1v2h-1zM4 11h4v2H4zm6-2h2v6h-2zm4 2h6v2h-6zM4 16h9v2H4zm11-2h2v6h-2zm4 2h1v2h-1z',
  shuffle: 'M17 3l4 4-4 4V8h-2.6l-2 3-1.2-1.8L13.3 6H17zM3 6h5.5l1.4 2H3zm14 9v-3l4 4-4 4v-3h-3.7l-2.1-3.2 1.2-1.8 2 3zM3 16h5.5l1.4-2H3z',
  layers: 'M12 2l10 5-10 5L2 7zm0 2.2L6.5 7 12 9.8 17.5 7zM2 12l10 5 10-5-2.2-1.1L12 14.8 4.2 10.9zm0 5l10 5 10-5-2.2-1.1L12 19.8 4.2 15.9z',
  volume: 'M11 5v14l-5-4H3V9h3zm3.5 1.5a6 6 0 010 11v-2a4 4 0 000-7zm2-3a9 9 0 010 17v-2a7 7 0 000-13z',
  terminal: 'M3 4h18v16H3zm2 2v12h14V6zm2 2l4 4-4 4-1.4-1.4L8.2 12 5.6 9.4zm5 7h6v2h-6z',
  layout: 'M3 4h18v16H3zm2 2v3h14V6zm0 5v7h5v-7zm7 0v7h7v-7z',
  type: 'M4 4h16v4h-2V6h-5v12h2v2H9v-2h2V6H6v2H4z',
  grid: 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z',
  list: 'M3 5h3v3H3zm5 0h13v3H8zM3 10.5h3v3H3zm5 0h13v3H8zM3 16h3v3H3zm5 0h13v3H8z',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 2a7 7 0 110 14 7 7 0 010-14zm-1 2v6l4.5 2.7 1-1.65L13 11.5V7z',
  alert: 'M12 2l11 19H1zm0 4L4.5 19h15zM11 10h2v5h-2zm0 6h2v2h-2z',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 2a7 7 0 110 14 7 7 0 010-14zm-1 2h2v2h-2zm0 4h2v6h-2z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  trash: 'M9 3h6l1 2h4v2H4V5h4zm-3 5h12l-1 13H7zm3 2v9h1v-9zm4 0v9h1v-9z',
  edit: 'M17.7 3.3l3 3a1 1 0 010 1.4l-2 2-4.4-4.4 2-2a1 1 0 011.4 0zM13 6.7l4.3 4.3L8 20.3 3.5 21l.7-4.5z',
  eye: 'M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7zm0 2c-3.5 0-6.4 3-6.9 5 .5 2 3.4 5 6.9 5s6.4-3 6.9-5c-.5-2-3.4-5-6.9-5zm0 2a3 3 0 110 6 3 3 0 010-6z',
  upload: 'M12 3l5 5-1.41 1.41L13 6.83V17h-2V6.83L8.41 9.41 7 8zM5 19h14v2H5z',
  file: 'M6 2h8l4 4v16H6zm2 2v16h8V8h-4V4zm2 8h4v2h-4zm0 4h4v2h-4z',
  folder: 'M3 5h6l2 2h10v12H3zm2 2v10h14V9h-8.8L8.2 7z',
  chart: 'M4 20V4h2v14h14v2zm4-3V9h3v8zm5 0V5h3v12zm5 0v-6h3v6z',
  users: 'M9 4a3.5 3.5 0 110 7 3.5 3.5 0 010-7zm0 2a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm7 .5a3 3 0 110 6 3 3 0 010-6zM9 13c3.3 0 6 1.8 6 4v2H3v-2c0-2.2 2.7-4 6-4zm7 .5c2.8 0 5 1.5 5 3.5v2h-4v-2c0-1.2-.5-2.3-1.4-3.2z',
  flag: 'M5 3h2v18H5zm3 1h11l-2.5 4L19 12H8z',
  history: 'M12 3a9 9 0 018.9 10.4l-2-.3A7 7 0 105.6 8H9v2H2V3h2v3.3A9 9 0 0112 3zm-1 4h2v5.6l3.4 2-1 1.7L11 13.5z',
  external: 'M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14zM5 5h5v2H7v10h10v-3h2v5H5z',
  copy: 'M8 2h11v14h-3v3H5V5h3zm2 2v10h7V4zm-3 3v10h7v-1H8V7z',
  spinner: 'M12 3a9 9 0 019 9h-2a7 7 0 00-7-7z',
  star: 'M12 3l2.7 5.9 6.3.7-4.7 4.3 1.3 6.1L12 17l-5.6 3 1.3-6.1L3 9.6l6.3-.7z',
  shield: 'M12 2l8 3v6c0 4.5-3.2 8.5-8 11-4.8-2.5-8-6.5-8-11V5zm0 2.2L6 6.4V11c0 3.4 2.3 6.5 6 8.7 3.7-2.2 6-5.3 6-8.7V6.4z',
  refresh: 'M12 4a8 8 0 017.4 5H17a6 6 0 00-9.9-1.5L9 9H3V3l2.1 2.1A8 8 0 0112 4zm0 16a8 8 0 01-7.4-5H7a6 6 0 009.9 1.5L15 15h6v6l-2.1-2.1A8 8 0 0112 20z',
  image: 'M3 4h18v16H3zm2 2v9l4-4 3 3 3-3 3 3V6zm3 1.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z',
  video: 'M3 5h12v14H3zm14 4l4-3v12l-4-3z',
  music: 'M19 3v12.5a3.5 3.5 0 11-2-3.16V7l-8 1.6v9.9a3.5 3.5 0 11-2-3.16V6z',
  more: 'M6 10a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4z',
  drag: 'M9 4a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM9 10a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM9 16a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z',
  inbox: 'M4 4h16l2 10v6H2v-6zm1.6 2l-1.4 7H9a3 3 0 006 0h4.8l-1.4-7z',
  lock: 'M12 2a5 5 0 015 5v3h2v12H5V10h2V7a5 5 0 015-5zm0 2a3 3 0 00-3 3v3h6V7a3 3 0 00-3-3zm-5 8v8h10v-8z',
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Purely decorative icons stay out of the accessibility tree. */
  title?: string;
}

export function Icon({ name, size = 20, className = '', title }: IconProps) {
  const d = paths[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`${className} ${name === 'spinner' ? 'animate-[spin_0.7s_linear_infinite]' : ''} shrink-0`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
}

/** Maps a category's stored icon name onto the set, with a sane fallback. */
export function categoryIcon(icon: string | null | undefined): IconName {
  if (icon && icon in paths) return icon as IconName;
  return 'folder';
}
