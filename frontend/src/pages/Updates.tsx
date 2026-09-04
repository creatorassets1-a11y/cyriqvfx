import { Link, useSearchParams } from 'react-router-dom';
import { query } from '../lib/api';
import { useLoad } from '../lib/hooks';
import type { ChangelogEntry } from '../lib/types';
import { formatDate, titleCase } from '../lib/format';
import { PageError } from '../components/Chrome';
import { Empty, Marker, Pagination, Skeleton } from '../ui/primitives';

/**
 * What has changed.
 *
 * Releases, updated files and site changes in one dated list, with every
 * entry linking the resources it is about — so "1.4 fixed the marker spacing"
 * is one click away from the file that contains the fix.
 */

const TONES: Record<string, 'accent' | 'positive' | 'neutral' | 'caution'> = {
  RELEASE: 'accent',
  UPDATE: 'positive',
  SITE: 'neutral',
  ANNOUNCEMENT: 'caution',
};

interface Payload {
  items: ChangelogEntry[];
  total: number;
  page: number;
  totalPages: number;
}

export default function Updates() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1');
  const { data, error, loading, reload } = useLoad<Payload>(
    `/updates${query({ page: page > 1 ? page : undefined })}`,
  );

  if (error) return <PageError onRetry={reload} />;

  return (
    <div className="page py-10 md:py-14">
      <header className="mb-10">
        <h1 className="text-[34px] md:text-[42px]">Updates</h1>
        <p className="prose mt-3">
          New releases, updated files and changes to the site. Every entry links what it changed.
        </p>
      </header>

      {loading && !data ? (
        <div className="flex flex-col gap-8">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : data && data.items.length ? (
        <>
          <ol className="flex flex-col">
            {data.items.map((entry) => (
              <li key={entry.id} className="border-b border-line py-8 first:border-t">
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                  <Marker tone={TONES[entry.kind] ?? 'neutral'}>{titleCase(entry.kind)}</Marker>
                  <span className="font-mono text-[12px] text-text-4">
                    {formatDate(entry.publishedAt)}
                  </span>
                </div>

                <h2 className="mt-2 text-[24px]">{entry.title}</h2>
                <div className="prose mt-3 whitespace-pre-line">{entry.body}</div>

                {entry.resources.length ? (
                  <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                    {entry.resources.map((resource) => (
                      <li key={resource.id}>
                        <Link
                          to={`/resources/${resource.slug}`}
                          className="inline-flex items-center gap-2 rounded-full border border-line-strong px-3 py-1 text-[13px] text-text-2 hover:border-accent hover:text-accent"
                        >
                          {resource.title}
                          {resource.version ? (
                            <span className="font-mono text-[11.5px] text-text-4">
                              v{resource.version}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>

          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            onPage={(next) =>
              setParams((current) => {
                const params2 = new URLSearchParams(current);
                params2.set('page', String(next));
                return params2;
              })
            }
          />
        </>
      ) : (
        <Empty
          icon="calendar"
          title="No updates published yet"
          body="When something is released or changed, it will be listed here."
        />
      )}
    </div>
  );
}
