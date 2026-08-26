import { Link } from 'react-router-dom';
import { useFetch } from '../../lib/hooks';
import { cx, LinkButton, Block, Skeleton } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { formatCount, formatRelative } from '../../lib/format';

interface DashboardData {
  metrics: {
    resourceCount: number;
    publishedCount: number;
    totalDownloads: number;
    periodDownloads: number;
    uniqueDownloaders: number;
    userCount: number;
    newUsers: number;
    tutorialCount: number;
    openReports: number;
    openRequests: number;
  };
  attention: { failedUploads: number; publishedWithoutFile: number; openReports: number };
  trend: Array<{ date: string; count: number }>;
  topResources: Array<{
    id: string;
    title: string;
    slug: string;
    downloadCount: number;
    viewCount: number;
    thumbnailUrl: string | null;
    conversion: number | null;
  }>;
  topCategories: Array<{ id: string; name: string; slug: string; downloads: number; resourceCount: number }>;
  recentDownloads: Array<{
    id: string;
    at: string;
    who: string;
    device: string | null;
    resource: { title: string; slug: string };
    version: string | null;
  }>;
  recentSignups: Array<{ id: string; username: string; displayName: string; createdAt: string; verified: boolean }>;
  recentActivity: Array<{ id: string; action: string; actor: string; targetType: string | null; at: string }>;
}

