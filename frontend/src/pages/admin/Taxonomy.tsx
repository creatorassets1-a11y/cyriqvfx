import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import type { Category, License, Software } from '../../lib/types';
import { PageError } from '../../components/Chrome';
import { Confirm } from '../../ui/Dialog';
import { Button, Check, Field, Input, Marker, Note, Select, Skeleton, Textarea } from '../../ui/primitives';

/**
 * Taxonomy.
 *
 * Categories, software and licenses are rows in the database, not constants in
 * the code, which is the whole point: the owner adds a category the day they
 * need one. Nothing here can be deleted while something still depends on it —
 * the refusal says exactly what is in the way rather than failing silently or,
 * worse, orphaning resources.
 */

interface CategoryWithCount extends Category {
  resourceCount: number;
}

/** A category or subcategory, flattened into one row of the list. */
interface Row {
  id: string;
  name: string;
  slug: string;
  status: string;
  resourceCount: number;
  child: boolean;
}

export default function Taxonomy() {
  useTitle('Taxonomy · Owner tools');

  return (
    <>
      <header className="mb-8">
        <h1 className="text-[30px]">Taxonomy</h1>
        <p className="mt-1.5 text-[13.5px] text-text-3">
          The categories, software and licenses every resource is filed under.
        </p>
      </header>

      <div className="flex flex-col gap-14">
        <Categories />
        <SoftwareList />
        <Licenses />
      </div>
    </>
  );
}

