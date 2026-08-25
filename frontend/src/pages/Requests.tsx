import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch, useTitle } from '../lib/hooks';
import {
  Marker,
  Button,
  cx,
  EmptyState,
  MoreLink,
  Sheet,
  Skeleton,
  TextArea,
  TextField,
  useToast,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { formatRelative } from '../lib/format';
import { PageError } from '../components/Layout';

interface RequestItem {
  id: string;
  title: string;
  description: string;
  software: string | null;
  status: 'RECEIVED' | 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED';
  adminNote: string | null;
  voteCount: number;
  createdAt: string;
  voted: boolean;
}

const STATUS = {
  RECEIVED: { label: 'Received', tone: 'neutral' },
  PLANNED: { label: 'Planned', tone: 'blue' },
  IN_PROGRESS: { label: 'In progress', tone: 'warn' },
  COMPLETED: { label: 'Done', tone: 'go' },
  DECLINED: { label: 'Not planned', tone: 'neutral' },
} as const;

/** Resource requests (PRD §26). Shows what editors actually want. */
export default function Requests() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data, loading, error, reload } = useFetch<{ items: RequestItem[] }>('/requests');
  const [formOpen, setFormOpen] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);

  useTitle('Requests · Cyriq VFX');

  const vote = async (item: RequestItem) => {
    if (!user) {
      toast('Sign in to vote on requests.', 'info');
      return;
    }
    setVotingId(item.id);
    try {
      await api.post(`/requests/${item.id}/vote`);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That vote did not go through.', 'error');
    } finally {
      setVotingId(null);
    }
  };

  if (error) return <PageError onRetry={reload} />;

  return (
    <div className="page py-10 md:py-16">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-ink pb-4">
        <div className="min-w-0">
          <p className="eyebrow">Wanted</p>
          <h1 className="mt-2 text-[38px] leading-[1.05] md:text-[52px]">Requests</h1>
          <p className="copy mt-3">
            What editors have asked for, and what is being worked on. Vote for what you want next.
          </p>
        </div>
        {user ? (
          <Button variant="primary" icon="plus" onClick={() => setFormOpen(true)}>
            Request something
          </Button>
        ) : (
          <MoreLink to="/login">Sign in to request</MoreLink>
        )}
      </header>

      {loading ? (
        <div className="mt-8 flex flex-col gap-6">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon="inbox"
          title="No requests yet"
          description="Be the first to ask for something: a tool, a pack, or a tutorial topic."
          action={
            user ? (
              <Button variant="primary" onClick={() => setFormOpen(true)}>
                Request something
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="mt-4 flex flex-col">
          {data.items.map((item) => {
            const status = STATUS[item.status];
            return (
              <li key={item.id} className="flex gap-6 border-b border-rule py-6">
                <button
                  onClick={() => vote(item)}
                  disabled={votingId === item.id}
                  aria-pressed={item.voted}
                  aria-label={
                    item.voted ? `Remove your vote from ${item.title}` : `Vote for ${item.title}`
                  }
                  className={cx(
                    'flex w-12 shrink-0 flex-col items-center gap-0.5 self-start transition-colors duration-fast',
                    item.voted ? 'text-blue' : 'text-ghost hover:text-ink',
                  )}
                >
                  <Icon name="chevron-down" size={16} className="rotate-180" />
                  <span className="font-mono text-[15px]">{item.voteCount}</span>
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
                    <h2 className="font-display text-[20px] leading-tight">{item.title}</h2>
                    <Marker tone={status.tone}>{status.label}</Marker>
                    {item.software ? <Marker tone="neutral">{item.software}</Marker> : null}
                  </div>
                  <p className="mt-2 text-[14px] leading-relaxed text-soft">{item.description}</p>
                  {item.adminNote ? (
                    <p className="mt-3 flex items-start gap-2 border-l-2 border-blue pl-4 text-[13.5px] text-soft">
                      <Icon name="info" size={13} className="mt-1 shrink-0 text-blue" />
                      {item.adminNote}
                    </p>
                  ) : null}
                  <p className="mt-3 font-mono text-[11.5px] text-ghost">
                    {formatRelative(item.createdAt)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <RequestForm open={formOpen} onClose={() => setFormOpen(false)} onCreated={reload} />
    </div>
  );
}

function RequestForm({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [software, setSoftware] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/requests', {
        title,
        description,
        software: software || null,
      });
      toast('Request posted.', 'success');
      setTitle('');
      setDescription('');
      setSoftware('');
      onCreated();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err);
        toast(err.message, 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Request a resource"
      footer={
        <Button variant="primary" fullWidth loading={busy} onClick={submit}>
          Post request
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="What do you need?"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="A script that renames layers by their contents"
          error={error?.fieldError('title')}
          data-autofocus
        />
        <TextArea
          label="Why would it help?"
          required
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the workflow problem it would solve."
          error={error?.fieldError('description')}
        />
        <TextField
          label="Software"
          value={software}
          onChange={(e) => setSoftware(e.target.value)}
          placeholder="After Effects"
          hint="Optional."
        />
      </div>
    </Sheet>
  );
}
