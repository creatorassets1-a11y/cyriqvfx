import { Link } from 'react-router-dom';
import { cx } from '../ui/primitives';

/**
 * The mark. It is the only image in the chrome, it ships at a fixed size, and
 * it always declares that size so the masthead never reflows around it.
 */
export function Brand({
  name,
  size = 30,
  className,
  as = 'link',
}: {
  name: string;
  size?: number;
  className?: string;
  as?: 'link' | 'plain';
}) {
  const content = (
    <>
      <img
        src="/logo.png"
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-sm"
        style={{ width: size, height: size }}
      />
      <span className="font-display text-[19px] tracking-[-0.01em] text-text">{name}</span>
    </>
  );

  if (as === 'plain') {
    return <span className={cx('inline-flex items-center gap-2.5', className)}>{content}</span>;
  }

  return (
    <Link
      to="/"
      aria-label={`${name} home`}
      className={cx('inline-flex items-center gap-2.5', className)}
    >
      {content}
    </Link>
  );
}
