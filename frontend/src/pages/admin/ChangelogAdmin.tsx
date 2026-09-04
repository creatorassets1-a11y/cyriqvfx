import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import type { ChangelogEntry, Paged, ResourceCard } from '../../lib/types';
import { formatDate, titleCase } from '../../lib/format';
import { PageError } from '../../components/Chrome';
import { Confirm } from '../../ui/Dialog';
import {
  Button,
  Check,
  Empty,
  Field,
  Input,
  Marker,
  Note,
  Select,
  Skeleton,
  Textarea,
} from '../../ui/primitives';

/**
 * Writing an update.
 *
 * An entry links the resources it is about, which is what turns the public
 * updates page from a list of claims into a list of things a reader can go and
 * download. Announcing is a separate, deliberate act: writing here notifies
 * nobody until it is published.
 */

const KINDS = ['RELEASE', 'UPDATE', 'SITE', 'ANNOUNCEMENT'] as const;

interface Draft {
  title: string;
  body: string;
  kind: (typeof KINDS)[number];
  status: 'DRAFT' | 'PUBLISHED';
  resourceIds: string[];
}

const EMPTY: Draft = { title: '', body: '', kind: 'RELEASE', status: 'DRAFT', resourceIds: [] };

export default function ChangelogAdmin() {
  const entries = useLoad<{ items: ChangelogEntry[] }>('/updates/admin/all');
  const resources = useLoad<Paged<ResourceCard>>('/admin/resources?perPage=100');

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<ChangelogEntry | null>(null);

  useTitle('Updates · Owner tools');

  function reset() {
    setDraft(EMPTY);
    setEditing(null);
    setFailure(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);

    try {
      if (editing) {
        await api.patch(`/updates/admin/${editing}`, { ...draft, tutorialIds: [] });
        setMessage('Update saved.');
      } else {
        await api.post('/updates/admin', { ...draft, tutorialIds: [] });
        setMessage('Update written.');
      }
      reset();
      entries.reload();
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!pending) return;
    try {
      await api.delete(`/updates/admin/${pending.id}`);
      setMessage('Update deleted.');
      setPending(null);
      entries.reload();
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
      setPending(null);
    }
  }

  if (entries.error) return <PageError onRetry={entries.reload} />;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px]">Updates</h1>
          <p className="mt-1.5 text-[13.5px] text-text-3">
            The public changelog. Nothing here is announced until it is published.
          </p>
        </div>
        {message ? (
          <p role="status" className="text-[13px] text-positive">
            {message}
          </p>
        ) : null}
      </header>

      {failure ? (
        <div className="mb-6">
          <Note tone="critical">{failure.message}</Note>
        </div>
      ) : null}

      <div className="grid gap-12 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {entries.loading && !entries.data ? (
            <Skeleton className="h-64 w-full" />
          ) : entries.data && entries.data.items.length ? (
            <ul className="flex flex-col">
              {entries.data.items.map((entry) => (
                <li key={entry.id} className="border-b border-line py-4 first:border-t">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <Marker tone={entry.status === 'PUBLISHED' ? 'positive' : 'neutral'}>
                      {titleCase(entry.status ?? 'DRAFT')}
                    </Marker>
                    <span className="text-[14.5px] text-text">{entry.title}</span>
                    <span className="font-mono text-[11.5px] text-text-4">
                      {titleCase(entry.kind)}
                    </span>
                    <span className="ml-auto font-mono text-[11.5px] text-text-4">
                      {entry.publishedAt ? formatDate(entry.publishedAt) : 'not published'}
                    </span>
                  </div>

                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-text-2">
                    {entry.body}
                  </p>

                  <div className="mt-2.5 flex gap-2">
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => {
                        setEditing(entry.id);
                        setDraft({
                          title: entry.title,
                          body: entry.body,
                          kind: entry.kind,
                          status: entry.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
                          resourceIds: entry.resourceIds ?? [],
                        });
                        setMessage(null);
                      }}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => setPending(entry)}>
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              icon="calendar"
              title="No updates written"
              body="Every release is worth a line. Write the first one."
            />
          )}
        </div>

        <aside>
          <h2 className="kicker mb-4 border-b border-line pb-2">
            {editing ? 'Edit this update' : 'Write an update'}
          </h2>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Title" error={failure?.on('title')}>
              {(props) => (
                <Input
                  {...props}
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  placeholder="Auto Beat Marker 1.4"
                  required
                />
              )}
            </Field>

            <Field label="What changed" error={failure?.on('body')}>
              {(props) => (
                <Textarea
                  {...props}
                  rows={5}
                  value={draft.body}
                  onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                  required
                />
              )}
            </Field>

            <Field label="Kind">
              {(props) => (
                <Select
                  {...props}
                  value={draft.kind}
                  onChange={(event) =>
                    setDraft({ ...draft, kind: event.target.value as Draft['kind'] })
                  }
                >
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {titleCase(kind)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Status">
              {(props) => (
                <Select
                  {...props}
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({ ...draft, status: event.target.value as Draft['status'] })
                  }
                >
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                </Select>
              )}
            </Field>

            <div>
              <p className="mb-2 text-[13px] font-semibold">Resources this is about</p>
              <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                {(resources.data?.items ?? []).map((resource) => (
                  <Check
                    key={resource.id}
                    checked={draft.resourceIds.includes(resource.id)}
                    onChange={(checked) =>
                      setDraft({
                        ...draft,
                        resourceIds: checked
                          ? [...draft.resourceIds, resource.id]
                          : draft.resourceIds.filter((id) => id !== resource.id),
                      })
                    }
                    label={resource.title}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-2.5">
              <Button type="submit" variant="primary" loading={busy}>
                {editing ? 'Save changes' : 'Write it'}
              </Button>
              {editing ? <Button onClick={reset}>Cancel</Button> : null}
            </div>
          </form>
        </aside>
      </div>

      <Confirm
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={remove}
        title="Delete this update?"
        body="It disappears from the public updates page. The resources it mentions are untouched."
        confirmLabel="Delete permanently"
      />
    </>
  );
}
