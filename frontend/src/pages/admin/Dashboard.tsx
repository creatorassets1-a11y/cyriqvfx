import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoad, useTitle } from '../../lib/hooks';
import { formatExact, formatRelative, titleCase } from '../../lib/format';
import { PageError } from '../../components/Chrome';
import { ButtonLink, Note, Skeleton, cx } from '../../ui/primitives';

/**
 * The dashboard.
 *
 * It answers two questions and nothing else: is anything wrong, and what is
 * happening. Every number on it is counted from real rows — there is no
 * placeholder anywhere in this screen, so a zero means zero.
 */

interface DashboardPayload {
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
    conversion: number | null;
  }>;
  topCategories: Array<{ id: string; name: string; downloads: number; resourceCount: number }>;
  recentDownloads: Array<{
    id: string;
    at: string;
    who: string;
    device: string | null;
    resource: { title: string; slug: string };
    version: string | null;
  }>;
  recentSignups: Array<{ id: string; username: string; createdAt: string; verified: boolean }>;
  recentActivity: Array<{ id: string; action: string; actor: string; at: string }>;
}

const RANGES = [7, 30, 90];

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useLoad<DashboardPayload>(
    `/admin/dashboard?days=${days}`,
  );

  useTitle('Dashboard · Cyriq VFX');

  if (error) return <PageError onRetry={reload} />;

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px]">Dashboard</h1>
          <p className="mt-1.5 text-[13.5px] text-text-3">
            The last {days} days, counted from real activity.
          </p>
        </div>

        <div className="flex items-center gap-4">
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
          <ButtonLink to="/admin/resources/new" size="sm" variant="primary" icon="plus">
            New resource
          </ButtonLink>
        </div>
      </header>

      {loading && !data ? (
        <Skeleton className="h-40 w-full" />
      ) : data ? (
        <>
          {data.attention.publishedWithoutFile > 0 ||
          data.attention.failedUploads > 0 ||
          data.attention.openReports > 0 ? (
            <div className="mb-8 flex flex-col gap-2">
              {data.attention.publishedWithoutFile > 0 ? (
                <Note tone="critical">
                  {data.attention.publishedWithoutFile} published{' '}
                  {data.attention.publishedWithoutFile === 1 ? 'resource has' : 'resources have'} no
                  downloadable file.{' '}
                  <Link to="/admin/resources?status=PUBLISHED" className="underlined">
                    Fix them
                  </Link>
                </Note>
              ) : null}
              {data.attention.openReports > 0 ? (
                <Note tone="caution">
                  {data.attention.openReports} open{' '}
                  {data.attention.openReports === 1 ? 'report' : 'reports'} waiting.{' '}
                  <Link to="/admin/reports" className="underlined">
                    Read them
                  </Link>
                </Note>
              ) : null}
              {data.attention.failedUploads > 0 ? (
                <Note tone="caution">
                  {data.attention.failedUploads} uploads failed in this period.
                </Note>
              ) : null}
            </div>
          ) : null}

          <dl className="mb-10 grid grid-cols-2 gap-x-8 gap-y-6 border-y border-line py-6 md:grid-cols-4">
            <Metric label="Resources" value={formatExact(data.metrics.resourceCount)} note={`${data.metrics.publishedCount} published`} />
            <Metric label="Downloads" value={formatExact(data.metrics.periodDownloads)} note={`${formatExact(data.metrics.totalDownloads)} all time`} />
            <Metric label="Tutorials" value={formatExact(data.metrics.tutorialCount)} />
            <Metric label="Accounts" value={formatExact(data.metrics.userCount)} note={`${data.metrics.newUsers} new`} />
          </dl>

          <Trend trend={data.trend} />

          <div className="mt-10 grid gap-10 lg:grid-cols-2">
            <Panel title="Most downloaded">
              <ol className="flex flex-col">
                {data.topResources.map((resource) => (
                  <li
                    key={resource.id}
                    className="flex items-baseline gap-4 border-b border-line py-2.5 first:border-t"
                  >
                    <Link
                      to={`/resources/${resource.slug}`}
                      className="min-w-0 flex-1 truncate text-[13.5px] text-text-2 hover:text-accent"
                    >
                      {resource.title}
                    </Link>
                    <span className="font-mono text-[12px] text-text-3">
                      {formatExact(resource.downloadCount)}
                    </span>
                    {resource.conversion !== null ? (
                      <span
                        className={cx(
                          'w-12 text-right font-mono text-[11.5px]',
                          resource.conversion < 15 ? 'text-caution' : 'text-text-4',
                        )}
                        title="Downloads as a share of views"
                      >
                        {resource.conversion}%
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel title="Latest downloads">
              <ol className="flex flex-col">
                {data.recentDownloads.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-baseline gap-4 border-b border-line py-2.5 first:border-t"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-text-2">
                      {event.resource.title}
                      {event.version ? (
                        <span className="ml-2 font-mono text-[11.5px] text-text-4">
                          v{event.version}
                        </span>
                      ) : null}
                    </span>
                    <span className="font-mono text-[11.5px] text-text-4">{event.who}</span>
                    <span className="w-16 text-right font-mono text-[11.5px] text-text-4">
                      {formatRelative(event.at)}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel title="Categories by downloads">
              <ol className="flex flex-col">
                {data.topCategories.map((category) => (
                  <li
                    key={category.id}
                    className="flex items-baseline gap-4 border-b border-line py-2.5 first:border-t"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-text-2">
                      {category.name}
                    </span>
                    <span className="font-mono text-[11.5px] text-text-4">
                      {category.resourceCount} files
                    </span>
                    <span className="w-16 text-right font-mono text-[12px] text-text-3">
                      {formatExact(category.downloads)}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel title="Recent activity">
              <ol className="flex flex-col">
                {data.recentActivity.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-baseline gap-4 border-b border-line py-2.5 first:border-t"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-text-2">
                      {titleCase(entry.action.replace(/\./g, ' '))}
                    </span>
                    <span className="font-mono text-[11.5px] text-text-4">{entry.actor}</span>
                    <span className="w-16 text-right font-mono text-[11.5px] text-text-4">
                      {formatRelative(entry.at)}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
        </>
      ) : null}
    </>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="kicker">{label}</dt>
      <dd className="mt-1 font-mono text-[26px] leading-none text-text">{value}</dd>
      {note ? <p className="mt-1.5 text-[12px] text-text-4">{note}</p> : null}
    </div>
  );
}

/**
 * The download trend as bars. It is drawn from the same numbers the table
 * shows, at a scale set by the highest day, so a quiet week cannot be made to
 * look like a busy one.
 */
function Trend({ trend }: { trend: Array<{ date: string; count: number }> }) {
  const peak = Math.max(1, ...trend.map((day) => day.count));

  return (
    <section>
      <h2 className="kicker mb-3 border-b border-line pb-2">Downloads per day</h2>
      <div className="flex h-24 items-end gap-[2px]" role="img" aria-label={`Downloads per day, peak ${peak}`}>
        {trend.map((day) => (
          <div
            key={day.date}
            className="min-w-[2px] flex-1 bg-accent-dim transition-colors duration-fast ease-out hover:bg-accent"
            style={{ height: `${Math.max(2, (day.count / peak) * 100)}%` }}
            title={`${day.date}: ${day.count}`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-text-4">
        <span>{trend[0]?.date}</span>
        <span>peak {peak}</span>
        <span>{trend[trend.length - 1]?.date}</span>
      </div>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="kicker mb-3 border-b border-line pb-2">{title}</h2>
      {children}
    </section>
  );
}
