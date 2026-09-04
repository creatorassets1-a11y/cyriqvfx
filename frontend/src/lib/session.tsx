import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from './api';
import type { SiteSettings, User } from './types';

/**
 * Who is here, and what the owner has called things.
 *
 * Identity and site settings load together, because the shell renders once and
 * both answers are needed for that render. The settings usually do not need
 * loading at all: the server embeds them in the HTML, so the first paint
 * already carries the owner's real headline instead of a placeholder that a
 * later fetch would swap out from under the reader.
 */

interface Counts {
  downloads: number;
  saved: number;
  unread: number;
}

interface MePayload {
  user: User | null;
  counts: Counts;
  emailVerified: boolean;
}

interface SessionValue {
  user: User | null;
  /** True until identity has been resolved one way or the other. */
  loading: boolean;
  isAdmin: boolean;
  emailVerified: boolean;
  counts: Counts;
  settings: SiteSettings | null;
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (input: {
    email: string;
    username: string;
    password: string;
    confirmPassword: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setUnread: (unread: number) => void;
}

const NO_COUNTS: Counts = { downloads: 0, saved: 0, unread: 0 };

const SessionContext = createContext<SessionValue | null>(null);

/** Reads the settings the server wrote into the shell, if they are there. */
function settingsFromShell(): SiteSettings | null {
  if (typeof document === 'undefined') return null;
  const node = document.getElementById('site-settings');
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as SiteSettings;
  } catch {
    // A malformed bootstrap is not worth a blank page; the fetch will cover it.
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [counts, setCounts] = useState<Counts>(NO_COUNTS);
  const [emailVerified, setEmailVerified] = useState(false);
  const [settings, setSettings] = useState<SiteSettings | null>(settingsFromShell);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((me: MePayload | null) => {
    setUser(me?.user ?? null);
    setCounts(me?.counts ?? NO_COUNTS);
    setEmailVerified(me?.emailVerified ?? false);
  }, []);

  const refresh = useCallback(async () => {
    // A 401 is the ordinary state for a guest, not a failure to report.
    const me = await api.get<MePayload>('/me').catch((err: unknown) => {
      if (err instanceof ApiError) return null;
      throw err;
    });
    apply(me);
  }, [apply]);

  useEffect(() => {
    let live = true;

    Promise.all([
      settings ? Promise.resolve(null) : api.get<{ settings: SiteSettings }>('/site').catch(() => null),
      api.get<MePayload>('/me').catch(() => null),
    ]).then(([site, me]) => {
      if (!live) return;
      if (site) setSettings(site.settings);
      apply(me);
      setLoading(false);
    });

    return () => {
      live = false;
    };
    // Settings are read once at mount; a later change arrives with a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply]);

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      await api.post<{ user: User }>('/auth/login', { identifier, password });
      await refresh();
    },
    [refresh],
  );

  const signUp = useCallback(
    async (input: {
      email: string;
      username: string;
      password: string;
      confirmPassword: string;
    }) => {
      await api.post<{ user: User }>('/auth/register', input);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    apply(null);
  }, [apply]);

  const setUnread = useCallback((unread: number) => {
    setCounts((current) => ({ ...current, unread }));
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      loading,
      isAdmin: user?.role === 'ADMIN',
      emailVerified,
      counts,
      settings,
      signIn,
      signUp,
      signOut,
      refresh,
      setUnread,
    }),
    [user, loading, emailVerified, counts, settings, signIn, signUp, signOut, refresh, setUnread],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}
