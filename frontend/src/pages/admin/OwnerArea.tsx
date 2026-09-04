import { NavLink, Route, Routes } from 'react-router-dom';
import { cx } from '../../ui/primitives';
import NotFound from '../NotFound';
import Dashboard from './Dashboard';
import ResourceList from './ResourceList';
import ResourceEditor from './ResourceEditor';
import TutorialList from './TutorialList';
import TutorialEditor from './TutorialEditor';
import Taxonomy from './Taxonomy';
import ChangelogAdmin from './ChangelogAdmin';
import SettingsAdmin from './SettingsAdmin';
import UsersAdmin from './UsersAdmin';
import ReportsAdmin from './ReportsAdmin';
import RequestsAdmin from './RequestsAdmin';
import AuditAdmin from './AuditAdmin';
import Analytics from './Analytics';

/**
 * The owner's side of the site.
 *
 * Everything the product does is done from here — publishing, taxonomy,
 * licensing, settings, moderation — with no step that requires editing code or
 * touching the database. This whole area is loaded on demand, so it costs a
 * visitor nothing.
 */

const SECTIONS = [
  {
    title: 'Publish',
    links: [
      { to: '/admin', label: 'Dashboard', end: true },
      { to: '/admin/resources', label: 'Resources' },
      { to: '/admin/tutorials', label: 'Tutorials' },
      { to: '/admin/updates', label: 'Updates' },
    ],
  },
  {
    title: 'Configure',
    links: [
      { to: '/admin/taxonomy', label: 'Taxonomy' },
      { to: '/admin/settings', label: 'Settings' },
    ],
  },
  {
    title: 'Watch',
    links: [
      { to: '/admin/analytics', label: 'Analytics' },
      { to: '/admin/users', label: 'Users' },
      { to: '/admin/reports', label: 'Reports' },
      { to: '/admin/requests', label: 'Requests' },
      { to: '/admin/audit', label: 'Audit log' },
    ],
  },
];

export default function OwnerArea() {
  return (
    <div className="page py-8 md:py-10">
      <div className="grid gap-10 lg:grid-cols-[180px_1fr] lg:gap-14">
        {/* min-w-0 lets the row below actually scroll on a phone: without it
            the grid track is sized to the nav's widest possible line and the
            whole page inherits that width. */}
        <nav
          aria-label="Owner tools"
          className="min-w-0 lg:sticky lg:top-[calc(var(--masthead)+24px)] lg:self-start"
        >
          <div className="swipe flex gap-6 border-b border-line pb-3 lg:flex-col lg:gap-7 lg:border-b-0 lg:pb-0">
            {SECTIONS.map((section) => (
              <div key={section.title} className="shrink-0">
                <p className="kicker mb-2 hidden lg:block">{section.title}</p>
                <ul className="flex gap-5 lg:flex-col lg:gap-1.5">
                  {section.links.map((link) => (
                    <li key={link.to}>
                      <NavLink
                        to={link.to}
                        end={link.end}
                        className={({ isActive }) =>
                          cx(
                            'block whitespace-nowrap text-[13.5px] transition-colors duration-fast ease-out',
                            isActive ? 'text-accent' : 'text-text-3 hover:text-text',
                          )
                        }
                      >
                        {link.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="resources" element={<ResourceList />} />
            <Route path="resources/new" element={<ResourceEditor />} />
            <Route path="resources/:id" element={<ResourceEditor />} />
            <Route path="tutorials" element={<TutorialList />} />
            <Route path="tutorials/new" element={<TutorialEditor />} />
            <Route path="tutorials/:id" element={<TutorialEditor />} />
            <Route path="updates" element={<ChangelogAdmin />} />
            <Route path="taxonomy" element={<Taxonomy />} />
            <Route path="settings" element={<SettingsAdmin />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="users" element={<UsersAdmin />} />
            <Route path="reports" element={<ReportsAdmin />} />
            <Route path="requests" element={<RequestsAdmin />} />
            <Route path="audit" element={<AuditAdmin />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
