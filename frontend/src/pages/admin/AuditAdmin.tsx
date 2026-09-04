import { useState } from 'react';
import { query } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import { formatRelative } from '../../lib/format';
import { PageError } from '../../components/Chrome';
import { Empty, Input, Pagination, Skeleton } from '../../ui/primitives';

/**
 * The audit log.
 *
 * Every administrative action writes a row here — who, what, when, and enough
 * detail to answer "when did that change?" months later. It is read-only by
 * design: a log that can be edited is not a log.
 */

interface Entry {
  id: string;
  action: string;
  actor: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}

export default function AuditAdmin() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  const { data, error, loading, reload } = useLoad<{
    items: Entry[];
    total: number;
    page: number;
    totalPages: number;
  }>(`/admin/audit${query({ action, page: page > 1 ? page : undefined })}`);

  useTitle('Audit log · Owner tools');

  if (error) return <PageError onRetry={reload} />;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px]">Audit log</h1>
          <p className="mt-1.5 text-[13.5px] text-text-3">
            Every administrative action, in order.
          </p>
        </div>

        <div className="w-full sm:w-64">
          <label htmlFor="audit-filter" className="sr-only">
            Filter by action
          </label>
          <Input
            id="audit-filter"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
            placeholder="resource.published"
          />
        </div>
      </header>

      {loading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : data && data.items.length ? (
        <>
          <ul className="flex flex-col">
            {data.items.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line py-2.5 first:border-t"
              >
                <span className="font-mono text-[12.5px] text-accent">{entry.action}</span>
                <span className="text-[13px] text-text-2">{entry.actor}</span>
                {entry.targetType ? (
                  <span className="font-mono text-[11.5px] text-text-4">{entry.targetType}</span>
                ) : null}
                {entry.metadata ? (
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-4">
                    {JSON.stringify(entry.metadata)}
                  </span>
                ) : null}
                <span className="ml-auto font-mono text-[11.5px] text-text-4">
                  {formatRelative(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>

          <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </>
      ) : (
        <Empty icon="list" title="Nothing logged yet" body="Administrative actions appear here." />
      )}
    </>
  );
}
