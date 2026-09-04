import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cx } from './primitives';

/**
 * Short confirmations and failures.
 *
 * A toast says what happened and then leaves. It never carries the only copy
 * of something a person needs (an error that must be acted on is written into
 * the page next to the control that caused it), and it never blocks anything.
 */

type ToastTone = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

const LIFETIME = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), LIFETIME);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[120] flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        role="status"
        aria-live="polite"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            className={cx(
              'pointer-events-auto flex max-w-[min(30rem,100%)] items-start gap-2.5 rounded border bg-raised px-4 py-3 shadow-raise animate-toast',
              item.tone === 'error'
                ? 'border-critical/50'
                : item.tone === 'success'
                  ? 'border-positive/50'
                  : 'border-line-strong',
            )}
          >
            <Icon
              name={item.tone === 'error' ? 'alert' : item.tone === 'success' ? 'check' : 'info'}
              size={15}
              className={cx(
                'mt-0.5 shrink-0',
                item.tone === 'error'
                  ? 'text-critical'
                  : item.tone === 'success'
                    ? 'text-positive'
                    : 'text-accent',
              )}
            />
            <p className="text-[13.5px] leading-relaxed text-text">{item.message}</p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setToasts((current) => current.filter((t) => t.id !== item.id))}
              className="-mr-1 mt-0.5 shrink-0 text-text-4 hover:text-text"
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside a ToastProvider');
  return value;
}
