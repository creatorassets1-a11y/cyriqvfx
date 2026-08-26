import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, type SiteSettings, type User } from './api';

interface MeResponse {
  user: User;
  counts: { downloads: number; saved: number; unread: number };
  emailVerified: boolean;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  counts: { downloads: number; saved: number; unread: number };
  settings: SiteSettings | null;
  isAdmin: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    username: string;
    password: string;
    confirmPassword: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUnread: (n: number) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const EMPTY_COUNTS = { downloads: 0, saved: 0, unread: 0 };

/**
 * The server embeds the owner's settings in the shell, so the first render can
 * use the real headline instead of a built-in placeholder that a later fetch
 * would replace. Missing (the Vite dev server, or a shell served by something
 * else) simply means the settings arrive with the first fetch as before.
 */
function bootstrappedSettings(): SiteSettings | null {
  if (typeof document === 'undefined') return null;
  const node = document.getElementById('site-settings');
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as SiteSettings;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [settings, setSettings] = useState<SiteSettings | null>(bootstrappedSettings);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<MeResponse>('/me');
      setUser(me.user);
      setCounts(me.counts);
    } catch (err) {
      // 401 is the normal state for a guest, not an error worth surfacing.
      if (!(err instanceof ApiError) || err.status !== 401) {
        // Anything else (offline, 500) still leaves the site browsable.
      }
      setUser(null);
      setCounts(EMPTY_COUNTS);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Site settings and identity load together so the shell renders once.
    Promise.all([
      api.get<{ settings: SiteSettings }>('/site').catch(() => null),
      api.get<MeResponse>('/me').catch(() => null),
    ]).then(([site, me]) => {
      if (cancelled) return;
      if (site) setSettings(site.settings);
      if (me) {
        setUser(me.user);
        setCounts(me.counts);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await api.post<{ user: User }>('/auth/login', { identifier, password });
      setUser(res.user);
      await refresh();
    },
    [refresh],
  );

  const register = useCallback(
    async (input: { email: string; username: string; password: string; confirmPassword: string }) => {
      const res = await api.post<{ user: User }>('/auth/register', input);
      setUser(res.user);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
    setCounts(EMPTY_COUNTS);
  }, []);

  const setUnread = useCallback((n: number) => {
    setCounts((c) => ({ ...c, unread: n }));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      counts,
      settings,
      isAdmin: user?.role === 'ADMIN',
      login,
      register,
      logout,
      refresh,
      setUnread,
    }),
    [user, loading, counts, settings, login, register, logout, refresh, setUnread],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
