import { useState } from 'react';
import { api, ApiError, type Category } from '../../lib/api';
import { useFetch } from '../../lib/hooks';
import {
  Marker, Button, ConfirmDialog, Dialog, Block, SelectField, Skeleton,
  TextArea, TextField, Toggle, useToast,
} from '../../components/ui';
import { Icon } from '../../components/Icon';

interface License {
  id: string;
  name: string;
  summary: string;
  personalUse: boolean;
  commercialUse: boolean;
  modification: boolean;
  redistribution: boolean;
  resale: boolean;
  attributionRequired: boolean;
  customText: string | null;
  isDefault: boolean;
  resourceCount: number;
}

/** Categories, software and licenses (PRD §45, §32). */
export default function TaxonomyAdmin() {
  const { toast } = useToast();
  const { data: categories, reload: reloadCategories } = useFetch<{ items: Category[] }>('/admin/taxonomy/categories');
  const { data: software, reload: reloadSoftware } = useFetch<{ items: Array<{ id: string; name: string; resourceCount: number }> }>('/admin/taxonomy/software');
  const { data: licenses, reload: reloadLicenses } = useFetch<{ items: License[] }>('/admin/taxonomy/licenses');

  const [categoryDialog, setCategoryDialog] = useState<{ open: boolean; editing: Category | null }>({ open: false, editing: null });
  const [licenseDialog, setLicenseDialog] = useState<{ open: boolean; editing: License | null }>({ open: false, editing: null });
  const [confirm, setConfirm] = useState<{ open: boolean; label: string; onConfirm: () => void } | null>(null);
  const [newSoftware, setNewSoftware] = useState('');

  const remove = async (path: string, label: string, reload: () => void) => {
    try {
      await api.del(path);
      toast(`${label} deleted.`, 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not delete that.', 'error');
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    if (!categories) return;
    const ids = categories.items.map((c) => c.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await api.post('/admin/taxonomy/categories/reorder', { ids }).catch(() => {});
    reloadCategories();
  };

  if (!categories) return <Skeleton className="h-96" />;

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-[30px] leading-tight md:text-[34px]">Categories and licenses</h1>

      <Block
        title="Categories"
        description="Order here is the order visitors see."
        action={
          <Button size="sm" variant="primary" icon="plus" onClick={() => setCategoryDialog({ open: true, editing: null })}>
            New category
          </Button>
        }
      >
        <ul className="flex flex-col">
          {categories.items.map((c, i) => (
            <li key={c.id} className="border-b border-rule py-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex shrink-0 flex-col">
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${c.name} up`} className="text-faint hover:text-ink disabled:opacity-30">
                    <Icon name="chevron-down" size={13} className="rotate-180" />
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === categories.items.length - 1} aria-label={`Move ${c.name} down`} className="text-faint hover:text-ink disabled:opacity-30">
                    <Icon name="chevron-down" size={13} />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                    {c.name}
                    {c.status !== 'ACTIVE' ? <Marker tone="neutral">{c.status.toLowerCase()}</Marker> : null}
                    <span className="font-mono text-[12px] text-faint">{c.resourceCount}</span>
                  </p>
                  {c.description ? <p className="truncate text-[12.5px] text-faint">{c.description}</p> : null}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" icon="edit" onClick={() => setCategoryDialog({ open: true, editing: c })}>Edit</Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="trash"
                    onClick={() =>
                      setConfirm({
                        open: true,
                        label: `Delete "${c.name}"?`,
                        onConfirm: () => remove(`/admin/taxonomy/categories/${c.id}`, c.name, reloadCategories),
                      })
                    }
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Software" description="Powers the compatibility filters.">
        <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2">
          {software?.items.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-2 text-[14px] text-soft">
              {s.name}
              <span className="font-mono text-[11.5px] text-faint">{s.resourceCount}</span>
              <button
                onClick={() =>
                  setConfirm({
                    open: true,
                    label: `Remove "${s.name}"?`,
                    onConfirm: () => remove(`/admin/taxonomy/software/${s.id}`, s.name, reloadSoftware),
                  })
                }
                aria-label={`Remove ${s.name}`}
                className="text-faint hover:text-stop"
              >
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newSoftware}
            onChange={(e) => setNewSoftware(e.target.value)}
            placeholder="Add software, e.g. Nuke"
            aria-label="New software name"
            className="w-full min-w-0 border-0 border-b border-rule-strong bg-transparent px-0 py-1.5 text-[14px] text-ink rounded-none transition-colors duration-fast hover:border-ink focus:border-blue focus:outline-none focus:ring-0 placeholder:text-ghost focus:border-blue focus:outline-none"
          />
          <Button
            disabled={!newSoftware.trim()}
            onClick={async () => {
              await api.post('/admin/taxonomy/software', { name: newSoftware.trim() }).catch(() => {});
              setNewSoftware('');
              reloadSoftware();
            }}
          >
            Add
          </Button>
        </div>
      </Block>

      <Block
        title="Licenses"
        description="Reusable templates that resources point at."
        action={
          <Button size="sm" variant="primary" icon="plus" onClick={() => setLicenseDialog({ open: true, editing: null })}>
            New license
          </Button>
        }
      >
        <ul className="flex flex-col">
          {licenses?.items.map((l) => (
            <li key={l.id} className="border-b border-rule py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[14px] font-medium">{l.name}</p>
                {l.isDefault ? <Marker tone="blue">Default</Marker> : null}
                <span className="font-mono text-[12px] text-faint">{l.resourceCount} resources</span>
                <div className="ml-auto flex gap-1.5">
                  <Button size="sm" icon="edit" onClick={() => setLicenseDialog({ open: true, editing: l })}>Edit</Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="trash"
                    onClick={() =>
                      setConfirm({
                        open: true,
                        label: `Delete "${l.name}"?`,
                        onConfirm: () => remove(`/admin/taxonomy/licenses/${l.id}`, l.name, reloadLicenses),
                      })
                    }
                  >
                    Delete
                  </Button>
                </div>
              </div>
              <p className="mt-1 text-[13px] text-soft">{l.summary}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px]">
                <Permission ok={l.personalUse} label="Personal" />
                <Permission ok={l.commercialUse} label="Commercial" />
                <Permission ok={l.modification} label="Modify" />
                <Permission ok={l.redistribution} label="Redistribute" />
                <Permission ok={l.resale} label="Resell" />
                {l.attributionRequired ? <span className="text-warn">Credit required</span> : null}
              </div>
            </li>
          ))}
        </ul>
      </Block>

      <CategoryDialog
        state={categoryDialog}
        categories={categories.items}
        onClose={() => setCategoryDialog({ open: false, editing: null })}
        onSaved={reloadCategories}
      />
      <LicenseDialog
        state={licenseDialog}
        onClose={() => setLicenseDialog({ open: false, editing: null })}
        onSaved={reloadLicenses}
      />
      <ConfirmDialog
        open={!!confirm?.open}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          confirm?.onConfirm();
          setConfirm(null);
        }}
        title={confirm?.label ?? ''}
        description="Anything still using it will block the delete, so nothing is silently orphaned."
        confirmLabel="Delete"
        destructive
      />
    </div>
  );
}

function Permission({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? 'text-go' : 'text-ghost line-through'}>
      {label}
    </span>
  );
}

function CategoryDialog({
  state, categories, onClose, onSaved,
}: {
  state: { open: boolean; editing: Category | null };
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const editing = state.editing;
  const [form, setForm] = useState({ name: '', description: '', icon: '', parentId: '', status: 'ACTIVE' });
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);

  // Reset the form whenever a different category is opened.
  if (state.open && key !== (editing ? editing.id.length + (editing.position ?? 0) : -1)) {
    setKey(editing ? editing.id.length + (editing.position ?? 0) : -1);
    setForm({
      name: editing?.name ?? '',
      description: editing?.description ?? '',
      icon: editing?.icon ?? '',
      parentId: editing?.parentId ?? '',
      status: editing?.status ?? 'ACTIVE',
    });
  }

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        icon: form.icon || null,
        parentId: form.parentId || null,
        status: form.status,
      };
      if (editing) await api.patch(`/admin/taxonomy/categories/${editing.id}`, payload);
      else await api.post('/admin/taxonomy/categories', payload);
      toast('Category saved.', 'success');
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
      open={state.open}
      onClose={onClose}
      title={editing ? 'Edit category' : 'New category'}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!form.name.trim()}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} data-autofocus />
        <TextArea label="Description" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        <TextField label="Icon" value={form.icon} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} hint="Icon name, e.g. film, palette, sliders." />
        <SelectField label="Parent category" value={form.parentId} onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}>
          <option value="">None (top level)</option>
          {categories.filter((c) => c.id !== editing?.id).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </SelectField>
        <SelectField label="Status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
          <option value="ACTIVE">Active</option>
          <option value="HIDDEN">Hidden</option>
          <option value="ARCHIVED">Archived</option>
        </SelectField>
      </div>
    </Dialog>
  );
}

function LicenseDialog({
  state, onClose, onSaved,
}: {
  state: { open: boolean; editing: License | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const editing = state.editing;
  const [form, setForm] = useState({
    name: '', summary: '', personalUse: true, commercialUse: false, modification: true,
    redistribution: false, resale: false, attributionRequired: false, customText: '', isDefault: false,
  });
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);

  if (state.open && key !== (editing?.id ?? 'new')) {
    setKey(editing?.id ?? 'new');
    setForm({
      name: editing?.name ?? '',
      summary: editing?.summary ?? '',
      personalUse: editing?.personalUse ?? true,
      commercialUse: editing?.commercialUse ?? false,
      modification: editing?.modification ?? true,
      redistribution: editing?.redistribution ?? false,
      resale: editing?.resale ?? false,
      attributionRequired: editing?.attributionRequired ?? false,
      customText: editing?.customText ?? '',
      isDefault: editing?.isDefault ?? false,
    });
  }

  const save = async () => {
    setBusy(true);
    try {
      const payload = { ...form, customText: form.customText || null };
      if (editing) await api.patch(`/admin/taxonomy/licenses/${editing.id}`, payload);
      else await api.post('/admin/taxonomy/licenses', payload);
      toast('License saved.', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save that.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form, v: boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog
      open={state.open}
      onClose={onClose}
      title={editing ? 'Edit license' : 'New license'}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!form.name.trim() || !form.summary.trim()}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} data-autofocus />
        <TextField label="One-line summary" required value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} hint="Shown on the resource page." />
        <div className="flex flex-col gap-3 border-y border-rule py-4">
          <Toggle label="Personal use" checked={form.personalUse} onChange={(v) => set('personalUse', v)} />
          <Toggle label="Commercial use" checked={form.commercialUse} onChange={(v) => set('commercialUse', v)} />
          <Toggle label="Modification" checked={form.modification} onChange={(v) => set('modification', v)} />
          <Toggle label="Redistribution" checked={form.redistribution} onChange={(v) => set('redistribution', v)} />
          <Toggle label="Resale" checked={form.resale} onChange={(v) => set('resale', v)} />
          <Toggle label="Attribution required" checked={form.attributionRequired} onChange={(v) => set('attributionRequired', v)} />
        </div>
        <TextArea label="Full license text" rows={5} value={form.customText} onChange={(e) => setForm((f) => ({ ...f, customText: e.target.value }))} />
        <Toggle label="Use as the default for new resources" checked={form.isDefault} onChange={(v) => set('isDefault', v)} />
      </div>
    </Dialog>
  );
}
