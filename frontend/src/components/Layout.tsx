import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useDebounced, useDismissable, useFetch } from '../lib/hooks';
import { api, type NotificationItem, type ResourceCard } from '../lib/api';
import { formatRelative } from '../lib/format';
import { Icon, type IconName } from './Icon';
import { Wordmark } from './Logo';
import { Button, cx, IconButton, LinkButton, Sheet } from './ui';

/**
 * The frame.
 *
 * A masthead, a hairline, the page, a hairline, a colophon. Nothing here is
 * wrapped in a card: position and rules carry the structure. The only floating
 * surfaces are the three popovers, which float for real.
 */

const NAV = [
  { to: '/resources', label: 'Resources' },
  { to: '/categories', label: 'Categories' },
  { to: '/tutorials', label: 'Tutorials' },
  { to: '/updates', label: 'Updates' },
  { to: '/about', label: 'About' },
];

export function Header() {
  const { user, isAdmin, counts, settings } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();

  // Any navigation closes whatever was open.
  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [location.pathname]);

  const announcement = settings?.announcement;
  const siteName = settings?.siteName ?? 'Cyriq VFX';

  return (
    <>
      {announcement?.enabled && announcement.text ? (
        <div className="bg-navy text-white">
          <div className="page py-2 text-center text-[13px] tracking-[0.01em]">
            {announcement.href ? (
              <Link to={announcement.href} className="underline decoration-white/40 underline-offset-4 hover:decoration-white">
                {announcement.text}
              </Link>
            ) : (
              announcement.text
            )}
          </div>
        </div>
      ) : null}

      <header className="sticky top-0 z-50 border-b border-rule bg-paper/90 backdrop-blur-md">
        <div className="page flex h-[var(--bar)] items-center gap-4">
          <Wordmark name={siteName} size={30} hideNameUnder="max-[380px]:hidden" />

          <nav aria-label="Main" className="hidden shrink-0 items-center gap-6 lg:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cx(
                    'relative py-1 text-[14.5px] transition-colors duration-fast',
                    isActive ? 'text-ink' : 'text-faint hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {item.label}
                    <span
                      aria-hidden
                      className={cx(
                        'absolute -bottom-[3px] left-0 h-[2px] bg-blue transition-[width] duration-normal ease-out',
                        isActive ? 'w-full' : 'w-0',
                      )}
                    />
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          {/* The right group gives up width before the row can overflow. A fixed
              search box here pushed the page sideways at around 1024px, where
              the nav and the auth links are both present. */}
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1">
            <div className="hidden min-w-0 flex-1 md:block">
              <SearchBox />
            </div>
            <IconButton
              icon="search"
              label="Search"
              onClick={() => setSearchOpen(true)}
              className="md:hidden"
            />

            {user ? <NotificationBell unread={counts.unread} /> : null}

            {user ? (
              <AccountMenu isAdmin={isAdmin} />
            ) : (
              <div className="hidden shrink-0 items-center gap-4 pl-2 sm:flex">
                <Link
                  to="/login"
                  className="text-[14px] text-faint transition-colors duration-fast hover:text-ink"
                >
                  Sign in
                </Link>
                <LinkButton to="/register" variant="primary" size="sm">
                  Create account
                </LinkButton>
              </div>
            )}

            <IconButton
              icon="menu"
              label="Open menu"
              onClick={() => setMenuOpen(true)}
              className="lg:hidden"
            />
          </div>
        </div>
      </header>

      <Sheet open={searchOpen} onClose={() => setSearchOpen(false)} title="Search">
        <SearchBox autoFocus onNavigate={() => setSearchOpen(false)} />
      </Sheet>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <nav aria-label="Mobile" className="flex flex-col">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cx(
                  'flex items-center justify-between border-b border-rule py-3.5 font-display text-[19px] transition-colors duration-fast',
                  isActive ? 'text-blue' : 'text-ink hover:text-blue',
                )
              }
            >
              {item.label}
              <Icon name="chevron-right" size={16} className="text-ghost" />
            </NavLink>
          ))}
        </nav>

        {!user ? (
          <div className="mt-7 flex flex-col gap-3">
            <LinkButton to="/register" variant="primary" fullWidth>
              Create a free account
            </LinkButton>
            <LinkButton to="/login" fullWidth>
              Sign in
            </LinkButton>
            <p className="mt-1 text-center text-[12.5px] text-faint">
              You do not need an account to download.
            </p>
          </div>
        ) : (
          <div className="mt-6 flex flex-col">
            <MobileLink to="/account" icon="user">My library</MobileLink>
            <MobileLink to="/account/downloads" icon="history">Downloads</MobileLink>
            <MobileLink to="/account/saved" icon="bookmark">Saved</MobileLink>
            {isAdmin ? <MobileLink to="/admin" icon="shield">Admin</MobileLink> : null}
          </div>
        )}
      </Sheet>
    </>
  );
}

