import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

/**
 * Interface primitives.
 *
 * The rule throughout: content is not put in a box unless the box does
 * something. Grouping is expressed with space, alignment and hairlines.
 */

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-on-ink hover:bg-[var(--blue-light)]',
  secondary: 'text-ink border border-rule-strong hover:border-ink hover:bg-sunk',
  quiet: 'text-soft hover:text-ink hover:bg-sunk',
  danger: 'text-[var(--stop)] border border-[color:var(--stop)] hover:bg-[var(--stop-wash)]',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-[13px] gap-1.5',
  md: 'h-11 px-4 text-[14.5px] gap-2',
  lg: 'h-[52px] px-7 text-[15.5px] gap-2.5',
};

const base =
  'inline-flex items-center justify-center rounded font-medium whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,color,transform] duration-fast ease-out ' +
  'active:scale-[0.985] disabled:opacity-45 disabled:pointer-events-none';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading,
  fullWidth,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const glyph = size === 'sm' ? 14 : 17;
  return (
    <button
      className={cx(base, variants[variant], sizes[size], fullWidth && 'w-full', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Icon name="spinner" size={glyph} />
      ) : icon ? (
        <Icon name={icon} size={glyph} />
      ) : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={glyph} /> : null}
    </button>
  );
}

export function LinkButton({
  to,
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  className,
  children,
  fullWidth,
}: {
  to: string;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  className?: string;
  children: ReactNode;
  fullWidth?: boolean;
}) {
  const glyph = size === 'sm' ? 14 : 17;
  return (
    <Link
      to={to}
      className={cx(base, variants[variant], sizes[size], fullWidth && 'w-full', className)}
    >
      {icon ? <Icon name={icon} size={glyph} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={glyph} /> : null}
    </Link>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  variant?: Variant;
  size?: Size;
  active?: boolean;
}

export function IconButton({
  icon,
  label,
  variant = 'quiet',
  size = 'md',
  active,
  className,
  ...rest
}: IconButtonProps) {
  const dim = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-12 w-12' : 'h-11 w-11';
  return (
    <button
      className={cx(base, variants[variant], dim, 'px-0', active && 'text-blue bg-[var(--blue-wash)]', className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 16 : 19} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Labels for state. Text with weight, not a filled pill on everything.
// ---------------------------------------------------------------------------

type Tone = 'neutral' | 'blue' | 'go' | 'warn' | 'stop';

const toneText: Record<Tone, string> = {
  neutral: 'text-faint',
  blue: 'text-blue',
  go: 'text-[var(--go)]',
  warn: 'text-[var(--warn)]',
  stop: 'text-[var(--stop)]',
};

const toneDot: Record<Tone, string> = {
  neutral: 'bg-[var(--ink-ghost)]',
  blue: 'bg-blue',
  go: 'bg-[var(--go)]',
  warn: 'bg-[var(--warn)]',
  stop: 'bg-[var(--stop)]',
};

/** A state marker: a small dot and a tracked word. No container. */
export function Marker({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em]',
        toneText[tone],
        className,
      )}
    >
      <span className={cx('h-[5px] w-[5px] rounded-full', toneDot[tone])} aria-hidden />
      {children}
    </span>
  );
}

/** A fact, set in the mono face so numbers and versions line up. */
export function Fact({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('font-mono text-[12.5px] text-faint', className)}>{children}</span>
  );
}

// ---------------------------------------------------------------------------
// Form fields. A label, a line, and the input. No surrounding box.
// ---------------------------------------------------------------------------

const fieldBase =
  'w-full bg-transparent border-0 border-b border-rule-strong px-0 text-[16px] text-ink ' +
  'placeholder:text-ghost transition-colors duration-fast rounded-none ' +
  'hover:border-ink focus:border-blue focus:outline-none focus:ring-0 ' +
  'disabled:opacity-50';

