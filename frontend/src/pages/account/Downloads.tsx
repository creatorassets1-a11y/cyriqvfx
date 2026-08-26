import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDebounced, useFetch } from '../../lib/hooks';
import type { HistoryItem, Paged } from '../../lib/api';
import { Marker, Button, EmptyState, LinkButton, Skeleton } from '../../components/ui';
import { DownloadButton } from '../../components/DownloadButton';
import { Icon } from '../../components/Icon';
import { formatDate } from '../../lib/format';

/** Download history (PRD §19). Persisted in PostgreSQL, so it survives deploys. */
export default function Downloads() {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ page: String(page), perPage: '20' });
  if (debounced) query.set('q', debounced);
  const { data, loading } = useFetch<Paged<HistoryItem>>(`/me/downloads?${query}`, [debounced, page]);

  if (loading && !data) return <Skeleton className="h-64 w-full" />;

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-ink pb-3">
        <h2 className="text-[26px] md:text-[30px]">Downloads</h2>
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <label htmlFor="history-search" className="sr-only">Search your downloads</label>
          <div className="flex items-center gap-2 border-b border-rule-strong pb-1.5 transition-colors duration-fast focus-within:border-blue hover:border-ink">
            <Icon name="search" size={15} className="shrink-0 text-ghost" />
            <input
              id="history-search"
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search your downloads"
              className="w-full min-w-0 border-0 bg-transparent p-0 text-[14px] text-ink placeholder:text-ghost focus:outline-none focus:ring-0"
            />
          </div>
        </div>
      </div>

      {!data || data.items.length === 0 ? (
        <EmptyState
          icon="history"
          title={debounced ? 'Nothing matched that' : 'Your downloads will show up here'}
          description={
            debounced
              ? 'Try a different word, or clear the search.'
              : 'Every file you download while signed in is listed here, with the version you got.'
          }
          action={!debounced ? <LinkButton to="/resources" variant="primary">Browse resources</LinkButton> : undefined}
        />
      ) : (
        <>
          <ul className="flex flex-col">
            {data.items.map((item) => (
              <li key={item.id} className="border-b border-rule py-5 first:border-t">
                <div className="flex gap-4">
                  <Link to={`/resources/${item.slug}`} className="well h-14 w-20 shrink-0">
                    {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" /> : null}
                  </Link>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <Link to={`/resources/${item.slug}`} className="font-display text-[19px] hover:text-blue">
                        {item.title}
                      </Link>
                      {item.updateAvailable ? <Marker tone="go">Update available</Marker> : null}
                    </div>

                    <p className="mt-1.5 font-mono text-[12px] text-ghost">
                      Downloaded {formatDate(item.downloadedAt)}
                      {item.downloadedVersion ? ` / v${item.downloadedVersion}` : ''}
                      {item.updateAvailable ? ` / v${item.currentVersion} is now current` : ''}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <DownloadButton
                        token={item.downloadToken}
                        label={item.updateAvailable ? `Get v${item.currentVersion}` : 'Download again'}
                        size="md"
                      />
                      <LinkButton to={`/resources/${item.slug}`} size="md">View resource</LinkButton>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {data.hasMore ? (
            <div className="mt-8 flex justify-center border-t border-rule pt-6">
              <Button onClick={() => setPage((p) => p + 1)} loading={loading}>Load more</Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
