import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { useDismiss } from '../lib/hooks';
import { Icon } from '../ui/Icon';
import { Button, ButtonLink, cx } from '../ui/primitives';
import { Menu, MenuButton, MenuHeading, MenuLink, MenuRule } from '../ui/Menu';
import { Brand } from './Brand';

/**
 * The masthead, the colophon, and the two behaviours that belong to the shell
 * rather than to any one page: resetting scroll on navigation, and showing a
 * page-level failure without blanking the site.
 */

const NAV = [
  { to: '/resources', label: 'Resources' },
  { to: '/tutorials', label: 'Tutorials' },
  { to: '/categories', label: 'Categories' },
  { to: '/updates', label: 'Updates' },
  { to: '/about', label: 'About' },
];

export function Masthead() {
  const { user, isAdmin, counts, settings } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm] = useState('');

  const siteName = settings?.siteName ?? 'Cyriq VFX';
  const announcement = settings?.announcement;

  // Any navigation closes whatever was open over the page.
  useEffect(() => {
    setSheetOpen(false);
    setSearchOpen(false);
  }, [location.pathname, location.search]);

  const searchRef = useDismiss<HTMLDivElement>(searchOpen, () => setSearchOpen(false));

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const query = term.trim();
    navigate(query ? `/resources?q=${encodeURIComponent(query)}` : '/resources');
    setTerm('');
    setSearchOpen(false);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-ground/95 backdrop-blur">
      {announcement?.enabled && announcement.text ? (
        <div className="border-b border-line bg-accent-wash">
          <div className="page flex items-center justify-center gap-2 py-1.5 text-center text-[12.5px] text-accent">
            <Icon name="sparkle" size={13} className="shrink-0" />
            {announcement.href ? (
              <Link to={announcement.href} className="underlined">
                {announcement.text}
              </Link>
            ) : (
              <span>{announcement.text}</span>
            )}
          </div>
        </div>
      ) : null}

      <div className="page flex h-[var(--masthead)] items-center gap-4">
        <Brand name={siteName} />

        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cx(
                  'rounded px-3 py-2 text-[14px] transition-colors duration-fast ease-out',
                  isActive ? 'text-text' : 'text-text-3 hover:text-text',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <div className="relative" ref={searchRef}>
            <button
              type="button"
              aria-label="Search the library"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((open) => !open)}
              className="flex h-10 w-10 items-center justify-center rounded text-text-3 transition-colors duration-fast ease-out hover:text-text"
            >
              <Icon name="search" size={18} />
            </button>

            {searchOpen ? (
              <form
                onSubmit={submitSearch}
                className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-line-strong bg-raised p-2 shadow-raise animate-pop"
              >
                <label htmlFor="masthead-search" className="sr-only">
                  Search the library
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="masthead-search"
                    autoFocus
                    value={term}
                    onChange={(event) => setTerm(event.target.value)}
                    placeholder="Scene packs, LUTs, presets…"
                    className="h-9 w-full rounded border border-line-strong bg-inset px-3 text-[14px] placeholder:text-text-4 focus:border-accent"
                  />
                  <Button type="submit" size="sm" variant="primary">
                    Go
                  </Button>
                </div>
              </form>
            ) : null}
          </div>

          {user ? (
            <>
              <Link
                to="/account/notifications"
                aria-label={
                  counts.unread > 0 ? `Notifications, ${counts.unread} unread` : 'Notifications'
                }
                className="relative flex h-10 w-10 items-center justify-center rounded text-text-3 transition-colors duration-fast ease-out hover:text-text"
              >
                <Icon name="bell" size={18} />
                {counts.unread > 0 ? (
                  <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent" />
                ) : null}
              </Link>

              <Menu
                label="Account menu"
                trigger={() => (
                  <span className="flex h-9 items-center gap-2 rounded-full border border-line-strong px-2.5 text-[13px]">
                    <Icon name="user" size={15} />
                    <span className="hidden max-w-[10ch] truncate lg:block">{user.displayName}</span>
                  </span>
                )}
              >
                {({ close }) => (
                  <>
                    <MenuHeading>Signed in as {user.username}</MenuHeading>
                    <MenuLink to="/account" icon="grid" onSelect={close}>
                      My library
                    </MenuLink>
                    <MenuLink to="/account/downloads" icon="download" onSelect={close}>
                      Downloads
                    </MenuLink>
                    <MenuLink to="/account/saved" icon="bookmark" onSelect={close}>
                      Saved
                    </MenuLink>
                    <MenuLink
                      to="/account/notifications"
                      icon="bell"
                      onSelect={close}
                      badge={counts.unread}
                    >
                      Notifications
                    </MenuLink>
                    <MenuLink to="/account/preferences" icon="settings" onSelect={close}>
                      Preferences
                    </MenuLink>
                    {isAdmin ? (
                      <>
                        <MenuRule />
                        <MenuLink to="/admin" icon="sliders" onSelect={close}>
                          Owner tools
                        </MenuLink>
                      </>
                    ) : null}
                    <MenuRule />
                    <SignOutItem onDone={close} />
                  </>
                )}
              </Menu>
            </>
          ) : (
            <div className="hidden items-center gap-2 lg:flex">
              <Link
                to="/login"
                className="rounded px-3 py-2 text-[14px] text-text-3 transition-colors duration-fast ease-out hover:text-text"
              >
                Sign in
              </Link>
              <ButtonLink to="/register" size="sm" variant="secondary">
                Create account
              </ButtonLink>
            </div>
          )}

          <button
            type="button"
            aria-label="Menu"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded text-text-3 transition-colors duration-fast ease-out hover:text-text lg:hidden"
          >
            <Icon name="menu" size={20} />
          </button>
        </div>
      </div>

      {sheetOpen ? <NavSheet onClose={() => setSheetOpen(false)} /> : null}
    </header>
  );
}