interface FieldWrapProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, children, className }: FieldWrapProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {/* The marker sits outside the label so the accessible name stays clean. */}
      <div className="flex items-baseline gap-1">
        <label htmlFor={id} className="text-[12.5px] font-semibold tracking-[0.02em] text-soft">
          {label}
        </label>
        {required ? (
          <span aria-hidden className="text-[12.5px] text-[var(--stop)]">
            *
          </span>
        ) : null}
      </div>
      {children(id, describedBy)}
      {error ? (
        <p id={errorId} role="alert" className="flex items-center gap-1.5 text-[13px] text-[var(--stop)]">
          <Icon name="alert" size={13} />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[13px] text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  className,
  required,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(id, describedBy) => (
        <input
          id={id}
          className={cx(fieldBase, 'h-10', error && 'border-[color:var(--stop)]')}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          required={required}
          {...rest}
        />
      )}
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  error,
  className,
  required,
  rows = 4,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(id, describedBy) => (
        <textarea
          id={id}
          rows={rows}
          className={cx(
            fieldBase,
            'resize-y py-2 leading-relaxed',
            error && 'border-[color:var(--stop)]',
          )}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          required={required}
          {...rest}
        />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className,
  children,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, describedBy) => (
        <div className="relative">
          <select
            id={id}
            className={cx(fieldBase, 'h-10 appearance-none pr-7', error && 'border-[color:var(--stop)]')}
            aria-describedby={describedBy}
            {...rest}
          >
            {children}
          </select>
          <Icon
            name="chevron-down"
            size={15}
            className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-faint"
          />
        </div>
      )}
    </Field>
  );
}

export function Checkbox({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cx('flex gap-3', disabled && 'opacity-50')}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-[17px] w-[17px] shrink-0 cursor-pointer"
      />
      <label htmlFor={id} className="cursor-pointer select-none">
        <span className="block text-[14.5px] text-ink">{label}</span>
        {description ? <span className="block text-[13px] text-faint">{description}</span> : null}
      </label>
    </div>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cx('flex items-start justify-between gap-6', disabled && 'opacity-50')}>
      <label htmlFor={id} className="cursor-pointer select-none">
        <span className="block text-[14.5px] text-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[13px] leading-relaxed text-faint">{description}</span>
        ) : null}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-fast ease-out',
          checked ? 'bg-blue' : 'bg-rule-strong',
        )}
      >
        <span
          className={cx(
            'absolute top-[3px] h-4 w-4 rounded-full bg-white transition-transform duration-fast ease-spring',
            checked ? 'translate-x-[19px]' : 'translate-x-[3px]',
          )}
        />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections. A heading over a hairline, not a panel.
// ---------------------------------------------------------------------------