function MobileLink({ to, icon, children }: { to: string; icon: IconName; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 border-b border-rule py-3 text-[15px] text-soft transition-colors duration-fast hover:text-ink"
    >
      <Icon name={icon} size={17} className="text-ghost" />
      {children}
    </Link>
  );
}

/**
 * Search with suggestions (PRD §28). Debounced and abortable, so typing fast
 * never floods the API or shows a stale result.
 */
function SearchBox({
  autoFocus,
  onNavigate,
}: {
  autoFocus?: boolean;
  onNavigate?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(query, 220);
  const navigate = useNavigate();
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, loading } = useFetch<{
    resources: ResourceCard[];
    tutorials: Array<{ id: string; title: string; slug: string }>;
    categories: Array<{ id: string; name: string; slug: string }>;
    total: number;
  }>(debounced.trim().length >= 2 ? `/search?q=${encodeURIComponent(debounced.trim())}&limit=6&suggest=true` : null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const q = query.trim();
      if (!q) return;
      setOpen(false);
      onNavigate?.();
      navigate(`/resources?q=${encodeURIComponent(q)}`);
    },
    [query, navigate, onNavigate],
  );

  const go = (path: string) => {
    setOpen(false);
    setQuery('');
    onNavigate?.();
    navigate(path);
  };

  const hasResults = !!data && data.total > 0;

  return (
    <div
      className={cx('relative', autoFocus ? 'w-full' : 'ml-auto w-full min-w-0 max-w-[19rem]')}
      ref={ref}
    >
      <form onSubmit={submit} role="search">
        <label htmlFor="site-search" className="sr-only">
          Search resources and tutorials
        </label>
        {/* A ruled line, not a filled box. */}
        <div className="group relative flex items-center gap-2 border-b border-rule-strong pb-1.5 transition-colors duration-fast focus-within:border-blue hover:border-ink">
          <Icon name="search" size={15} className="shrink-0 text-ghost" />
          <input
            id="site-search"
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Search resources"
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className="w-full min-w-0 border-0 bg-transparent p-0 text-[14.5px] text-ink placeholder:text-ghost focus:outline-none focus:ring-0"
          />
        </div>
      </form>

      {open && debounced.trim().length >= 2 ? (
        <div
          className={cx(
            'z-40 bg-lift shadow-high ring-1 ring-rule',
            autoFocus ? 'mt-3' : 'absolute right-0 top-full mt-3 w-[min(27rem,90vw)] animate-pop-in',
          )}
        >
          {loading && !data ? (
            <p className="px-4 py-4 text-[13px] text-faint">Searching</p>
          ) : hasResults ? (
            <div className="max-h-[60vh] overflow-y-auto">
              {data!.resources.map((r) => (
                <button
                  key={r.id}
                  onClick={() => go(`/resources/${r.slug}`)}
                  className="flex w-full items-center gap-3 border-b border-rule px-4 py-2.5 text-left transition-colors duration-fast hover:bg-sunk"
                >
                  <span className="well h-9 w-14 shrink-0">
                    {r.thumbnailUrl ? <img src={r.thumbnailUrl} alt="" loading="lazy" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-ink">{r.title}</span>
                    <span className="block truncate text-[12px] text-faint">{r.category.name}</span>
                  </span>
                </button>
              ))}
              {data!.tutorials.map((t) => (
                <button
                  key={t.id}
                  onClick={() => go(`/tutorials/${t.slug}`)}
                  className="flex w-full items-center gap-3 border-b border-rule px-4 py-2.5 text-left transition-colors duration-fast hover:bg-sunk"
                >
                  <span className="grid h-9 w-14 shrink-0 place-items-center bg-sunk text-ghost">
                    <Icon name="play" size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-ink">{t.title}</span>
                    <span className="block text-[12px] text-faint">Tutorial</span>
                  </span>
                </button>
              ))}
              <button
                onClick={() => go(`/resources?q=${encodeURIComponent(query.trim())}`)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-semibold text-blue transition-colors duration-fast hover:bg-sunk"
              >
                See all results for “{query.trim()}”
                <Icon name="arrow-right" size={14} />
              </button>
            </div>
          ) : (
            <p className="px-4 py-4 text-[13px] text-faint">
              Nothing matched “{debounced.trim()}”. Try a broader keyword.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Notification centre (PRD §21). */
function NotificationBell({ unread }: { unread: number }) {
  const [open, setOpen] = useState(false);
  const { setUnread } = useAuth();
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  const { data, loading, reload } = useFetch<{ items: NotificationItem[]; unread: number }>(
    open ? '/me/notifications?perPage=8' : null,
  );

  const markAll = async () => {
    await api.post('/me/notifications/read-all').catch(() => {});
    setUnread(0);
    reload();
  };

  const openOne = async (n: NotificationItem) => {
    if (!n.read) {
      await api.post(`/me/notifications/${n.id}/read`).catch(() => {});
      setUnread(Math.max(0, unread - 1));
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <IconButton
        icon="bell"
        label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      />
      {unread > 0 ? (
        <span
          aria-hidden
          className="pointer-events-none absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-blue px-1 text-[10px] font-bold text-on-ink"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}

      {open ? (
        <div className="absolute right-0 top-full z-40 mt-3 w-[min(23rem,92vw)] bg-lift shadow-high ring-1 ring-rule animate-pop-in">
          <header className="flex items-center justify-between border-b border-rule px-4 py-3">
            <h2 className="eyebrow">Notifications</h2>
            {unread > 0 ? (
              <button onClick={markAll} className="link text-[12.5px]">
                Mark all read
              </button>
            ) : null}
          </header>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading && !data ? (
              <p className="px-4 py-5 text-[13px] text-faint">Loading</p>
            ) : data && data.items.length > 0 ? (
              data.items.map((n) => (
                <Link
                  key={n.id}
                  to={n.link}
                  onClick={() => openOne(n)}
                  className="flex gap-3 border-b border-rule px-4 py-3 last:border-0 transition-colors duration-fast hover:bg-sunk"
                >
                  <span
                    className={cx(
                      'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      n.read ? 'bg-transparent' : 'bg-blue',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium leading-snug text-ink">{n.title}</span>
                    <span className="mt-0.5 block line-clamp-2 text-[12.5px] leading-snug text-soft">
                      {n.body}
                    </span>
                    <span className="mt-1 block font-mono text-[11px] text-ghost">
                      {formatRelative(n.createdAt)}
                    </span>
                  </span>
                </Link>
              ))
            ) : (
              <p className="px-4 py-6 text-[13px] text-faint">
                Nothing yet. New resources and updates will show up here.
              </p>
            )}
          </div>

          <Link
            to="/account/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-rule px-4 py-3 text-[13px] text-blue hover:bg-sunk"
          >
            All notifications
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function AccountMenu({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-navy font-display text-[15px] uppercase leading-none text-white transition-opacity duration-fast hover:opacity-85"
      >
        {user?.displayName?.[0] ?? user?.username?.[0] ?? '?'}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-3 w-60 bg-lift shadow-high ring-1 ring-rule animate-pop-in"
        >
          <div className="border-b border-rule px-4 py-3">
            <p className="truncate text-[13.5px] font-semibold text-ink">{user?.displayName}</p>
            <p className="truncate text-[12px] text-faint">{user?.email}</p>
          </div>
          <MenuLink to="/account" icon="user" onClick={() => setOpen(false)}>My library</MenuLink>
          <MenuLink to="/account/downloads" icon="history" onClick={() => setOpen(false)}>Downloads</MenuLink>
          <MenuLink to="/account/saved" icon="bookmark" onClick={() => setOpen(false)}>Saved</MenuLink>
          <MenuLink to="/account/preferences" icon="settings" onClick={() => setOpen(false)}>Preferences</MenuLink>
          {isAdmin ? (
            <div className="border-t border-rule">
              <MenuLink to="/admin" icon="shield" onClick={() => setOpen(false)}>Admin</MenuLink>
            </div>
          ) : null}
          <div className="border-t border-rule">
            <button
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                await logout();
                navigate('/');
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13.5px] text-soft transition-colors duration-fast hover:bg-sunk hover:text-ink"
            >
              <Icon name="logout" size={15} className="text-ghost" />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  to,
  icon,
  children,
  onClick,
}: {
  to: string;
  icon: IconName;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      role="menuitem"
      to={to}
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-2.5 text-[13.5px] text-soft transition-colors duration-fast hover:bg-sunk hover:text-ink"
    >
      <Icon name={icon} size={15} className="text-ghost" />
      {children}
    </Link>
  );
}

export function Footer() {
  const { settings } = useAuth();
  const social = settings?.social;
  const links: Array<[string, string]> = [
    ['YouTube', social?.youtube ?? ''],
    ['Instagram', social?.instagram ?? ''],
    ['TikTok', social?.tiktok ?? ''],
    ['X', social?.x ?? ''],
    ['Discord', social?.discord ?? ''],
  ];
  const active = links.filter(([, href]) => href);
  const siteName = settings?.siteName ?? 'Cyriq VFX';

  return (
    <footer className="border-t border-rule">
      <div className="page grid gap-10 py-14 md:grid-cols-[1.6fr_1fr_1fr]">
        <div className="min-w-0">
          <Wordmark name={siteName} size={34} />
          <p className="copy mt-4 max-w-[38ch] text-[14.5px]">
            {settings?.tagline ?? 'Free resources for video editors.'} No account is needed to
            download, and every license is written in plain language.
          </p>
          {active.length > 0 ? (
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
              {active.map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer me"
                  className="link text-[13.5px]"
                >
                  {label}
                </a>
              ))}
            </div>
          ) : null}
        </div>

        <FooterColumn
          title="Browse"
          links={[
            ['Resources', '/resources'],
            ['Categories', '/categories'],
            ['Tutorials', '/tutorials'],
            ['Updates', '/updates'],
          ]}
        />
        <FooterColumn
          title="More"
          links={[
            ['About', '/about'],
            ['Requests', '/requests'],
            ['Report a problem', '/report'],
            ...(settings?.contactEmail
              ? ([['Contact', `mailto:${settings.contactEmail}`]] as Array<[string, string]>)
              : []),
          ]}
        />
      </div>

      <div className="page flex flex-col gap-2 border-t border-rule py-6 text-[12.5px] text-faint sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {new Date().getFullYear()} {settings?.creatorName ?? 'Cyriq'}
        </p>
        {/* The owner's own line, set in settings. Nothing is invented here. */}
        {settings?.footerNote ? <p>{settings.footerNote}</p> : null}
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div className="min-w-0">
      <h2 className="eyebrow mb-4">{title}</h2>
      <ul className="flex flex-col gap-2.5">
        {links.map(([label, href]) => (
          <li key={label}>
            {href.startsWith('/') ? (
              <Link to={href} className="text-[14px] text-soft transition-colors duration-fast hover:text-blue">
                {label}
              </Link>
            ) : (
              <a href={href} className="text-[14px] text-soft transition-colors duration-fast hover:text-blue">
                {label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Restores scroll position sensibly on navigation. */
export function ScrollReset() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname, search]);
  return null;
}

export function PageError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="page py-24">
      <div className="max-w-lg border-l-2 border-[color:var(--stop)] pl-6">
        <p className="eyebrow text-[color:var(--stop)]">Error</p>
        <h1 className="mt-2 text-[30px]">That did not load</h1>
        <p className="copy mt-3">
          Something went wrong on our end. Your connection may also have dropped.
        </p>
        {onRetry ? (
          <Button icon="refresh" onClick={onRetry} className="mt-5">
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
