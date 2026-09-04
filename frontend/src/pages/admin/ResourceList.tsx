import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api, ApiError, query } from '../../lib/api';
import { useDebounced, useLoad, useTitle } from '../../lib/hooks';
import type { ContentStatus, ResourceCard } from '../../lib/types';
import { formatExact, formatRelative, statusLabel } from '../../lib/format';
import { PageError } from '../../components/Chrome';
import {
  Button,
  ButtonLink,
  Check,
  Empty,
  Input,
  Marker,
  Note,
  Pagination,
  Skeleton,
  cx,
} from '../../ui/primitives';

/**
 * Every resource, in one list.
 *
 * The list is a working surface, not a report: status, file count and the
 * bulk actions are here because publishing eight things at once is a normal
 * afternoon, and doing it one page at a time is not.
 */

interface Row extends ResourceCard {
  scheduledFor: string | null;
  viewCount: number;
  saveCount: number;
  versionCount: number;
}

interface Payload {
  items: Row[];
  page: number;
  totalPages: number;
  total: number;
  statusCounts: Record<string, number>;
}

const STATUSES: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'DRAFT', label: 'Drafts' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'UNLISTED', label: 'Unlisted' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const TONES: Record<ContentStatus, 'neutral' | 'accent' | 'positive' | 'caution'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'caution',
  PUBLISHED: 'positive',
  UNLISTED: 'accent',
  ARCHIVED: 'neutral',
};

export default function ResourceList() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [flash, setFlash] = useState<string | null>(null);
  const [term, setTerm] = useState(params.get('q') ?? '');
  const search = useDebounced(term, 250);
  const [picked, setPicked] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const page = Number(params.get('page') ?? '1');
  const status = params.get('status') ?? '';

  const { data, error, loading, reload } = useLoad<Payload>(
    `/admin/resources${query({ q: search, status, page: page > 1 ? page : undefined })}`,
  );

  useTitle('Resources · Owner tools');

  // A message from the screen that sent us here, such as a deletion.
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

  async function bulk(action: string) {
    setWorking(true);
    setFailure(null);

    try {
      await api.post('/admin/resources/bulk', { ids: picked, action });
      setPicked([]);
      reload();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'That could not be applied.');
    } finally {
      setWorking(false);
    }
  }

  if (error) return <PageError onRetry={reload} />;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px]">Resources</h1>
          <p className="mt-1.5 text-[13.5px] text-text-3">
            {data ? `${formatExact(data.total)} in total` : 'Loading…'}
          </p>
        </div>
        <ButtonLink to="/admin/resources/new" variant="primary" icon="plus">
          New resource
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
            {data?.statusCounts[option.value] ? (
              <span className="ml-1.5 font-mono text-[11.5px] text-text-4">
                {data.statusCounts[option.value]}
              </span>
            ) : null}
          </button>
        ))}

        <div className="ml-auto w-full sm:w-56">
          <label htmlFor="admin-resource-search" className="sr-only">
            Search resources by title
          </label>
          <Input
            id="admin-resource-search"
            type="search"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setParam('page', '');
            }}
            placeholder="Search by title"
          />
        </div>
      </div>

      {picked.length ? (
        <div className="mb-5 flex flex-wrap items-center gap-2.5 border border-line-strong bg-inset px-4 py-3">
          <p className="text-[13px] text-text-2">
            {picked.length} selected
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" onClick={() => bulk('publish')} loading={working}>
              Publish
            </Button>
            <Button size="sm" onClick={() => bulk('unpublish')} loading={working}>
              Unpublish
            </Button>
            <Button size="sm" onClick={() => bulk('feature')} loading={working}>
              Feature
            </Button>
            <Button size="sm" onClick={() => bulk('archive')} loading={working}>
              Archive
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setPicked([])}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      {failure ? (
        <div className="mb-5">
          <Note tone="critical">{failure}</Note>
        </div>
      ) : null}

      {loading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : data && data.items.length ? (
        <>
          <ul className="flex flex-col">
            {data.items.map((row) => (
              <li key={row.id} className="flex items-start gap-4 border-b border-line py-3.5 first:border-t">
                <div className="pt-0.5">
                  <Check
                    checked={picked.includes(row.id)}
                    onChange={(checked) =>
                      setPicked((current) =>
                        checked ? [...current, row.id] : current.filter((id) => id !== row.id),
                      )
                    }
                    label={<span className="sr-only">Select {row.title}</span>}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <Link
                      to={`/admin/resources/${row.id}`}
                      className="text-[14.5px] text-text hover:text-accent"
                    >
                      {row.title}
                    </Link>
                    <Marker tone={TONES[row.status]}>{statusLabel(row.status)}</Marker>
                    {row.versionCount === 0 ? <Marker tone="critical">No file</Marker> : null}
                    {row.featured ? <Marker tone="accent">Featured</Marker> : null}
                  </div>

                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-text-4">
                    <span>{row.category.name}</span>
                    <span>{formatExact(row.downloadCount)} downloads</span>
                    <span>{formatExact(row.viewCount)} views</span>
                    {row.version ? <span>v{row.version}</span> : null}
                    <span>edited {formatRelative(row.updatedAt)}</span>
                  </p>
                </div>

                {row.status === 'PUBLISHED' ? (
                  <Link
                    to={`/resources/${row.slug}`}
                    className="shrink-0 text-[12.5px] text-text-3 hover:text-text"
                  >
                    View
                  </Link>
                ) : null}
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
          icon="file"
          title="Nothing here yet"
          body={search ? 'No resource matches that search.' : 'Publish your first resource.'}
          action={<ButtonLink to="/admin/resources/new" variant="primary">New resource</ButtonLink>}
        />
      )}
    </>
  );
}
