import { Link } from 'react-router-dom';
import { useFetch } from '../../lib/hooks';
import type { Paged, TutorialCard } from '../../lib/api';
import { Marker, EmptyState, LinkButton, Skeleton } from '../../components/ui';
import { formatDate, skillLabel } from '../../lib/format';

export default function TutorialsAdmin() {
  const { data, loading } = useFetch<Paged<TutorialCard>>('/admin/tutorials');

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px] leading-tight md:text-[34px]">Tutorials</h1>
        <LinkButton to="/admin/tutorials/new" variant="primary" icon="plus">New tutorial</LinkButton>
      </header>

      {loading && !data ? (
        <Skeleton className="h-80" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon="play"
          title="No tutorials yet"
          description="Tutorials link directly to the resources they use, and that connection is what makes them worth writing."
          action={<LinkButton to="/admin/tutorials/new" variant="primary">Create one</LinkButton>}
        />
      ) : (
        <div className="border-t border-rule">
          <ul>
            {data.items.map((t) => (
              <li key={t.id} className="flex items-center gap-3 border-b border-rule py-3 transition-colors duration-fast">
                <Link to={`/admin/tutorials/${t.id}`} className="well h-10 w-16 shrink-0 overflow-hidden rounded">
                  {t.coverUrl ? <img src={t.coverUrl} alt="" loading="lazy" /> : null}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/tutorials/${t.id}`} className="block truncate text-[14px] font-medium hover:text-blue">
                    {t.title}
                  </Link>
                  <p className="truncate text-[12px] text-faint">
                    {skillLabel(t.skillLevel)} · {t.resourceCount} resources · updated {formatDate(t.updatedAt)}
                  </p>
                </div>
                <Marker tone={t.status === 'PUBLISHED' ? 'go' : 'neutral'}>
                  {t.status.charAt(0) + t.status.slice(1).toLowerCase()}
                </Marker>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
