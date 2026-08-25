import { useState } from 'react';
import { useDebounced, useFetch } from '../../lib/hooks';
import type { Paged, ResourceCard as ResourceCardType } from '../../lib/api';
import { ResourceCard } from '../../components/ResourceCard';
import { Button, EmptyState, LinkButton, Skeleton } from '../../components/ui';
import { Icon } from '../../components/Icon';

/** Saved resources (PRD §20). */
export default function Saved() {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ page: String(page), perPage: '20' });
  if (debounced) query.set('q', debounced);
  const { data, loading } = useFetch<Paged<ResourceCardType & { savedAt: string }>>(
    `/me/saved?${query}`,
    [debounced, page],
  );

  if (loading && !data) return <Skeleton className="h-64 w-full" />;

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-ink pb-3">
        <h2 className="text-[26px] md:text-[30px]">Saved</h2>
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <label htmlFor="saved-search" className="sr-only">Search saved resources</label>
          <div className="flex items-center gap-2 border-b border-rule-strong pb-1.5 transition-colors duration-fast focus-within:border-blue hover:border-ink">
            <Icon name="search" size={15} className="shrink-0 text-ghost" />
            <input
              id="saved-search"
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search saved"
              className="w-full min-w-0 border-0 bg-transparent p-0 text-[14px] text-ink placeholder:text-ghost focus:outline-none focus:ring-0"
            />
          </div>
        </div>
      </div>

      {!data || data.items.length === 0 ? (
        <EmptyState
          icon="bookmark"
          title={debounced ? 'Nothing matched that' : 'Save resources you want to revisit'}
          description={
            debounced
              ? 'Try a different word.'
              : 'Tap the bookmark on any resource and it will be waiting here.'
          }
          action={!debounced ? <LinkButton to="/resources" variant="primary">Browse resources</LinkButton> : undefined}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-x-8 gap-y-10 min-[560px]:grid-cols-2 xl:grid-cols-3">
            {data.items.map((r) => (
              <ResourceCard key={r.id} resource={r} />
            ))}
          </div>
          {data.hasMore ? (
            <div className="mt-10 flex justify-center border-t border-rule pt-6">
              <Button onClick={() => setPage((p) => p + 1)} loading={loading}>Load more</Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