/** Admin dashboard (PRD §40). Every number is real; nothing is decorative. */
export default function Dashboard() {
  const { data, loading } = useFetch<DashboardData>('/admin/dashboard?days=30');

  if (loading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const { metrics, attention } = data;
  const needsAttention =
    attention.publishedWithoutFile > 0 || attention.openReports > 0 || attention.failedUploads > 0;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-ink pb-4">
        <div>
          <p className="eyebrow">Admin</p>
          <h1 className="mt-2 text-[32px] leading-[1.05] md:text-[40px]">Dashboard</h1>
          <p className="mt-2 font-mono text-[12.5px] text-faint">Last 30 days</p>
        </div>
        <LinkButton to="/admin/resources/new" variant="primary" icon="plus">
          New resource
        </LinkButton>
      </header>

      {/* Things that actually need doing come before the metrics (PRD §40) */}
      {needsAttention ? (
        <div className="border-l-2 border-[color:var(--warn)] py-2 pl-5">
          <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-warn">
            <Icon name="alert" size={15} />
            Needs your attention
          </h2>
          <ul className="flex flex-col gap-1.5 text-[13.5px] text-soft">
            {attention.publishedWithoutFile > 0 ? (
              <li>
                <Link to="/admin/resources?status=PUBLISHED" className="link">
                  {attention.publishedWithoutFile} published{' '}
                  {attention.publishedWithoutFile === 1 ? 'resource has' : 'resources have'} no downloadable file
                </Link>
              </li>
            ) : null}
            {attention.openReports > 0 ? (
              <li>
                <Link to="/admin/reports" className="link">
                  {attention.openReports} open {attention.openReports === 1 ? 'report' : 'reports'}
                </Link>
              </li>
            ) : null}
            {attention.failedUploads > 0 ? (
              <li>{attention.failedUploads} uploads failed validation in the last 30 days</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
        <Metric label="Resources" value={metrics.resourceCount} sub={`${metrics.publishedCount} published`} />
        <Metric label="Downloads" value={metrics.totalDownloads} sub={`${formatCount(metrics.periodDownloads)} this period`} />
        <Metric label="Users" value={metrics.userCount} sub={`${metrics.newUsers} new`} />
        <Metric label="Tutorials" value={metrics.tutorialCount} sub={`${metrics.openRequests} open requests`} />
      </div>

      <Block title="Downloads" description={`${metrics.uniqueDownloaders} unique downloaders in 30 days`}>
        <TrendChart points={data.trend} />
      </Block>

      <div className="grid gap-5 lg:grid-cols-2">
        <Block title="Top resources" description="Views versus downloads">
          {data.topResources.length === 0 ? (
            <p className="py-3 text-[13.5px] text-faint">
              Nothing has been downloaded yet.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-[color:var(--rule)]">
              {data.topResources.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="well h-9 w-12 shrink-0 overflow-hidden rounded">
                    {r.thumbnailUrl ? <img src={r.thumbnailUrl} alt="" loading="lazy" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link
                      to={`/resources/${r.slug}`}
                      className="block truncate text-[13.5px] font-medium hover:text-blue"
                    >
                      {r.title}
                    </Link>
                    <span className="text-[12px] text-faint">
                      {r.viewCount} views · {r.downloadCount} downloads
                    </span>
                  </span>
                  {/* A low ratio is a signal, so it is called out rather than hidden */}
                  {r.conversion !== null ? (
                    <span
                      className={cx(
                        'shrink-0 font-mono text-[12px]',
                        r.conversion < 15 ? 'text-warn' : 'text-go',
                      )}
                      title="Downloads as a share of views"
                    >
                      {r.conversion}%
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Top categories">
          {data.topCategories.length === 0 ? (
            <p className="py-3 text-[13.5px] text-faint">No data yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {data.topCategories.map((c) => {
                const max = Math.max(...data.topCategories.map((x) => x.downloads), 1);
                return (
                  <li key={c.id}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="truncate">{c.name}</span>
                      <span className="shrink-0 font-mono text-[12px] text-faint">
                        {c.downloads}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-sunk">
                      <div
                        className="h-full rounded-full bg-blue"
                        style={{ width: `${Math.max(2, (c.downloads / max) * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Block>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Block title="Recent downloads">
          {data.recentDownloads.length === 0 ? (
            <p className="py-3 text-[13.5px] text-faint">No downloads yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[color:var(--rule)] text-[13px]">
              {data.recentDownloads.map((d) => (
                <li key={d.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                  <Link
                    to={`/resources/${d.resource.slug}`}
                    className="min-w-0 flex-1 truncate hover:text-blue"
                  >
                    {d.resource.title}
                  </Link>
                  <span className="shrink-0 text-[12px] text-faint">{d.who}</span>
                  <span className="shrink-0 text-[12px] text-faint">{formatRelative(d.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Recent activity">
          {data.recentActivity.length === 0 ? (
            <p className="py-3 text-[13.5px] text-faint">Nothing logged yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[color:var(--rule)] text-[13px]">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-soft">
                    {a.action}
                  </span>
                  <span className="shrink-0 text-[12px] text-faint">{formatRelative(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-display text-[34px] leading-none">{formatCount(value)}</p>
      <p className="mt-2 font-mono text-[11.5px] text-ghost">{sub}</p>
    </div>
  );
}

/**
 * Inline SVG sparkline. A real chart of real rows, with no charting library
 * shipped to the browser for one graph (PRD §5, §103).
 */
function TrendChart({ points }: { points: Array<{ date: string; count: number }> }) {
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.count), 1);
  const total = points.reduce((sum, p) => sum + p.count, 0);
  const width = 100;
  const height = 32;

  const path = points
    .map((p, i) => {
      const x = (i / Math.max(1, points.length - 1)) * width;
      const y = height - (p.count / max) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  if (total === 0) {
    return (
      <p className="py-4 text-[13.5px] text-faint">
        No downloads recorded in this period yet.
      </p>
    );
  }

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
        role="img"
        aria-label={`Downloads over the last ${points.length} days, ${total} total, peaking at ${max} in a day`}
      >
        <path d={`${path} L${width},${height} L0,${height} Z`} fill="var(--blue-wash-deep)" />
        <path d={path} fill="none" stroke="var(--blue)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-2 flex justify-between text-[11.5px] text-faint">
        <span>{points[0]?.date}</span>
        <span>{total} downloads</span>
        <span>{points[points.length - 1]?.date}</span>
      </figcaption>
    </figure>
  );
}
