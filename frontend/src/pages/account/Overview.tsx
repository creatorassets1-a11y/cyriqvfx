import { Link } from 'react-router-dom';
import { useFetch } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import type { HistoryItem, ResourceCard as ResourceCardType } from '../../lib/api';
import { ResourceCard } from '../../components/ResourceCard';
import { Marker, EmptyState, LinkButton, Block, MoreLink, Skeleton } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { formatRelative } from '../../lib/format';

interface OverviewData {
  counts: { downloads: number; saved: number };
  recentDownloads: HistoryItem[];
  updatesAvailable: HistoryItem[];
  saved: ResourceCardType[];
}

export default function Overview() {
  const { user } = useAuth();
  const { data, loading } = useFetch<OverviewData>('/me/overview');

  if (loading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-20" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const nothingYet = data.counts.downloads === 0 && data.counts.saved === 0;

  return (
    <div className="flex flex-col gap-10">
      {!user?.emailVerifiedAt ? <VerifyBanner /> : null}

      <div className="grid grid-cols-2 gap-x-10 border-b border-rule pb-6">
        <StatCard label="Downloads" value={data.counts.downloads} to="/account/downloads" icon="history" />
        <StatCard label="Saved" value={data.counts.saved} to="/account/saved" icon="bookmark" />
      </div>

      {/* Update alerts are the reason to have an account at all (PRD §22) */}
      {data.updatesAvailable.length > 0 ? (
        <Block title="Updates available" description="New versions of things you downloaded.">
          <ul className="flex flex-col">
            {data.updatesAvailable.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/resources/${item.slug}`}
                  className="group flex items-center gap-3 border-b border-rule py-3 first:border-t"
                >
                  <span className="well h-10 w-14 shrink-0">
                    {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium group-hover:text-blue">
                      {item.title}
                    </span>
                    <span className="block font-mono text-[12px] text-ghost">
                      you have v{item.downloadedVersion}, v{item.currentVersion} is out
                    </span>
                  </span>
                  <Marker tone="go">Update</Marker>
                </Link>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {nothingYet ? (
        <EmptyState
          icon="download"
          title="Your library is empty so far"
          description="Anything you download or save will show up here."
          action={<LinkButton to="/resources" variant="primary">Browse resources</LinkButton>}
        />
      ) : null}

      {data.recentDownloads.length > 0 ? (
        <Block
          title="Recent downloads"
          action={
            <MoreLink to="/account/downloads">See all</MoreLink>
          }
        >
          <ul className="flex flex-col">
            {data.recentDownloads.map((item) => (
              <li key={item.id} className="border-b border-rule">
                <Link
                  to={`/resources/${item.slug}`}
                  className="group flex items-center gap-3 py-3"
                >
                  <span className="well h-10 w-14 shrink-0">
                    {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium group-hover:text-blue">
                      {item.title}
                    </span>
                    <span className="block text-[12px] text-faint">
                      {formatRelative(item.downloadedAt)}
                      {item.downloadedVersion ? `, v${item.downloadedVersion}` : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {data.saved.length > 0 ? (
        <section className="border-t border-rule pt-6">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h2 className="font-sans text-[15px] font-semibold text-ink">Saved</h2>
            <MoreLink to="/account/saved">See all</MoreLink>
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-10 min-[560px]:grid-cols-2">
            {data.saved.map((r) => (
              <ResourceCard key={r.id} resource={r} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  to,
  icon,
}: {
  label: string;
  value: number;
  to: string;
  icon: 'history' | 'bookmark';
}) {
  return (
    <Link to={to} className="group min-w-0">
      <span className="eyebrow flex items-center gap-2 transition-colors duration-fast group-hover:text-blue">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <p className="mt-2 font-display text-[38px] leading-none">{value}</p>
    </Link>
  );
}

function VerifyBanner() {
  return (
    <div className="flex items-start gap-2.5 border-l-2 border-[color:var(--warn)] py-1 pl-4">
      <Icon name="info" size={16} className="mt-0.5 shrink-0 text-warn" />
      <p className="flex-1 text-[13.5px] leading-relaxed text-soft">
        Your email is not confirmed yet. Confirm it to turn on email notifications. Everything else
        already works.{' '}
        <Link to="/account/profile" className="link font-medium">
          Resend the link
        </Link>
      </p>
    </div>
  );
}