function SignOutItem({ onDone }: { onDone: () => void }) {
  const { signOut } = useSession();
  const navigate = useNavigate();

  return (
    <MenuButton
      icon="sign-out"
      onSelect={async () => {
        await signOut();
        onDone();
        navigate('/');
      }}
    >
      Sign out
    </MenuButton>
  );
}

/** The phone menu. Full height, one column, big targets. */
function NavSheet({ onClose }: { onClose: () => void }) {
  const { user } = useSession();
  const ref = useDismiss<HTMLDivElement>(true, onClose);

  return (
    <div className="fixed inset-0 z-[90] lg:hidden">
      <div className="absolute inset-0 bg-[var(--scrim)] animate-fade" aria-hidden="true" />
      <div
        ref={ref}
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-lg border-t border-line-strong bg-raised pb-[max(1.5rem,env(safe-area-inset-bottom))] animate-sheet"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <p className="kicker">Menu</p>
          <button type="button" onClick={onClose} aria-label="Close menu" className="p-1 text-text-3">
            <Icon name="close" size={18} />
          </button>
        </div>

        <nav aria-label="Site" className="flex flex-col px-2 py-2">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={onClose}
              className="rounded px-3 py-3 text-[16px] text-text-2 hover:bg-raised-hover hover:text-text"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {user ? null : (
          <div className="flex flex-col gap-2.5 border-t border-line px-5 pt-4">
            <ButtonLink to="/login" block>
              Sign in
            </ButtonLink>
            <ButtonLink to="/register" variant="primary" block>
              Create account
            </ButtonLink>
          </div>
        )}
      </div>
    </div>
  );
}

const SOCIAL: Array<{ key: 'youtube' | 'instagram' | 'tiktok' | 'x' | 'discord'; label: string }> = [
  { key: 'youtube', label: 'YouTube' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'x', label: 'X' },
  { key: 'discord', label: 'Discord' },
];

export function Colophon() {
  const { settings } = useSession();
  const siteName = settings?.siteName ?? 'Cyriq VFX';
  const social = SOCIAL.filter((item) => settings?.social?.[item.key]);

  return (
    <footer className="border-t border-line">
      <div className="page grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr] md:py-16">
        <div>
          <Brand name={siteName} as="plain" />
          <p className="mt-3 max-w-xs text-[13.5px] leading-relaxed text-text-3">
            {settings?.tagline ?? 'Free resources and tutorials for video editors.'}
          </p>
          {social.length ? (
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
              {social.map((item) => (
                <li key={item.key}>
                  <a
                    href={settings!.social[item.key]}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[13px] text-text-3 hover:text-text"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <FooterColumn
          title="Library"
          links={[
            { to: '/resources', label: 'All resources' },
            { to: '/categories', label: 'Categories' },
            { to: '/tutorials', label: 'Tutorials' },
            { to: '/updates', label: 'Updates' },
          ]}
        />

        <FooterColumn
          title="This site"
          links={[
            { to: '/about', label: 'About' },
            { to: '/requests', label: 'Request a resource' },
            { to: '/report', label: 'Report a problem' },
          ]}
        />
      </div>

      <div className="page flex flex-wrap items-center justify-between gap-3 border-t border-line py-5">
        <p className="text-[12.5px] text-text-4">
          {settings?.footerNote ?? `© ${new Date().getFullYear()} ${siteName}.`}
        </p>
        {settings?.contactEmail ? (
          <a href={`mailto:${settings.contactEmail}`} className="text-[12.5px] text-text-4 hover:text-text">
            {settings.contactEmail}
          </a>
        ) : null}
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ to: string; label: string }>;
}) {
  return (
    <div>
      <p className="kicker">{title}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.to}>
            <Link to={link.to} className="text-[13.5px] text-text-2 hover:text-text">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Puts a new page at the top, the way a full page load would. */
export function ScrollReset() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

/**
 * What a page shows when its data could not be loaded: what happened, and the
 * one action that might fix it. Never a blank page.
 */
export function PageError({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <div className="page flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <Icon name="alert" size={24} className="text-caution" />
      <h1 className="text-[24px]">That did not load</h1>
      <p className="max-w-sm text-[14px] leading-relaxed text-text-3">
        {message ?? 'Something went wrong on the way to the server. It is usually temporary.'}
      </p>
      <Button variant="primary" icon="refresh" onClick={onRetry} className="mt-2">
        Try again
      </Button>
    </div>
  );
}
