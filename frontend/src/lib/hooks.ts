import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { api, ApiError } from './api';

/**
 * The small set of hooks the whole app is built on. There is no data-fetching
 * library here on purpose: a request that cancels itself and reports its own
 * failure is the entire requirement, and it costs a few lines rather than a
 * few tens of kilobytes on a phone.
 */

export interface Loadable<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** Re-runs the request, keeping whatever is on screen until it lands. */
  reload: () => void;
  /** Replaces the loaded value locally, for an optimistic update. */
  set: (value: T) => void;
}

/**
 * Loads a path and keeps it in step with its inputs. Every request is aborted
 * when the path changes or the component unmounts, so a fast typist never sees
 * results from a query they have already replaced.
 *
 * Passing null for the path means "nothing to load yet", which is how the
 * conditional cases (a slug that has not resolved, a panel that is closed)
 * avoid a request they would only throw away.
 */
export function useLoad<T>(path: string | null): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (path === null) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    api
      .get<T>(path, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return;
        setError(
          err instanceof ApiError ? err : new ApiError(0, 'error', 'Something went wrong.'),
        );
        setLoading(false);
      });

    return () => controller.abort();
  }, [path, attempt]);

  return {
    data,
    error,
    loading,
    reload: useCallback(() => setAttempt((n) => n + 1), []),
    set: useCallback((value: T) => setData(value), []),
  };
}

/** Holds a value still until it stops changing. Search types into this. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}

export function useMediaQuery(queryText: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(queryText).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(queryText);
    const sync = () => setMatches(list.matches);
    sync();
    list.addEventListener('change', sync);
    return () => list.removeEventListener('change', sync);
  }, [queryText]);

  return matches;
}

export const useIsDesktop = () => useMediaQuery('(min-width: 768px)');
export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

/**
 * Closes a menu, popover or sheet on Escape or on a click outside it. Returns
 * the ref to put on the thing that should stay open when it is clicked.
 */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void): RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;

    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return ref;
}

/**
 * True once an element has come near the viewport. Heavy media below the fold
 * waits on this, which is what keeps the first paint cheap without leaving a
 * hole where the media will land.
 */
export function useNearViewport<T extends HTMLElement>(margin = '200px'): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;

    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, margin]);

  return [ref, near];
}

/** Tracks whether an element has scrolled up out of view. */
export function useScrolledPast<T extends HTMLElement>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [past, setPast] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, past];
}

/** Copies text and reports back for two seconds, for a "Copied" label. */
export function useCopy(): [boolean, (text: string) => Promise<boolean>] {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // An insecure origin or an older browser has no Clipboard API at all.
      const field = document.createElement('textarea');
      field.value = text;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(field);
      if (!ok) return false;
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    return true;
  }, []);

  return [copied, copy];
}

/**
 * Sets the document title on a client-side navigation. The first paint already
 * carries the right title, because the server puts it in the shell.
 */
export function useTitle(title: string | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
