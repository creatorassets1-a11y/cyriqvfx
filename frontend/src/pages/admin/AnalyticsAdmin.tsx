import { Link } from 'react-router-dom';
import { useFetch } from '../../lib/hooks';
import { Block, Skeleton } from '../../components/ui';

interface AnalyticsData {
  topSearches: Array<{ query: string; count: number }>;
  emptySearches: Array<{ query: string; count: number }>;
  mostViewed: Array<{ id: string; title: string; slug: string; viewCount: number; downloadCount: number }>;
  mostSaved: Array<{ id: string; title: string; slug: string; saveCount: number }>;
  lowConversion: Array<{ id: string; title: string; slug: string; viewCount: number; downloadCount: number; ratePercent: number }>;
  deviceSplit: Array<{ device: string; count: number }>;
  signedInDownloadShare: number;
}

/** "What do people want" (PRD §66). Every panel answers a product question. */
export default function AnalyticsAdmin() {
  const { data, loading } = useFetch<AnalyticsData>('/admin/analytics?days=30');

  if (loading || !data) return <Skeleton className="h-96" />;

  const totalDevices = data.deviceSplit.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="flex flex-col gap-10">
      <header className="border-b border-ink pb-4">
        <p className="eyebrow">Admin</p>
        <h1 className="mt-2 text-[30px] leading-tight md:text-[34px]">Analytics</h1>
        <p className="mt-2 text-[13.5px] text-soft">
          Last 30 days. Use this to decide what to make next.
        </p>
      </header>

      {/* The most actionable panel goes first (PRD §66) */}
      <Block
        title="Searches with no results"
        description="People looked for these and found nothing. That is a to-do list."
      >
        {data.emptySearches.length === 0 ? (
          <p className="py-2 text-[13.5px] text-faint">
            Every search in this period returned something.
          </p>
        ) : (
          <ul className="flex flex-col border-l-2 border-[color:var(--warn)] pl-4">
            {data.emptySearches.map((s) => (
              <li key={s.query} className="flex items-center justify-between gap-3 py-1.5">
                <span className="truncate font-mono text-[13px] text-ink">{s.query}</span>
                <span className="shrink-0 font-mono text-[12px] text-warn">{s.count}×</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block
        title="High views, low downloads"
        description="Usually a weak preview, unclear compatibility, or a license people are unsure about."
      >
        {data.lowConversion.length === 0 ? (
          <p className="py-2 text-[13.5px] text-faint">Nothing is underperforming.</p>
        ) : (
          <ul className="flex flex-col">
            {data.lowConversion.map((r) => (
              <li key={r.id} className="flex items-center gap-3 border-b border-rule py-2.5 first:border-t">
                <Link to={`/resources/${r.slug}`} className="min-w-0 flex-1 truncate text-[13.5px] hover:text-blue">
                  {r.title}
                </Link>
                <span className="shrink-0 text-[12px] text-faint">{r.viewCount} views · {r.downloadCount} downloads</span>
                <span className="shrink-0 font-mono text-[12.5px] text-warn">{r.ratePercent}%</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <div className="grid gap-5 lg:grid-cols-2">
        <Block title="Top searches">
          {data.topSearches.length === 0 ? (
            <p className="py-2 text-[13.5px] text-faint">No searches recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.topSearches.map((s) => (
                <li key={s.query} className="flex items-center justify-between gap-3 text-[13.5px]">
                  <span className="truncate font-mono">{s.query}</span>
                  <span className="shrink-0 text-faint">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Most saved">
          {data.mostSaved.length === 0 ? (
            <p className="py-2 text-[13.5px] text-faint">Nothing saved yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {data.mostSaved.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 text-[13.5px]">
                  <Link to={`/resources/${r.slug}`} className="truncate hover:text-blue">{r.title}</Link>
                  <span className="shrink-0 text-faint">{r.saveCount}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Block title="How people arrive" description="Device class of downloaders.">
          {totalDevices === 0 ? (
            <p className="py-2 text-[13.5px] text-faint">No downloads yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {data.deviceSplit.map((d) => (
                <li key={d.device}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="capitalize">{d.device}</span>
                    <span className="font-mono text-[12px] text-faint">
                      {Math.round((d.count / totalDevices) * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-sunk">
                    <div className="h-full rounded-full bg-blue" style={{ width: `${(d.count / totalDevices) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Signed-in downloads" description="Share of downloads made by people with accounts.">
          <p className="text-[34px] font-bold tracking-tight">{data.signedInDownloadShare}%</p>
          <p className="mt-1 text-[13px] text-soft">
            The rest are guests. Guests downloading freely is the point, and this only tells you how
            many find an account worth making afterwards.
          </p>
        </Block>
      </div>
    </div>
  );
}
