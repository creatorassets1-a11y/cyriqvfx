import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { query } from '../../lib/api';
import { useDebounced, useLoad, useTitle } from '../../lib/hooks';
import type { ContentStatus, TutorialCard } from '../../lib/types';
import { formatDuration, formatExact, formatRelative, skillLabel, statusLabel } from '../../lib/format';
import { PageError } from '../../components/Chrome';
import { ButtonLink, Empty, Input, Marker, Pagination, Skeleton, cx } from '../../ui/primitives';

/** Every tutorial, with the state that decides whether it is public. */

interface Payload {
  items: TutorialCard[];
  total: number;
  page: number;
  totalPages: number;
  statusCounts: Record<string, number>;
}

const STATUSES = [
  { value: '', label: 'All' },
  { value: 'DRAFT', label: 'Drafts' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const TONES: Record<ContentStatus, 'neutral' | 'accent' | 'positive' | 'caution'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'caution',
  PUBLISHED: 'positive',
  UNLISTED: 'accent',
  ARCHIVED: 'neutral',
};

export default function TutorialList() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [term, setTerm] = useState(params.get('q') ?? '');
  const [flash, setFlash] = useState<string | null>(null);
  const search = useDebounced(term, 250);

  const page = Number(params.get('page') ?? '1');
  const status = params.get('status') ?? '';

  const { data, error, loading, reload } = useLoad<Payload>(
    `/admin/tutorials${query({ q: search, status, page: page > 1 ? page : undefined })}`,
  );

  useTitle('Tutorials · Owner tools');

  useEffect(() => {
    const sent = (location.state as { flash?: string } | null)?.flash;
    if (sent) setFlash(sent);
  }, [location.state]);

  function setParam(key: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    });
  }

  if (error) return <PageError onRetry={reload} />;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px]">Tutorials</h1>
          <p className="mt-1.5 text-[13.5px] text-text-3">
            {data ? `${formatExact(data.total)} in total` : 'Loading…'}
          </p>
        </div>
        <ButtonLink to="/admin/tutorials/new" variant="primary" icon="plus">
          New tutorial
        </ButtonLink>
      </header>

      {flash ? (
        <p role="status" className="mb-5 text-[13px] text-positive">
          {flash}
        </p>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3 border-y border-line py-3">
        {STATUSES.map((option) => (
          <button
            key={option.value || 'all'}
            type="button"
            onClick={() => setParam('status', option.value)}
            className={cx(
              'text-[13px] transition-colors duration-fast ease-out',
              status === option.value ? 'text-accent' : 'text-text-3 hover:text-text',
            )}
          >
            {option.label}
          </button>
        ))}

        <div className="ml-auto w-full sm:w-56">
          <label htmlFor="admin-tutorial-search" className="sr-only">
            Search tutorials by title
          </label>
          <Input
            id="admin-tutorial-search"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search by title"
          />
        </div>
      </div>

      {loading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : data && data.items.length ? (
        <>
          <ul className="flex flex-col">
            {data.items.map((tutorial) => (
              <li key={tutorial.id} className="border-b border-line py-3.5 first:border-t">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <Link
                    to={`/admin/tutorials/${tutorial.id}`}
                    className="text-[14.5px] text-text hover:text-accent"
                  >
                    {tutorial.title}
                  </Link>
                  <Marker tone={TONES[tutorial.status]}>{statusLabel(tutorial.status)}</Marker>
                </div>

                <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-text-4">
                  <span>{skillLabel(tutorial.skillLevel)}</span>
                  {tutorial.durationSeconds ? (
                    <span>{formatDuration(tutorial.durationSeconds)}</span>
                  ) : null}
                  <span>{tutorial.resourceCount} linked</span>
                  <span>edited {formatRelative(tutorial.updatedAt)}</span>
                </p>
              </li>
            ))}
          </ul>

          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            onPage={(next) => setParam('page', String(next))}
          />
        </>
      ) : (
        <Empty
          icon="film"
          title="No tutorials yet"
          body="Tutorials are what make the resources make sense. Write the first one."
          action={<ButtonLink to="/admin/tutorials/new" variant="primary">New tutorial</ButtonLink>}
        />
      )}
    </>
  );
}
