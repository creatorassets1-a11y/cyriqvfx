import { Link } from 'react-router-dom';
import { useFetch, useTitle } from '../lib/hooks';
import { Marker, EmptyState, LinkButton, Skeleton } from '../components/ui';
import { formatDate } from '../lib/format';
import { PageError } from '../components/Layout';

interface Entry {
  id: string;
  title: string;
  slug: string;
  body: string;
  kind: 'RELEASE' | 'UPDATE' | 'SITE' | 'ANNOUNCEMENT';
  publishedAt: string | null;
  resources: Array<{ id: string; title: string; slug: string; thumbnailUrl: string | null }>;
  tutorials: Array<{ id: string; title: string; slug: string }>;
}

const KIND_TONE = {
  RELEASE: 'blue',
  UPDATE: 'go',
  SITE: 'neutral',
  ANNOUNCEMENT: 'warn',
} as const;

const KIND_LABEL = {
  RELEASE: 'New release',
  UPDATE: 'Updated',
  SITE: 'Site',
  ANNOUNCEMENT: 'Announcement',
} as const;

export default function Updates() {
  const { data, loading, error, reload } = useFetch<{ items: Entry[] }>('/updates');
  useTitle('Updates and releases · Cyriq VFX');

  if (error) return <PageError onRetry={reload} />;

  return (
    <div className="page py-10 md:py-16">
      <header className="border-b border-ink pb-4">
        <p className="eyebrow">The log</p>
        <h1 className="mt-2 text-[38px] leading-[1.05] md:text-[52px]">Updates</h1>
        <p className="copy mt-3">New releases, resource updates and changes to the site.</p>
      </header>

      {loading ? (
        <div className="mt-10 flex flex-col gap-8">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon="history"
          title="No updates posted yet"
          description="Releases and changes will show up here as they happen."
          action={<LinkButton to="/resources">Browse resources</LinkButton>}
        />
      ) : (
        // A timeline reads better than another card grid for chronological content.
        // Chronological content reads better as dated entries than as a card
        // grid: the date column is the spine, and the rules do the separating.
        <ol className="mt-4 flex flex-col">
          {data.items.map((entry) => (
            <li
              key={entry.id}
              className="grid gap-x-10 gap-y-3 border-b border-rule py-8 md:grid-cols-[10rem_minmax(0,1fr)]"
            >
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 md:flex-col md:items-start md:gap-2">
                <time
                  className="font-mono text-[12.5px] text-faint"
                  dateTime={entry.publishedAt ?? undefined}
                >
                  {formatDate(entry.publishedAt)}
                </time>
                <Marker tone={KIND_TONE[entry.kind]}>{KIND_LABEL[entry.kind]}</Marker>
              </div>

              <div className="min-w-0">
                <h2 className="text-[24px] leading-tight md:text-[28px]">{entry.title}</h2>
                <p className="copy mt-3 whitespace-pre-line">{entry.body}</p>

                {entry.resources.length > 0 || entry.tutorials.length > 0 ? (
                  <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-3">
                    {entry.resources.map((r) => (
                      <Link
                        key={r.id}
                        to={`/resources/${r.slug}`}
                        className="group inline-flex items-center gap-2.5 text-[13.5px]"
                      >
                        <span className="well h-8 w-12">
                          {r.thumbnailUrl ? (
                            <img src={r.thumbnailUrl} alt="" loading="lazy" />
                          ) : null}
                        </span>
                        <span className="underline decoration-rule-strong underline-offset-4 transition-colors duration-fast group-hover:text-blue group-hover:decoration-blue">
                          {r.title}
                        </span>
                      </Link>
                    ))}
                    {entry.tutorials.map((t) => (
                      <Link
                        key={t.id}
                        to={`/tutorials/${t.slug}`}
                        className="text-[13.5px] underline decoration-rule-strong underline-offset-4 transition-colors duration-fast hover:text-blue hover:decoration-blue"
                      >
                        {t.title}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
