import { useState } from 'react';
import { api, ApiError, type ResourceCard } from '../../lib/api';
import { useFetch } from '../../lib/hooks';
import {
  Marker, Button, ConfirmDialog, Dialog, EmptyState, Block, SelectField,
  Skeleton, TextArea, TextField, useToast,
} from '../../components/ui';
import { formatDate } from '../../lib/format';

interface Entry {
  id: string;
  title: string;
  slug: string;
  body: string;
  kind: 'RELEASE' | 'UPDATE' | 'SITE' | 'ANNOUNCEMENT';
  status: string;
  publishedAt: string | null;
  createdAt: string;
  resourceIds: string[];
  tutorialIds: string[];
}

/** Changelog management (PRD §27). */
export default function ChangelogAdmin() {
  const { toast } = useToast();
  const { data, loading, reload } = useFetch<{ items: Entry[] }>('/updates/admin/all');
  const { data: resources } = useFetch<{ items: ResourceCard[] }>('/admin/resources?perPage=100&status=PUBLISHED');
  const [editing, setEditing] = useState<Entry | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<Entry | null>(null);

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.del(`/updates/admin/${deleting.id}`);
      toast('Update deleted.', 'success');
      setDeleting(null);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not delete that.', 'error');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px] leading-tight md:text-[34px]">Updates</h1>
        <Button variant="primary" icon="plus" onClick={() => { setEditing(null); setOpen(true); }}>
          New update
        </Button>
      </header>

      {loading && !data ? (
        <Skeleton className="h-64" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon="history"
          title="No updates posted"
          description="Post here when you release something or change how the site works."
          action={<Button variant="primary" onClick={() => setOpen(true)}>Write one</Button>}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {data.items.map((e) => (
            <Block key={e.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Marker tone={e.status === 'PUBLISHED' ? 'go' : 'neutral'}>
                  {e.status.charAt(0) + e.status.slice(1).toLowerCase()}
                </Marker>
                <Marker tone="neutral">{e.kind.toLowerCase()}</Marker>
                <h2 className="text-[15px] font-semibold">{e.title}</h2>
                <span className="ml-auto text-[12px] text-faint">
                  {e.publishedAt ? formatDate(e.publishedAt) : `drafted ${formatDate(e.createdAt)}`}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 text-[13.5px] leading-relaxed text-soft">{e.body}</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" icon="edit" onClick={() => { setEditing(e); setOpen(true); }}>Edit</Button>
                <Button size="sm" variant="quiet" icon="trash" onClick={() => setDeleting(e)}>Delete</Button>
              </div>
            </Block>
          ))}
        </div>
      )}

      <EntryDialog
        open={open}
        entry={editing}
        resources={resources?.items ?? []}
        onClose={() => { setOpen(false); setEditing(null); }}
        onSaved={reload}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={`Delete "${deleting?.title}"?`}
        description="The update is removed from the public timeline. This cannot be undone."
        confirmLabel="Delete"
        destructive
      />
    </div>
  );
}

function EntryDialog({
  open, entry, resources, onClose, onSaved,
}: {
  open: boolean;
  entry: Entry | null;
  resources: ResourceCard[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({ title: '', body: '', kind: 'RELEASE', status: 'DRAFT', resourceIds: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);

  if (open && key !== (entry?.id ?? 'new')) {
    setKey(entry?.id ?? 'new');
    setForm({
      title: entry?.title ?? '',
      body: entry?.body ?? '',
      kind: entry?.kind ?? 'RELEASE',
      status: entry?.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
      resourceIds: entry?.resourceIds ?? [],
    });
  }

  const save = async () => {
    setBusy(true);
    try {
      if (entry) await api.patch(`/updates/admin/${entry.id}`, form);
      else await api.post('/updates/admin', form);
      toast('Update saved.', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save that.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={entry ? 'Edit update' : 'New update'}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!form.title.trim() || !form.body.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField label="Title" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} data-autofocus />
        <TextArea label="What changed" required rows={5} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Kind" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
            <option value="RELEASE">New release</option>
            <option value="UPDATE">Resource update</option>
            <option value="SITE">Site change</option>
            <option value="ANNOUNCEMENT">Announcement</option>
          </SelectField>
          <SelectField label="Status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
          </SelectField>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-semibold">Link resources</p>
          <div className="max-h-40 overflow-y-auto border-y border-rule py-2">
            {resources.length === 0 ? (
              <p className="p-2 text-[13px] text-faint">No published resources yet.</p>
            ) : (
              resources.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 hover:bg-sunk">
                  <input
                    type="checkbox"
                    checked={form.resourceIds.includes(r.id)}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        resourceIds: e.target.checked
                          ? [...f.resourceIds, r.id]
                          : f.resourceIds.filter((id) => id !== r.id),
                      }))
                    }
                    className="h-4 w-4 cursor-pointer accent-[var(--blue)]"
                  />
                  <span className="truncate text-[13.5px]">{r.title}</span>
                </label>
              ))
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
