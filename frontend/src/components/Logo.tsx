import { Link } from 'react-router-dom';
import { cx } from './ui';

/**
 * The mark.
 *
 * A square navy tile with the serif C, drawn from the owner's logo file. It is
 * shown at a fixed pixel size with width and height set on the element, so the
 * masthead never reflows while the image decodes.
 */
export function Mark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      decoding="async"
      className={cx('shrink-0 rounded-[22%]', className)}
      style={{ width: size, height: size }}
    />
  );
}

/** The mark and the name, locked up as one link back to the front page. */
export function Wordmark({
  name,
  size = 30,
  className,
  hideNameUnder,
}: {
  name: string;
  size?: number;
  className?: string;
  hideNameUnder?: string;
}) {
  return (
    <Link
      to="/"
      aria-label={`${name} home`}
      className={cx('group flex shrink-0 items-center gap-2.5', className)}
    >
      <Mark size={size} />
      <span
        className={cx(
          'font-display leading-none tracking-[-0.02em] text-ink',
          hideNameUnder,
        )}
        style={{ fontSize: Math.round(size * 0.62) }}
      >
        {name}
      </span>
    </Link>
  );
}
