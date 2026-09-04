import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import { formatRelative, titleCase } from '../../lib/format';
import { PageError } from '../../components/Chrome';
import { Button, Empty, Marker, Note, Select, Skeleton, Textarea } from '../../ui/primitives';
import type { ResourceRequest } from '../../lib/types';

/**
 * What people have asked for, most-wanted first. Answering here writes back to
 * the public board, so a request never disappears into a private inbox.
 */

const STATUSES = ['RECEIVED', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED'] as const;

export default function RequestsAdmin() {
  const { data, error, loading, reload } = useLoad<{ items: ResourceRequest[] }>('/admin/requests');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  useTitle('Requests · Owner tools');

  async function update(request: ResourceRequest, status: string) {
    setFailure(null);
    try {
      await api.patch(`/admin/requests/${request.id}`, {
        status,
        adminNote: notes[request.id] ?? request.adminNote ?? null,
      });
      reload();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'That could not be updated.');
    }
  }

  if (error) return <PageError onRetry={reload} />;

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[30px]">Requests</h1>
        <p className="mt-1.5 text-[13.5px] text-text-3">
          What people want next, ordered by how many agree. Your note here is shown publicly.
        </p>
      </header>

      {failure ? (
        <div className="mb-5">
          <Note tone="critical">{failure}</Note>
        </div>
      ) : null}

      {loading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : data && data.items.length ? (
        <ul className="flex flex-col">
          {data.items.map((request) => (
            <li key={request.id} className="flex gap-5 border-b border-line py-5 first:border-t">
              <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded border border-line-strong">
                <span className="font-mono text-[14px] text-accent">{request.voteCount}</span>
                <span className="text-[9.5px] uppercase tracking-wider text-text-4">votes</span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <p className="text-[14.5px] text-text">{request.title}</p>
                  <Marker tone={request.status === 'COMPLETED' ? 'positive' : 'neutral'}>
                    {titleCase(request.status)}
                  </Marker>
                  <span className="ml-auto font-mono text-[11.5px] text-text-4">
                    {request.requestedBy} / {formatRelative(request.createdAt)}
                  </span>
                </div>

                <p className="mt-1.5 text-[13.5px] leading-relaxed text-text-2">
                  {request.description}
                </p>

                <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label htmlFor={`request-note-${request.id}`} className="sr-only">
                      Public note on this request
                    </label>
                    <Textarea
                      id={`request-note-${request.id}`}
                      rows={2}
                      placeholder="Shown on the public request board"
                      value={notes[request.id] ?? request.adminNote ?? ''}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [request.id]: event.target.value }))
                      }
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <label htmlFor={`request-status-${request.id}`} className="sr-only">
                      Status of this request
                    </label>
                    <Select
                      id={`request-status-${request.id}`}
                      value={request.status}
                      onChange={(event) => update(request, event.target.value)}
                      className="w-auto"
                    >
                      {STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {titleCase(status)}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" onClick={() => update(request, request.status)}>
                      Save note
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="flag" title="No requests yet" body="Nobody has asked for anything." />
      )}
    </>
  );
}