function Categories() {
  const { data, error, loading, reload } = useLoad<{ items: CategoryWithCount[] }>(
    '/admin/taxonomy/categories',
  );
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [description, setDescription] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Row | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);

    try {
      await api.post('/admin/taxonomy/categories', {
        name,
        parentId: parentId || null,
        description: description || null,
      });
      setName('');
      setDescription('');
      setParentId('');
      reload();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'That category could not be added.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!pending) return;
    setFailure(null);

    try {
      await api.delete(`/admin/taxonomy/categories/${pending.id}`);
      setPending(null);
      reload();
    } catch (err) {
      // The server refuses when something still depends on it, and says what.
      setFailure(err instanceof ApiError ? err.message : 'That category could not be deleted.');
      setPending(null);
    }
  }

  if (error) return <PageError onRetry={reload} />;

  // Children are listed as their own rows so every row has one delete control
  // and one meaning, rather than nesting a list inside a list.
  const rows: Row[] = (data?.items ?? []).flatMap((category) => [
    {
      id: category.id,
      name: category.name,
      slug: category.slug,
      status: category.status,
      resourceCount: category.resourceCount,
      child: false,
    },
    ...category.children.map((child) => ({
      id: child.id,
      name: child.name,
      slug: child.slug,
      status: 'ACTIVE',
      resourceCount: child.resourceCount,
      child: true,
    })),
  ]);

  return (
    <section>
      <h2 className="mb-4 border-b border-line pb-2 text-[22px]">Categories</h2>

      {failure ? (
        <div className="mb-4">
          <Note tone="critical">{failure}</Note>
        </div>
      ) : null}

      {loading && !data ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <ul className="mb-6 flex flex-col">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-3 first:border-t"
            >
              <span className={row.child ? 'pl-6 text-[14px] text-text-2' : 'text-[14px] text-text'}>
                {row.name}
              </span>
              <span className="font-mono text-[11.5px] text-text-4">/{row.slug}</span>
              {row.status !== 'ACTIVE' ? (
                <Marker tone="caution">{row.status.toLowerCase()}</Marker>
              ) : null}
              <span className="ml-auto font-mono text-[11.5px] text-text-4">
                {row.resourceCount} resources
              </span>
              <Button size="sm" variant="quiet" onClick={() => setPending(row)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-col gap-4 border-t border-line pt-5 sm:max-w-md">
        <Field label="New category">
          {(props) => (
            <Input
              {...props}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Sound design"
              required
            />
          )}
        </Field>

        <Field label="Inside" optional>
          {(props) => (
            <Select {...props} value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">Top level</option>
              {(data?.items ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Description" optional>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>

        <Button type="submit" loading={busy} className="self-start">
          Add category
        </Button>
      </form>

      <Confirm
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={remove}
        title={`Delete ${pending?.name ?? 'this category'}?`}
        body="A category can only be deleted when nothing is filed under it. If resources still use it, this will be refused."
        confirmLabel="Delete"
      />
    </section>
  );
}

function SoftwareList() {
  const { data, error, reload } = useLoad<{ items: Software[] }>('/admin/taxonomy/software');
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<Software | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);

    try {
      await api.post('/admin/taxonomy/software', { name });
      setName('');
      reload();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'That could not be added.');
    }
  }

  async function remove() {
    if (!pending) return;

    try {
      await api.delete(`/admin/taxonomy/software/${pending.id}`);
      setPending(null);
      reload();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'That could not be deleted.');
      setPending(null);
    }
  }

  if (error) return <PageError onRetry={reload} />;

  return (
    <section>
      <h2 className="mb-4 border-b border-line pb-2 text-[22px]">Software</h2>

      {failure ? (
        <div className="mb-4">
          <Note tone="critical">{failure}</Note>
        </div>
      ) : null}

      <ul className="mb-6 flex flex-col">
        {(data?.items ?? []).map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-4 border-b border-line py-2.5 first:border-t"
          >
            <span className="text-[14px] text-text-2">{item.name}</span>
            <span className="ml-auto font-mono text-[11.5px] text-text-4">
              {item.resourceCount ?? 0} resources
            </span>
            <Button size="sm" variant="quiet" onClick={() => setPending(item)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="flex items-end gap-3 border-t border-line pt-5 sm:max-w-md">
        <div className="flex-1">
          <Field label="Add software">
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Final Cut Pro"
                required
              />
            )}
          </Field>
        </div>
        <Button type="submit">Add</Button>
      </form>

      <Confirm
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={remove}
        title={`Remove ${pending?.name ?? 'this'}?`}
        body="It can only be removed while no resource lists it as compatible."
        confirmLabel="Remove"
      />
    </section>
  );
}

interface LicenseRow extends License {
  resourceCount: number;
  isDefault: boolean;
}

function Licenses() {
  const { data, error, reload } = useLoad<{ items: LicenseRow[] }>('/admin/taxonomy/licenses');
  const [draft, setDraft] = useState({
    name: '',
    summary: '',
    personalUse: true,
    commercialUse: false,
    modification: true,
    redistribution: false,
    resale: false,
    attributionRequired: false,
  });
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);

    try {
      await api.post('/admin/taxonomy/licenses', draft);
      setDraft({ ...draft, name: '', summary: '' });
      reload();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'That license could not be added.');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <PageError onRetry={reload} />;

  return (
    <section>
      <h2 className="mb-4 border-b border-line pb-2 text-[22px]">Licenses</h2>

      {failure ? (
        <div className="mb-4">
          <Note tone="critical">{failure}</Note>
        </div>
      ) : null}

      <ul className="mb-6 flex flex-col">
        {(data?.items ?? []).map((license) => (
          <li key={license.id} className="border-b border-line py-3 first:border-t">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-[14px] text-text">{license.name}</span>
              {license.commercialUse ? <Marker tone="positive">Commercial</Marker> : null}
              {license.attributionRequired ? <Marker tone="caution">Credit</Marker> : null}
              {license.isDefault ? <Marker tone="accent">Default</Marker> : null}
              <span className="ml-auto font-mono text-[11.5px] text-text-4">
                {license.resourceCount} resources
              </span>
            </div>
            <p className="mt-1 text-[12.5px] text-text-3">{license.summary}</p>
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="flex flex-col gap-4 border-t border-line pt-5 sm:max-w-md">
        <Field label="New license">
          {(props) => (
            <Input
              {...props}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="Free for commercial use"
              required
            />
          )}
        </Field>

        <Field label="One-line summary">
          {(props) => (
            <Input
              {...props}
              value={draft.summary}
              onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
              placeholder="Use in personal and paid client work."
              required
            />
          )}
        </Field>

        <div className="flex flex-col gap-2">
          <Check
            checked={draft.personalUse}
            onChange={(value) => setDraft({ ...draft, personalUse: value })}
            label="Personal projects"
          />
          <Check
            checked={draft.commercialUse}
            onChange={(value) => setDraft({ ...draft, commercialUse: value })}
            label="Commercial and client work"
          />
          <Check
            checked={draft.modification}
            onChange={(value) => setDraft({ ...draft, modification: value })}
            label="Modify and remix"
          />
          <Check
            checked={draft.redistribution}
            onChange={(value) => setDraft({ ...draft, redistribution: value })}
            label="Redistribute the file"
          />
          <Check
            checked={draft.resale}
            onChange={(value) => setDraft({ ...draft, resale: value })}
            label="Resell"
          />
          <Check
            checked={draft.attributionRequired}
            onChange={(value) => setDraft({ ...draft, attributionRequired: value })}
            label="Credit required"
          />
        </div>

        <Button type="submit" loading={busy} className="self-start">
          Add license
        </Button>
      </form>
    </section>
  );
}
