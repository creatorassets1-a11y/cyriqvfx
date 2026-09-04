import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

/** Joins class names, dropping anything falsy. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  // The one thing on a page that is filled is the thing to do next.
  primary: 'bg-accent text-on-fill hover:bg-accent-bright disabled:hover:bg-accent',
  secondary: 'border border-line-strong text-text hover:border-text-3 hover:bg-raised',
  quiet: 'text-text-2 hover:text-text hover:bg-raised',
  danger: 'border border-critical/60 text-critical hover:bg-critical-wash',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-[14px] gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2.5',
};

const BUTTON_BASE =
  'inline-flex select-none items-center justify-center whitespace-nowrap rounded font-semibold ' +
  'transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-45';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconAfter?: IconName;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconAfter, loading, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(BUTTON_BASE, VARIANTS[variant], SIZES[size], block && 'w-full', className)}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={size === 'lg' ? 17 : 15} /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} size={size === 'lg' ? 17 : 15} /> : null}
    </button>
  );
});

/** A link that carries a button's weight, for navigation rather than action. */
export function ButtonLink({
  to,
  variant = 'secondary',
  size = 'md',
  icon,
  iconAfter,
  block,
  className,
  children,
}: {
  to: string;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconAfter?: IconName;
  block?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cx(BUTTON_BASE, VARIANTS[variant], SIZES[size], block && 'w-full', className)}
    >
      {icon ? <Icon name={icon} size={size === 'lg' ? 17 : 15} /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} size={size === 'lg' ? 17 : 15} /> : null}
    </Link>
  );
}

export function Spinner({ size = 15 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full border-2 border-current border-r-transparent"
      style={{ width: size, height: size, animation: 'spin 700ms linear infinite' }}
    />
  );
}

// ---------------------------------------------------------------------------
// Labels and small facts
// ---------------------------------------------------------------------------

type Tone = 'neutral' | 'accent' | 'positive' | 'caution' | 'critical';

const TONES: Record<Tone, string> = {
  neutral: 'text-text-3',
  accent: 'text-accent',
  positive: 'text-positive',
  caution: 'text-caution',
  critical: 'text-critical',
};

/** A tracked, uppercase status word. Never a filled pill. */
export function Marker({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('text-[11px] font-semibold uppercase tracking-[0.1em]', TONES[tone])}>
      {children}
    </span>
  );
}

/** One piece of metadata in a row of them, in the numeric face. */
export function Fact({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-text-3">
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  );
}

/** A section opener: a rule, a label above it, the heading under it. */
export function SectionHead({
  kicker,
  title,
  action,
  level = 2,
}: {
  kicker?: string;
  title: string;
  action?: ReactNode;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="mb-6 border-t border-line pt-4">
      {kicker ? <p className="kicker mb-2">{kicker}</p> : null}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <Heading className={level === 2 ? 'text-[26px] md:text-[30px]' : 'text-[21px]'}>
          {title}
        </Heading>
        {action}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode;
  hint?: string;
  error?: string;
  optional?: boolean;
}

/**
 * Wires a label, a hint and an error to one control. Every input in the app
 * goes through this, which is why nothing ends up with a placeholder standing
 * in for a label.
 */
export function Field({ label, children, hint, error, optional }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-text">
        {label}
        {optional ? <span className="ml-2 font-normal text-text-4">optional</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-[12.5px] leading-relaxed text-text-3">
          {hint}
        </p>
      ) : null}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={errorId} className="text-[12.5px] text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const CONTROL =
  'w-full rounded border border-line-strong bg-inset px-3 text-[14px] text-text ' +
  'placeholder:text-text-4 transition-colors duration-fast ease-out ' +
  'hover:border-text-4 focus:border-accent aria-[invalid=true]:border-critical';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(CONTROL, 'h-11', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cx(CONTROL, 'py-2.5 leading-relaxed', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cx(CONTROL, 'h-11 appearance-none pr-8', className)} {...rest}>
        {children}
      </select>
    );
  },
);

/**
 * An on/off control that reports itself as a switch, so it reads correctly to
 * a screen reader and can be driven from the keyboard like a button.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-line py-4">
      <div className="min-w-0">
        <p className={cx('text-[14px] font-medium', disabled ? 'text-text-4' : 'text-text')}>
          {label}
        </p>
        {description ? (
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-3">{description}</p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-fast ease-out',
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-inset',
          disabled && 'cursor-not-allowed opacity-45',
        )}
      >
        <span
          className={cx(
            'absolute top-1/2 block h-4 w-4 -translate-y-1/2 rounded-full transition-all duration-fast ease-out',
            checked ? 'left-[24px] bg-on-fill' : 'left-[3px] bg-text-3',
          )}
        />
      </button>
    </div>
  );
}

/** A checkbox with its label, used wherever a list of things is picked. */
export function Check({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[13.5px] text-text-2 hover:text-text">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0"
      />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('loading rounded-sm', className)} aria-hidden="true" />;
}

/**
 * An empty state always says what would fill it and offers the next step. A
 * blank page with a shrug is never an answer (a search that found nothing is
 * the most common one a visitor will see).
 */
export function Empty({
  title,
  body,
  action,
  icon = 'info',
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="flex flex-col items-center gap-3 border-y border-line px-6 py-16 text-center">
      <Icon name={icon} size={22} className="text-text-4" />
      <p className="text-[17px] font-medium text-text">{title}</p>
      {body ? <p className="max-w-sm text-[14px] leading-relaxed text-text-3">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** A short, non-blocking note: a warning, a confirmation, an explanation. */
export function Note({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const border =
    tone === 'critical'
      ? 'border-critical'
      : tone === 'caution'
        ? 'border-caution'
        : tone === 'positive'
          ? 'border-positive'
          : tone === 'accent'
            ? 'border-accent'
            : 'border-line-strong';

  return (
    <p
      className={cx(
        'border-l-2 py-1 pl-4 text-[13px] leading-relaxed',
        border,
        tone === 'neutral' ? 'text-text-2' : TONES[tone],
      )}
    >
      {children}
    </p>
  );
}

export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav className="mt-10 flex items-center justify-between border-t border-line pt-5" aria-label="Pagination">
      <Button size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <p className="font-mono text-[12.5px] text-text-3" aria-live="polite">
        Page {page} of {totalPages}
      </p>
      <Button
        size="sm"
        iconAfter="chevron-right"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
