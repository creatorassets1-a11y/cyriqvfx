import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Button, cx } from './primitives';

/**
 * Modal surfaces.
 *
 * These are the only places in the interface that trap attention, so there are
 * exactly two of them: a dialog for work that needs room (adding a version,
 * say) and a confirmation for an action that cannot be undone. Both close on
 * Escape and on the backdrop, and both return focus where it came from.
 */

function useModalBehaviour(open: boolean, onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    // Focus lands inside the dialog, on the first thing that can take it.
    const focusable = panel.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? panel.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;

      // Keep Tab inside the dialog rather than letting it wander the page.
      const stops = Array.from(
        panel.current.querySelectorAll<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node) => node.offsetParent !== null);
      if (stops.length === 0) return;

      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = overflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  return panel;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panel = useModalBehaviour(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-[var(--scrim)] animate-fade"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden border border-line-strong bg-raised shadow-raise-high',
          'rounded-t-lg animate-sheet sm:rounded-lg sm:animate-pop',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <header className="flex items-start justify-between gap-6 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[19px]">{title}</h2>
            {description ? (
              <p className="mt-1 text-[13px] leading-relaxed text-text-3">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-0.5 shrink-0 p-1 text-text-3 hover:text-text"
          >
            <Icon name="close" size={17} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-2.5 border-t border-line px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A destructive action states what it will destroy and what that means. The
 * confirming button repeats the verb, so "OK" is never the last thing between
 * someone and a deletion.
 */
export function Confirm({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
}) {
  const panel = useModalBehaviour(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--scrim)] animate-fade" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-lg border border-line-strong bg-raised p-5 shadow-raise-high animate-pop"
      >
        <h2 className="text-[19px]">{title}</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-2">{body}</p>
        <div className="mt-6 flex justify-end gap-2.5">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