export function Section({
  eyebrow,
  title,
  description,
  action,
  children,
  className,
  as: Tag = 'h2',
  id,
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: 'h2' | 'h3';
  id?: string;
}) {
  return (
    <section id={id} className={cx('min-w-0', className)}>
      {title ? (
        <div className="mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-ink pb-3">
          <div className="min-w-0">
            {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
            <Tag className="text-[26px] md:text-[32px]">{title}</Tag>
            {description ? <p className="mt-2 text-[14.5px] text-faint">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0 pb-1">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A link that reads as a next step: label, then an arrow that nudges. */
export function MoreLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="group inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-blue"
    >
      <span className="underline decoration-blue-lighter decoration-1 underline-offset-4 transition-colors duration-fast group-hover:decoration-blue">
        {children}
      </span>
      <Icon
        name="arrow-right"
        size={14}
        className="transition-transform duration-fast ease-out group-hover:translate-x-0.5"
      />
    </Link>
  );
}

/** A labelled block inside a form or dashboard. Rule above, content below. */
export function Block({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('min-w-0 border-t border-rule pt-6', className)}>
      {title ? (
        <header className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            {/* A page-level grouping, so it is an h2 under the page heading. */}
            <h2 className="font-sans text-[15px] font-semibold tracking-[0.01em] text-ink">
              {title}
            </h2>
            {description ? <p className="mt-1 text-[13.5px] text-faint">{description}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Rule({ className }: { className?: string }) {
  return <hr className={cx('border-0 border-t border-rule', className)} />;
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  compact,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx('flex flex-col items-start gap-2.5', compact ? 'py-8' : 'py-16')}>
      <Icon name={icon} size={22} className="text-ghost" />
      <h3 className="font-sans text-[16px] font-semibold text-ink">{title}</h3>
      {description ? <p className="max-w-md text-[14.5px] leading-relaxed text-faint">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'That did not load',
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2.5 border-l-2 border-[color:var(--stop)] py-4 pl-5">
      <h3 className="font-sans text-[16px] font-semibold text-ink">{title}</h3>
      {description ? <p className="max-w-md text-[14.5px] leading-relaxed text-faint">{description}</p> : null}
      {onRetry ? (
        <Button icon="refresh" onClick={onRetry} size="sm" className="mt-1">
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('shimmer rounded-sm', className)} aria-hidden />;
}

/** Nothing renders for a moment, so a fast response never flashes a skeleton. */
export function DelayedSkeleton({ children, delay = 250 }: { children: ReactNode; delay?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  if (!show) return null;
  return <div className="animate-fade-in">{children}</div>;
}

export function Progress({ value, label }: { value: number | null; label?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={value ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-[3px] w-full overflow-hidden bg-rule"
    >
      {value === null ? (
        <div className="h-full w-1/3 bg-blue animate-[indeterminate_1.2s_ease-in-out_infinite]" />
      ) : (
        <div
          className="h-full bg-blue transition-[width] duration-normal ease-out"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPad = body.style.paddingRight;
    const barWidth = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (barWidth > 0) body.style.paddingRight = `${barWidth}px`;
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPad;
    };
  }, [active]);
}

/** Focus trap and Escape handling, shared by every overlay. */
function useOverlay(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;

    const preferred = node?.querySelector<HTMLElement>('[data-autofocus]');
    if (preferred) preferred.focus();
    else node?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const focusable = node.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  return ref;
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useOverlay(open, onClose);
  const titleId = useId();
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end md:items-center md:justify-center">
      <div className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[2px] animate-fade-in" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[88vh] w-full flex-col bg-lift shadow-high ring-1 ring-rule animate-sheet-up md:max-h-[82vh] md:max-w-lg md:rounded-lg md:animate-pop-in"
      >
        <header className="flex items-center justify-between gap-4 border-b border-rule px-5 py-4">
          <h2 id={titleId} className="font-sans text-[16px] font-semibold">
            {title}
          </h2>
          <IconButton icon="close" label="Close" size="sm" onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
        {footer ? (
          <footer className="border-t border-rule px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  /** Only a destructive confirmation is an alertdialog. */
  urgent,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  urgent?: boolean;
}) {
  const ref = useOverlay(open, onClose);
  const titleId = useId();
  const descriptionId = useId();
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[2px] animate-fade-in" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role={urgent ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="relative flex max-h-[88vh] w-full max-w-lg flex-col rounded-lg bg-lift p-6 shadow-high ring-1 ring-rule animate-pop-in"
      >
        <h2 id={titleId} className="text-[21px]">
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="mt-2 text-[14.5px] leading-relaxed text-faint">
            {description}
          </p>
        ) : null}
        {children ? <div className="mt-5 min-h-0 flex-1 overflow-y-auto">{children}</div> : null}
        {footer ? (
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      urgent
      footer={
        <>
          <Button onClick={onClose} disabled={loading} variant="quiet">
            Cancel
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
            data-autofocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<{
  toast: (message: string, tone?: Toast['tone'], action?: Toast['action']) => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: Toast['tone'] = 'info', action?: Toast['action']) => {
      const id = nextId.current++;
      setToasts((current) => {
        // Saving twice refreshes one message rather than stacking two.
        const withoutDuplicate = current.filter((t) => !(t.message === message && t.tone === tone));
        return [...withoutDuplicate.slice(-2), { id, message, tone, action }];
      });
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4200);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[130] flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded bg-ink px-4 py-3 text-on-ink shadow-high animate-toast-in',
              t.tone === 'error' && 'bg-[var(--stop)]',
            )}
          >
            <Icon
              name={t.tone === 'error' ? 'alert' : t.tone === 'success' ? 'check' : 'info'}
              size={16}
              className="shrink-0 opacity-80"
            />
            <span className="flex-1 text-[14px] leading-snug">{t.message}</span>
            {t.action ? (
              <button
                className="shrink-0 text-[13.5px] font-semibold underline underline-offset-2"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : null}
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="shrink-0 opacity-60 hover:opacity-100"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
