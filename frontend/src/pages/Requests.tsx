import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { ResourceRequest } from '../lib/types';
import { formatRelative, titleCase } from '../lib/format';
import { PageError } from '../components/Chrome';
import { Icon } from '../ui/Icon';
import { Button, Empty, Field, Input, Marker, Note, Textarea, cx } from '../ui/primitives';
import { useToast } from '../ui/Toast';

/**
 * Requests.
 *
 * What people ask for is the clearest signal about what to make next, so the
 * board is public and the votes are visible. Asking and voting need an account
 * — not to gate anything, but because a vote has to belong to someone to mean
 * anything at all.
 */

const TONES: Record<string, 'neutral' | 'accent' | 'positive' | 'caution'> = {
  RECEIVED: 'neutral',
  PLANNED: 'accent',
  IN_PROGRESS: 'accent',
  COMPLETED: 'positive',
  DECLINED: 'caution',
};

export default function Requests() {
  const { user } = useSession();
  const { toast } = useToast();
  const { data, error, loading, reload } = useLoad<{ items: ResourceRequest[] }>('/requests');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [software, setSoftware] = useState('');
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setFailure(null);

    try {
      await api.post('/requests', {
        title,
        description,
        software: software || null,
      });
      setTitle('');
      setDescription('');
      setSoftware('');
      toast('Request posted. Thanks.', 'success');
      reload();
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
      else toast('That could not be sent.', 'error');
    } finally {
      setSending(false);
    }
  }

  async function vote(request: ResourceRequest) {
    try {
      await api.post(`/requests/${request.id}/vote`);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That vote did not register.', 'error');
    }
  }

  if (error) return <PageError onRetry={reload} />;

  return (
    <div className="page py-10 md:py-14">
      <header className="mb-10 max-w-2xl">
        <h1 className="text-[34px] md:text-[42px]">Request a resource</h1>
        <p className="prose mt-3">
          Missing something you keep needing? Ask for it here, and vote for what other editors have
          already asked for. What gets made next comes off this list.
        </p>
      </header>

      <div className="grid gap-12 lg:grid-cols-[1fr_340px] lg:gap-16">
        <div className="min-w-0">
          {loading && !data ? null : data && data.items.length ? (
            <ul className="flex flex-col">
              {data.items.map((request) => (
                <li key={request.id} className="flex gap-5 border-b border-line py-5 first:border-t">
                  <button
                    type="button"
                    onClick={() => (user ? vote(request) : undefined)}
                    disabled={!user}
                    aria-label={`Vote for ${request.title}`}
                    aria-pressed={request.voted ?? false}
                    className={cx(
                      'flex h-14 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded border transition-colors duration-fast ease-out',
                      request.voted
                        ? 'border-accent text-accent'
                        : 'border-line-strong text-text-3',
                      user ? 'hover:border-accent hover:text-accent' : 'cursor-default opacity-70',
                    )}
                  >
                    <Icon name="chevron-up" size={14} />
                    <span className="font-mono text-[13px]">{request.voteCount}</span>
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <h2 className="font-sans text-[15.5px] font-semibold">{request.title}</h2>
                      <Marker tone={TONES[request.status] ?? 'neutral'}>
                        {titleCase(request.status)}
                      </Marker>
                      <span className="ml-auto font-mono text-[11.5px] text-text-4">
                        {formatRelative(request.createdAt)}
                      </span>
                    </div>

                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-text-2">
                      {request.description}
                    </p>

                    {request.software ? (
                      <p className="mt-1.5 font-mono text-[11.5px] text-text-4">
                        {request.software}
                      </p>
                    ) : null}

                    {request.adminNote ? (
                      <div className="mt-3">
                        <Note tone="accent">{request.adminNote}</Note>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              icon="flag"
              title="Nothing has been requested yet"
              body="Be the first to ask for something."
            />
          )}
        </div>

        <aside>
          <h2 className="kicker mb-4 border-b border-line pb-2">Ask for something</h2>

          {user ? (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <Field label="What do you need?" error={failure?.on('title')}>
                {(props) => (
                  <Input
                    {...props}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Anime speed-ramp transitions"
                    required
                  />
                )}
              </Field>

              <Field
                label="A little more detail"
                hint="What are you editing, and what would this let you do?"
                error={failure?.on('description')}
              >
                {(props) => (
                  <Textarea
                    {...props}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={4}
                    required
                  />
                )}
              </Field>

              <Field label="Software" optional error={failure?.on('software')}>
                {(props) => (
                  <Input
                    {...props}
                    value={software}
                    onChange={(event) => setSoftware(event.target.value)}
                    placeholder="After Effects"
                  />
                )}
              </Field>

              {failure && failure.issues.length === 0 ? (
                <Note tone="critical">{failure.message}</Note>
              ) : null}

              <Button type="submit" variant="primary" loading={sending}>
                Post the request
              </Button>
            </form>
          ) : (
            <Note tone="accent">
              <Link to="/login" className="underlined">
                Sign in
              </Link>{' '}
              to post a request or vote. Downloading never needs an account — this does, so a vote
              counts once.
            </Note>
          )}
        </aside>
      </div>
    </div>
  );
}
