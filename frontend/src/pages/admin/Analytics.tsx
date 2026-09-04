import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoad, useTitle } from '../../lib/hooks';
import { formatExact } from '../../lib/format';
import { PageError } from '../../components/Chrome';
import { Empty, Skeleton, cx } from '../../ui/primitives';

/**
 * Analytics.
 *
 * This screen exists to answer product questions, not to look busy. Searches
 * that found nothing are the clearest list of what to make next; pages people
 * look at but do not download from are the clearest list of what to fix.
 */

interface Payload {
  topSearches: Array<{ query: string; count: number }>;
  emptySearches: Array<{ query: string; count: number }>;
  mostViewed: Array<{ id: string; title: string; slug: string; viewCount: number; downloadCount: number }>;
  mostSaved: Array<{ id: string; title: string; slug: string; saveCount: number }>;
  lowConversion: Array<{
    id: string;
    title: string;
    slug: string;
    viewCount: number;
    downloadCount: number;
    ratePercent: number;
  }>;
  deviceSplit: Array<{ device: string; count: number }>;
  signedInDownloadShare: number;
}

const RANGES = [7, 30, 90];

export default function Analytics() {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useLoad<Payload>(`/admin/analytics?days=${days}`);

  useTitle('Analytics · Owner tools');

  if (error) return <PageError onRetry={reload} />;

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px]">Analytics</h1>
          <p className="mt-1.5 text-[13.5px] text-text-3">
            What people looked for, and what they did when they found it.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setDays(range)}
              className={cx(
                'font-mono text-[12.5px] transition-colors duration-fast ease-out',
                range === days ? 'text-accent' : 'text-text-3 hover:text-text',
              )}
            >
              {range}d
            </button>
          ))}
        </div>
      </header>

      {loading && !data ? (
        <Skeleton className="h-96 w-full" />
      ) : data ? (
        <div className="grid gap-12 lg:grid-cols-2">
          <section>
            <h2 className="mb-4 border-b border-line pb-2 text-[20px]">Searches with no results</h2>
            <p className="mb-4 text-[12.5px] leading-relaxed text-text-3">
              Somebody wanted this and the library did not have it. This is the list to make next.
            </p>
            {data.emptySearches.length ? (
              <ol className="flex flex-col">
                {data.emptySearches.map((row) => (
                  <li
                    key={row.query}
                    className="flex items-baseline justify-between gap-4 border-b border-line py-2 first:border-t"
                  >
                    <span className="min-w-0 truncate text-[13.5px] text-text-2">“{row.query}”</span>
                    <span className="font-mono text-[12px] text-caution">{row.count}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty
                icon="search"
                title="Every search found something"
                body="Nothing came back empty in this period."
              />
            )}
          </section>

          <section>
            <h2 className="mb-4 border-b border-line pb-2 text-[20px]">High views, low downloads</h2>
            <p className="mb-4 text-[12.5px] leading-relaxed text-text-3">
              People arrived and left. Usually a weak preview, an unclear license, or a title that
              promises something the file is not.
            </p>
            {data.lowConversion.length ? (
              <ol className="flex flex-col">
                {data.lowConversion.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-baseline gap-4 border-b border-line py-2 first:border-t"
                  >
                    <Link
                      to={`/resources/${row.slug}`}
                      className="min-w-0 flex-1 truncate text-[13.5px] text-text-2 hover:text-accent"
                    >
                      {row.title}
                    </Link>
                    <span className="font-mono text-[11.5px] text-text-4">
                      {formatExact(row.viewCount)} views
                    </span>
                    <span className="w-10 text-right font-mono text-[12px] text-caution">
                      {row.ratePercent}%
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty
                icon="check"
                title="Nothing is underperforming"
                body="Every page with real traffic converts."
              />
            )}
          </section>

          <section>
            <h2 className="mb-4 border-b border-line pb-2 text-[20px]">What people search for</h2>
            {data.topSearches.length ? (
              <ol className="flex flex-col">
                {data.topSearches.map((row) => (
                  <li
                    key={row.query}
                    className="flex items-baseline justify-between gap-4 border-b border-line py-2 first:border-t"
                  >
                    <Link
                      to={`/resources?q=${encodeURIComponent(row.query)}`}
                      className="min-w-0 truncate text-[13.5px] text-text-2 hover:text-accent"
                    >
                      “{row.query}”
                    </Link>
                    <span className="font-mono text-[12px] text-text-3">{row.count}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-text-3">No searches in this period.</p>
            )}
          </section>

          <section>
            <h2 className="mb-4 border-b border-line pb-2 text-[20px]">Saved most often</h2>
            {data.mostSaved.length ? (
              <ol className="flex flex-col">
                {data.mostSaved.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-baseline justify-between gap-4 border-b border-line py-2 first:border-t"
                  >
                    <Link
                      to={`/resources/${row.slug}`}
                      className="min-w-0 truncate text-[13.5px] text-text-2 hover:text-accent"
                    >
                      {row.title}
                    </Link>
                    <span className="font-mono text-[12px] text-text-3">{row.saveCount}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-text-3">Nothing has been saved yet.</p>
            )}
          </section>

          <section>
            <h2 className="mb-4 border-b border-line pb-2 text-[20px]">Where downloads happen</h2>
            <ul className="flex flex-col">
              {data.deviceSplit.map((row) => (
                <li
                  key={row.device}
                  className="flex items-baseline justify-between gap-4 border-b border-line py-2 first:border-t"
                >
                  <span className="text-[13.5px] text-text-2">{row.device}</span>
                  <span className="font-mono text-[12px] text-text-3">{formatExact(row.count)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[13px] text-text-3">
              {data.signedInDownloadShare}% of downloads came from someone signed in. The rest are
              guests, which is the point.
            </p>
          </section>

          <section>
            <h2 className="mb-4 border-b border-line pb-2 text-[20px]">Most viewed</h2>
            <ol className="flex flex-col">
              {data.mostViewed.map((row) => (
                <li
                  key={row.id}
                  className="flex items-baseline gap-4 border-b border-line py-2 first:border-t"
                >
                  <Link
                    to={`/resources/${row.slug}`}
                    className="min-w-0 flex-1 truncate text-[13.5px] text-text-2 hover:text-accent"
                  >
                    {row.title}
                  </Link>
                  <span className="font-mono text-[11.5px] text-text-4">
                    {formatExact(row.viewCount)} views
                  </span>
                  <span className="font-mono text-[12px] text-text-3">
                    {formatExact(row.downloadCount)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}
    </>
  );
}
