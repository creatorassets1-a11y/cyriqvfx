import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useFetch } from '../../lib/hooks';
import { Marker, Button, EmptyState, Block, Skeleton, TextArea, useToast } from '../../components/ui';
import { formatRelative } from '../../lib/format';

interface Report {
  id: string;
  reason: string;
  details: string;
  status: 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED';
  adminNote: string | null;
  contactEmail: string | null;
  createdAt: string;
  resource: { id: string; title: string; slug: string } | null;
  reportedBy: string;
}

const REASON_LABEL: Record<string, string> = {
  BROKEN_RESOURCE: 'Broken file',
  BROKEN_DOWNLOAD: 'Broken download',
  INCORRECT_COMPATIBILITY: 'Wrong compatibility',
  LICENSING: 'Licensing',
  MALICIOUS_FILE: 'Suspicious file',
  COPYRIGHT: 'Copyright',
  OTHER: 'Other',
};

/** Reports inbox (PRD §47). */
export default function ReportsAdmin() {
  const { toast } = useToast();
  const [status, setStatus] = useState<string>('OPEN');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { data, loading, reload } = useFetch<{ items: Report[]; total: number }>(
    `/admin/reports?status=${status}`,
    [status],
  );

  const update = async (report: Report, nextStatus: string) => {
    try {
      await api.patch(`/admin/reports/${report.id}`, {
        status: nextStatus,
        adminNote: notes[report.id] ?? report.adminNote,
      });
      toast('Report updated.', 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work.', 'error');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[30px] leading-tight md:text-[34px]">Reports</h1>

      <div className="flex flex-wrap gap-2">
        {['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'].map((s) => (
          <Button key={s} size="sm" variant={status === s ? 'primary' : 'quiet'} onClick={() => setStatus(s)}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </Button>
        ))}
      </div>

      {loading && !data ? (
        <Skeleton className="h-64" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon="flag"
          title={status === 'OPEN' ? 'No open reports' : 'Nothing here'}
          description={status === 'OPEN' ? 'Nothing needs your attention right now.' : 'No reports with that status.'}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {data.items.map((r) => (
            <Block key={r.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Marker tone={r.reason === 'MALICIOUS_FILE' ? 'stop' : 'warn'}>
                  {REASON_LABEL[r.reason] ?? r.reason}
                </Marker>
                {r.resource ? (
                  <Link to={`/resources/${r.resource.slug}`} className="text-[13.5px] font-medium hover:text-blue">
                    {r.resource.title}
                  </Link>
                ) : (
                  <span className="text-[13.5px] text-faint">No resource attached</span>
                )}
                <span className="ml-auto text-[12px] text-faint">
                  {r.reportedBy} · {formatRelative(r.createdAt)}
                </span>
              </div>

              <p className="mt-2.5 whitespace-pre-line text-[13.5px] leading-relaxed text-soft">{r.details}</p>

              {r.contactEmail ? (
                <p className="mt-2 font-mono text-[12px] text-faint">{r.contactEmail}</p>
              ) : null}

              <div className="mt-3.5">
                <TextArea
                  label="Note"
                  rows={2}
                  value={notes[r.id] ?? r.adminNote ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                  placeholder="What you did about it."
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => update(r, 'RESOLVED')}>Mark resolved</Button>
                <Button size="sm" onClick={() => update(r, 'REVIEWING')}>Reviewing</Button>
                <Button size="sm" variant="quiet" onClick={() => update(r, 'DISMISSED')}>Dismiss</Button>
              </div>
            </Block>
          ))}
        </div>
      )}
    </div>
  );
}
