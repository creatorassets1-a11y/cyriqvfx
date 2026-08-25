import { lazy, Suspense } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { cx, Skeleton } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { useTitle } from '../../lib/hooks';
import Overview from './Overview';

const Downloads = lazy(() => import('./Downloads'));
const Saved = lazy(() => import('./Saved'));
const Notifications = lazy(() => import('./Notifications'));
const Preferences = lazy(() => import('./Preferences'));
const Profile = lazy(() => import('./Profile'));

const TABS: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: '/account', label: 'Overview', icon: 'grid', end: true },
  { to: '/account/downloads', label: 'Downloads', icon: 'history' },
  { to: '/account/saved', label: 'Saved', icon: 'bookmark' },
  { to: '/account/notifications', label: 'Notifications', icon: 'bell' },
  { to: '/account/preferences', label: 'Preferences', icon: 'settings' },
  { to: '/account/profile', label: 'Profile', icon: 'user' },
];

/** Personal library (PRD §18). Deliberately small. No vanity widgets. */
export default function Account() {
  const { user, counts } = useAuth();
  useTitle('My library · Cyriq VFX');

  return (
    <div className="page py-10 md:py-14">
      <header className="border-b border-ink pb-4">
        <p className="eyebrow">Your account</p>
        <h1 className="mt-2 text-[34px] leading-[1.05] md:text-[44px]">My library</h1>
        <p className="mt-3 text-[14px] text-faint">
          Signed in as {user?.displayName}
          {!user?.emailVerifiedAt ? ', email not confirmed' : ''}
        </p>
      </header>

      <div className="mt-8 grid min-w-0 gap-8 md:grid-cols-[190px_1fr] md:gap-12">
        {/* Horizontal scroll on mobile, vertical rail on desktop */}
        <nav aria-label="Account sections" className="min-w-0">
          <div className="scroll-x no-bar -mx-[var(--gutter)] flex gap-6 px-[var(--gutter)] pb-2 md:mx-0 md:flex-col md:gap-0 md:px-0 md:pb-0">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cx(
                    'flex shrink-0 items-center gap-2.5 text-[14px] transition-colors duration-fast md:border-b md:border-rule md:py-3',
                    isActive ? 'text-blue' : 'text-faint hover:text-ink',
                  )
                }
              >
                <Icon name={tab.icon} size={16} />
                {tab.label}
                {tab.to === '/account/notifications' && counts.unread > 0 ? (
                  <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-blue px-1 text-[11px] font-bold text-on-ink">
                    {counts.unread}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="min-w-0">
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <Routes>
              <Route index element={<Overview />} />
              <Route path="downloads" element={<Downloads />} />
              <Route path="saved" element={<Saved />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="preferences" element={<Preferences />} />
              <Route path="profile" element={<Profile />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </div>
  );
}
