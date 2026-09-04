import { useState } from 'react';
import { query } from '../../lib/api';
import { useDebounced, useLoad, useTitle } from '../../lib/hooks';
import type { DownloadedResource, Paged } from '../../lib/types';
import { formatDate } from '../../lib/format';
import { CardGrid, CardGridSkeleton, ResourceCard } from '../../components/ResourceCard';
import { PageError } from '../../components/Chrome';
import { ButtonLink, Empty, Input, Marker, Pagination } from '../../ui/primitives';

/**
 * Download history.
 *
 * Every row records the version that was actually taken, which is what makes
 * "there is a newer one now" possible to say honestly.
 */
export default function Downloads() {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounced(term, 250);

  const { data, error, loading, reload } = useLoad<Paged<DownloadedResource>>(
    `/me/downloads${query({ q: search, page: page > 1 ? page : undefined })}`,
  );

  useTitle('Downloads · Cyriq VFX');

  if (error) return <PageError onRetry={reload} />;

  return (
    <>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px]">Downloads</h1>
          <p className="mt-1.5 text-[13.5px] text-text-3">
            Everything you have taken, newest first.
          </p>
        </div>

        <div className="w-full sm:w-64">
          <label htmlFor="history-search" className="sr-only">
            Search your downloads
          </label>
          <Input
            id="history-search"
            type="search"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
            placeholder="Search your downloads"
          />
        </div>
      </header>

      {loading && !data ? (
        <CardGridSkeleton count={4} />
      ) : data && data.items.length ? (
        <>
          <CardGrid>
            {data.items.map((item) => (
              <ResourceCard
                key={`${item.id}-${item.downloadedAt}`}
                resource={item}
                footnote={
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-[12px] text-text-4">
                      {formatDate(item.downloadedAt)}
                      {item.downloadedVersion ? ` / v${item.downloadedVersion}` : ''}
                    </span>
                    {item.updateAvailable ? (
                      <Marker tone="accent">v{item.currentVersion} available</Marker>
                    ) : null}
                  </div>
                }
              />
            ))}
          </CardGrid>

          <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </>
      ) : search ? (
        <Empty
          icon="search"
          title="Nothing in your history matches that"
          body="Try a shorter search, or clear it to see everything."
        />
      ) : (
        <Empty
          icon="download"
          title="You have not downloaded anything yet"
          body="Your history fills in as you download, and tells you when a new version appears."
          action={<ButtonLink to="/resources" variant="primary">Browse the library</ButtonLink>}
        />
      )}
    </>
  );
}
