import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, type ResourceCard } from '../../lib/api';
import { useDebounced, useFetch } from '../../lib/hooks';
import { Marker, Button, cx, EmptyState, LinkButton, Skeleton, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { formatDate } from '../../lib/format';

type Row = ResourceCard & {
  scheduledFor: string | null;
  viewCount: number;
  saveCount: number;
  versionCount: number;
};

const STATUSES = ['PUBLISHED', 'DRAFT', 'SCHEDULED', 'UNLISTED', 'ARCHIVED'] as const;

/** Resource list with bulk actions (PRD §42). */
export default function ResourcesAdmin() {
  const [params, setParams] = useSearchParams();
  const { toast } = useToast();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebounced(search, 300);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const query = new URLSearchParams(params);
  if (debounced) query.set('q', debounced);
  else query.delete('q');

  const { data, loading, reload } = useFetch<{
    items: Row[];
    total: number;
    statusCounts: Record<string, number>;
  }>(`/admin/resources?${query}`, [debounced]);

  const status = params.get('status');

  const setStatus = (next: string | null) => {
    const p = new URLSearchParams(params);
    if (next) p.set('status', next);
    else p.delete('status');
    setParams(p);
    setSelected(new Set());
  };

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulk = async (action: string) => {
    setBusy(true);
    try {
      const res = await api.post<{ updated: number }>('/admin/resources/bulk', {
        ids: [...selected],
        action,
      });
      toast(`${res.updated} updated.`, 'success');
      setSelected(new Set());
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px] leading-tight md:text-[34px]">Resources</h1>
        <LinkButton to="/admin/resources/new" variant="primary" icon="plus">
          New resource
        </LinkButton>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStatus(null)}
          className={cx(
            'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-fast',
            !status ? 'bg-blue-wash text-blue' : 'text-soft hover:bg-sunk hover:text-ink',
          )}
        >
          All {data ? `(${data.total})` : ''}
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={cx(
              'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-fast',
              status === s ? 'bg-blue-wash text-blue' : 'text-soft hover:bg-sunk hover:text-ink',
            )}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
            {data?.statusCounts[s] ? ` (${data.statusCounts[s]})` : ''}
          </button>
        ))}

        <div className="relative ml-auto min-w-0 flex-1 sm:max-w-xs">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <label htmlFor="admin-resource-search" className="sr-only">Search resources</label>
          <input
            id="admin-resource-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full min-w-0 border-0 border-b border-rule-strong bg-transparent px-0 py-1.5 text-[14px] text-ink rounded-none transition-colors duration-fast hover:border-ink focus:border-blue focus:outline-none focus:ring-0 placeholder:text-ghost"
          />
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue bg-blue-wash p-3">
          <span className="text-[13px] font-medium text-blue">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" onClick={() => bulk('publish')} disabled={busy}>Publish</Button>
            <Button size="sm" onClick={() => bulk('unpublish')} disabled={busy}>Unpublish</Button>
            <Button size="sm" onClick={() => bulk('feature')} disabled={busy}>Feature</Button>
            <Button size="sm" onClick={() => bulk('archive')} disabled={busy}>Archive</Button>
            <Button size="sm" variant="quiet" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      ) : null}

      {loading && !data ? (
        <Skeleton className="h-96" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon="file"
          title={debounced || status ? 'Nothing matched' : 'Upload your first resource'}
          description={
            debounced || status
              ? 'Try a different search or filter.'
              : 'Create a resource, attach its file, and publish it.'
          }
          action={<LinkButton to="/admin/resources/new" variant="primary">New resource</LinkButton>}
        />
      ) : (
        <div className="border-t border-rule">
          <ul>
            {data.items.map((r) => (
              <li key={r.id} className="flex items-center gap-3 border-b border-rule py-3 transition-colors duration-fast">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                  aria-label={`Select ${r.title}`}
                  className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--blue)]"
                />
                <Link to={`/admin/resources/${r.id}`} className="well h-10 w-14 shrink-0 overflow-hidden rounded">
                  {r.thumbnailUrl ? <img src={r.thumbnailUrl} alt="" loading="lazy" /> : null}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/resources/${r.id}`} className="block truncate text-[14px] font-medium hover:text-blue">
                    {r.title}
                  </Link>
                  <p className="truncate text-[12px] text-faint">
                    {r.category.name}
                    {r.version ? ` · v${r.version}` : ' · no file'}
                    {` · ${r.downloadCount} downloads`}
                    {` · updated ${formatDate(r.updatedAt)}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.featured ? <Marker tone="warn">Featured</Marker> : null}
                  {r.versionCount === 0 ? <Marker tone="stop">No file</Marker> : null}
                  <StatusPill status={r.status} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'PUBLISHED' ? 'go'
    : status === 'SCHEDULED' ? 'warn'
    : status === 'UNLISTED' ? 'blue'
    : status === 'ARCHIVED' ? 'stop'
    : 'neutral';
  return <Marker tone={tone}>{status.charAt(0) + status.slice(1).toLowerCase()}</Marker>;
}
