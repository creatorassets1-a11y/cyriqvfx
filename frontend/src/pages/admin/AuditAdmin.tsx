import { useState } from 'react';
import { useFetch } from '../../lib/hooks';
import { Button, EmptyState, Skeleton } from '../../components/ui';
import { formatRelative } from '../../lib/format';

interface Entry {
  id: string;
  action: string;
  actor: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** Audit log (PRD §48). Actor, action, target, time. No secrets. */
export default function AuditAdmin() {
  const [page, setPage] = useState(1);
  const { data, loading } = useFetch<{ items: Entry[]; total: number; totalPages: number }>(
    `/admin/audit?page=${page}`,
    [page],
  );

  if (loading && !data) return <Skeleton className="h-96" />;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[30px] leading-tight md:text-[34px]">Audit log</h1>
        <p className="text-[13.5px] text-soft">{data?.total ?? 0} recorded actions.</p>
      </header>

      {!data || data.items.length === 0 ? (
        <EmptyState icon="shield" title="Nothing logged yet" description="Admin actions are recorded here as they happen." />
      ) : (
        <>
          <div className="scroll-x border-t border-rule">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="border-b border-rule-strong">
                <tr>
                  <th scope="col" className="px-3.5 py-2.5 font-semibold">Action</th>
                  <th scope="col" className="px-3.5 py-2.5 font-semibold">Actor</th>
                  <th scope="col" className="px-3.5 py-2.5 font-semibold">Target</th>
                  <th scope="col" className="px-3.5 py-2.5 font-semibold">Details</th>
                  <th scope="col" className="px-3.5 py-2.5 text-right font-semibold">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--rule)]">
                {data.items.map((e) => (
                  <tr key={e.id} className="border-b border-rule">
                    <td className="px-3.5 py-2.5 font-mono text-[12px]">{e.action}</td>
                    <td className="px-3.5 py-2.5 text-soft">{e.actor}</td>
                    <td className="px-3.5 py-2.5 text-faint">{e.targetType ?? 'None'}</td>
                    <td className="max-w-[220px] truncate px-3.5 py-2.5 text-faint">
                      {e.metadata && Object.keys(e.metadata).length > 0
                        ? Object.entries(e.metadata).map(([k, v]) => `${k}: ${String(v)}`).join(', ')
                        : 'None'}
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-2.5 text-right text-faint">
                      {formatRelative(e.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.totalPages > 1 ? (
            <div className="flex items-center justify-center gap-3">
              <Button size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-[13px] text-faint">Page {page} of {data.totalPages}</span>
              <Button size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
