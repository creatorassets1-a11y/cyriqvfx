import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, query } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import { formatRelative, titleCase } from '../../lib/format';
import { PageError } from '../../components/Chrome';
import { Button, Empty, Marker, Note, Skeleton, Textarea, cx } from '../../ui/primitives';

/**
 * The reports inbox.
 *
 * A report is somebody telling you a file is broken, which is the most
 * important message this site can receive. Each one keeps its own note and
 * state so nothing is answered twice or quietly forgotten.
 */

type Status = 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED';

interface Report {
  id: string;
  reason: string;
  details: string;
  status: Status;
  adminNote: string | null;
  contactEmail: string | null;
  createdAt: string;
  resource: { id: string; title: string; slug: string } | null;
  reportedBy: string;
}

const STATUSES: Array<{ value: '' | Status; label: string }> = [
  { value: '', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'REVIEWING', label: 'Reviewing' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'DISMISSED', label: 'Dismissed' },
];

export default function ReportsAdmin() {
  const [status, setStatus] = useState<'' | Status>('OPEN');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const { data, error, loading, reload } = useLoad<{ items: Report[]; total: number }>(
    `/admin/reports${query({ status })}`,
  );

  useTitle('Reports · Owner tools');

  async function update(report: Report, next: Status) {
    setFailure(null);
    try {
      await api.patch(`/admin/reports/${report.id}`, {
        status: next,
        adminNote: notes[report.id] ?? report.adminNote ?? null,
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
        <h1 className="text-[30px]">Reports</h1>
        <p className="mt-1.5 text-[13.5px] text-text-3">
          What visitors say is wrong. Guests can report too, so most of these have no account
          attached.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-5 border-y border-line py-3">
        {STATUSES.map((option) => (
          <button
            key={option.value || 'all'}
            type="button"
            onClick={() => setStatus(option.value)}
            className={cx(
              'text-[13px] transition-colors duration-fast ease-out',
              status === option.value ? 'text-accent' : 'text-text-3 hover:text-text',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {failure ? (
        <div className="mb-5">
          <Note tone="critical">{failure}</Note>
        </div>
      ) : null}

      {loading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : data && data.items.length ? (
        <ul className="flex flex-col">
          {data.items.map((report) => (
            <li key={report.id} className="border-b border-line py-5 first:border-t">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <Marker
                  tone={
                    report.status === 'OPEN'
                      ? 'critical'
                      : report.status === 'RESOLVED'
                        ? 'positive'
                        : 'neutral'
                  }
                >
                  {titleCase(report.status)}
                </Marker>
                <span className="text-[14px] text-text">{titleCase(report.reason)}</span>
                {report.resource ? (
                  <Link
                    to={`/resources/${report.resource.slug}`}
                    className="text-[13px] text-accent hover:underline"
                  >
                    {report.resource.title}
                  </Link>
                ) : null}
                <span className="ml-auto font-mono text-[11.5px] text-text-4">
                  {report.reportedBy} / {formatRelative(report.createdAt)}
                </span>
              </div>

              <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-text-2">
                {report.details}
              </p>

              {report.contactEmail ? (
                <p className="mt-1.5 font-mono text-[11.5px] text-text-4">
                  reply to {report.contactEmail}
                </p>
              ) : null}

              <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label htmlFor={`note-${report.id}`} className="sr-only">
                    Note on this report
                  </label>
                  <Textarea
                    id={`note-${report.id}`}
                    rows={2}
                    placeholder="What you did about it"
                    value={notes[report.id] ?? report.adminNote ?? ''}
                    onChange={(event) =>
                      setNotes((current) => ({ ...current, [report.id]: event.target.value }))
                    }
                  />
                </div>

                <div className="flex gap-2">
                  {report.status !== 'REVIEWING' ? (
                    <Button size="sm" onClick={() => update(report, 'REVIEWING')}>
                      Looking at it
                    </Button>
                  ) : null}
                  <Button size="sm" onClick={() => update(report, 'RESOLVED')}>
                    Resolved
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => update(report, 'DISMISSED')}>
                    Dismiss
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="flag" title="Nothing reported" body="No reports with that status." />
      )}
    </>
  );
}
