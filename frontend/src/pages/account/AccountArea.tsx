import { NavLink, Route, Routes } from 'react-router-dom';
import { useSession } from '../../lib/session';
import { cx } from '../../ui/primitives';
import NotFound from '../NotFound';
import Overview from './Overview';
import Downloads from './Downloads';
import Saved from './Saved';
import Notifications from './Notifications';
import Preferences from './Preferences';
import Profile from './Profile';

/**
 * The account area.
 *
 * Five screens behind one nav. Everything here is a convenience on top of a
 * site that works without it, so nothing in this area is ever in the way of
 * downloading something.
 */

const TABS = [
  { to: '/account', label: 'My library', end: true },
  { to: '/account/downloads', label: 'Downloads' },
  { to: '/account/saved', label: 'Saved' },
  { to: '/account/notifications', label: 'Notifications' },
  { to: '/account/preferences', label: 'Preferences' },
  { to: '/account/profile', label: 'Profile' },
];

export default function AccountArea() {
  const { counts } = useSession();

  return (
    <div className="page py-8 md:py-12">
      <nav aria-label="Account" className="swipe mb-9 flex gap-6 border-b border-line">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cx(
                '-mb-px shrink-0 border-b-2 pb-3 text-[14px] transition-colors duration-fast ease-out',
                isActive
                  ? 'border-accent text-text'
                  : 'border-transparent text-text-3 hover:text-text',
              )
            }
          >
            {tab.label}
            {tab.to === '/account/notifications' && counts.unread > 0 ? (
              <span className="ml-2 font-mono text-[11.5px] text-accent">{counts.unread}</span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<Overview />} />
        <Route path="downloads" element={<Downloads />} />
        <Route path="saved" element={<Saved />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="preferences" element={<Preferences />} />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  );
}
