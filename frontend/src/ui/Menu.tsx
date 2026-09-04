import { useCallback, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDismiss } from '../lib/hooks';
import { Icon, type IconName } from './Icon';
import { cx } from './primitives';

/**
 * A menu hung off a control.
 *
 * This is one of the three places in the interface that is allowed to be a
 * floating panel, because it genuinely floats: it appears over the page, it
 * has to be dismissable, and it closes on Escape or on any click outside it.
 */

export function Menu({
  label,
  trigger,
  children,
  align = 'end',
  width = 'w-56',
}: {
  /** The accessible name of the control that opens the menu. */
  label: string;
  trigger: (props: { open: boolean }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  align?: 'start' | 'end';
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center rounded text-text-2 transition-colors duration-fast ease-out hover:text-text"
      >
        {trigger({ open })}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={label}
          className={cx(
            'absolute top-[calc(100%+8px)] z-50 overflow-hidden rounded-lg border border-line-strong bg-raised py-1.5 shadow-raise animate-pop',
            align === 'end' ? 'right-0' : 'left-0',
            width,
          )}
        >
          {children({ close })}
        </div>
      ) : null}
    </div>
  );
}

const ITEM =
  'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13.5px] text-text-2 ' +
  'transition-colors duration-fast ease-out hover:bg-raised-hover hover:text-text';

export function MenuLink({
  to,
  icon,
  onSelect,
  children,
  badge,
}: {
  to: string;
  icon?: IconName;
  onSelect: () => void;
  children: ReactNode;
  badge?: number;
}) {
  return (
    <Link role="menuitem" to={to} onClick={onSelect} className={ITEM}>
      {icon ? <Icon name={icon} size={15} className="shrink-0 text-text-4" /> : null}
      <span className="flex-1">{children}</span>
      {badge ? <span className="font-mono text-[11.5px] text-accent">{badge}</span> : null}
    </Link>
  );
}

export function MenuButton({
  icon,
  onSelect,
  children,
}: {
  icon?: IconName;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" role="menuitem" onClick={onSelect} className={ITEM}>
      {icon ? <Icon name={icon} size={15} className="shrink-0 text-text-4" /> : null}
      {children}
    </button>
  );
}

export function MenuRule() {
  return <div className="my-1.5 border-t border-line" role="separator" />;
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <p className="px-3.5 pb-1.5 pt-1 text-[11.5px] text-text-4">{children}</p>;
}
