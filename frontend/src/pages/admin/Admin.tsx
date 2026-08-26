import { lazy, Suspense } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { cx, Skeleton } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { useTitle } from '../../lib/hooks';
import Dashboard from './Dashboard';

const ResourcesAdmin = lazy(() => import('./ResourcesAdmin'));
const ResourceEditor = lazy(() => import('./ResourceEditor'));
const TaxonomyAdmin = lazy(() => import('./TaxonomyAdmin'));
const TutorialsAdmin = lazy(() => import('./TutorialsAdmin'));
const TutorialEditor = lazy(() => import('./TutorialEditor'));
const UsersAdmin = lazy(() => import('./UsersAdmin'));
const AnalyticsAdmin = lazy(() => import('./AnalyticsAdmin'));
const ReportsAdmin = lazy(() => import('./ReportsAdmin'));
const ChangelogAdmin = lazy(() => import('./ChangelogAdmin'));
const SettingsAdmin = lazy(() => import('./SettingsAdmin'));
const AuditAdmin = lazy(() => import('./AuditAdmin'));

const NAV: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: '/admin', label: 'Dashboard', icon: 'grid', end: true },
  { to: '/admin/resources', label: 'Resources', icon: 'file' },
  { to: '/admin/taxonomy', label: 'Categories', icon: 'folder' },
  { to: '/admin/tutorials', label: 'Tutorials', icon: 'play' },
  { to: '/admin/changelog', label: 'Updates', icon: 'history' },
  { to: '/admin/users', label: 'Users', icon: 'users' },
  { to: '/admin/analytics', label: 'Analytics', icon: 'chart' },
  { to: '/admin/reports', label: 'Reports', icon: 'flag' },
  { to: '/admin/settings', label: 'Settings', icon: 'settings' },
  { to: '/admin/audit', label: 'Audit log', icon: 'shield' },
];

/** Admin shell (PRD §41). Fast sidebar on desktop, drawer on mobile. */
export default function Admin() {
  useTitle('Admin · Cyriq VFX');

  return (
    <div className="page py-8 md:py-12">
      <div className="grid gap-8 lg:grid-cols-[186px_1fr] lg:gap-12">
        <aside className="min-w-0 lg:sticky lg:top-[calc(var(--bar)+1.5rem)] lg:self-start lg:border-r lg:border-rule lg:pr-8">
          {/* Mobile: a horizontal rail keeps primary actions one tap away */}
          <div className="scroll-x no-bar -mx-[var(--gutter)] flex gap-6 px-[var(--gutter)] pb-2 lg:mx-0 lg:flex-col lg:gap-0 lg:px-0 lg:pb-0">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'flex shrink-0 items-center gap-2.5 text-[13.5px] transition-colors duration-fast lg:border-b lg:border-rule lg:py-2.5',
                    isActive ? 'text-blue' : 'text-faint hover:text-ink',
                  )
                }
              >
                <Icon name={item.icon} size={16} />
                {item.label}
              </NavLink>
            ))}
          </div>
        </aside>

        <div className="min-w-0">
          <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="resources" element={<ResourcesAdmin />} />
              <Route path="resources/new" element={<ResourceEditor />} />
              <Route path="resources/:id" element={<ResourceEditor />} />
              <Route path="taxonomy" element={<TaxonomyAdmin />} />
              <Route path="tutorials" element={<TutorialsAdmin />} />
              <Route path="tutorials/new" element={<TutorialEditor />} />
              <Route path="tutorials/:id" element={<TutorialEditor />} />
              <Route path="users" element={<UsersAdmin />} />
              <Route path="analytics" element={<AnalyticsAdmin />} />
              <Route path="reports" element={<ReportsAdmin />} />
              <Route path="changelog" element={<ChangelogAdmin />} />
              <Route path="settings" element={<SettingsAdmin />} />
              <Route path="audit" element={<AuditAdmin />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </div>
  );
}
