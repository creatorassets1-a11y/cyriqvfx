import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type Category, type ResourceDetail } from '../../lib/api';
import { useFetch } from '../../lib/hooks';
import {
  Marker,
  Button,
  ConfirmDialog,
  cx,
  Dialog,
  Block,
  SelectField,
  Skeleton,
  TextArea,
  TextField,
  Toggle,
  useToast,
} from '../../components/ui';
import { Icon } from '../../components/Icon';
import { Uploader, type CompletedUpload } from '../../components/admin/Uploader';
import { formatBytes, formatDate } from '../../lib/format';

/**
 * Resource editor (PRD §44).
 *
 * Grouped sections rather than one giant form, autosave on the draft so a long
 * description is never lost, and publishing gated on actually having a file.
 */

const SECTIONS = [
  { id: 'identity', label: 'Identity' },
  { id: 'description', label: 'Description' },
  { id: 'media', label: 'Media' },
  { id: 'compatibility', label: 'Compatibility' },
  { id: 'files', label: 'Files' },
  { id: 'installation', label: 'Installation' },
  { id: 'license', label: 'License' },
  { id: 'seo', label: 'Discovery' },
  { id: 'publishing', label: 'Publishing' },
] as const;

interface Form {
  title: string;
  slug: string;
  shortDescription: string;
  fullDescription: string;
  categoryId: string;
  subcategoryId: string | null;
  licenseId: string | null;
  installationGuide: string;
  requirements: string;
  format: string;
  previewType: ResourceDetail['previewType'];
  featured: boolean;
  qualityFlags: string[];
  seoTitle: string;
  seoDescription: string;
  tags: string[];
  software: Array<{ softwareId: string; minVersion: string | null; note: string | null }>;
  relatedIds: string[];
  tutorialIds: string[];
}

const EMPTY: Form = {
  title: '',
  slug: '',
  shortDescription: '',
  fullDescription: '',
  categoryId: '',
  subcategoryId: null,
  licenseId: null,
  installationGuide: '',
  requirements: '',
  format: '',
  previewType: 'NONE',
  featured: false,
  qualityFlags: [],
  seoTitle: '',
  seoDescription: '',
  tags: [],
  software: [],
  relatedIds: [],
  tutorialIds: [],
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function ResourceEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isNew = !id;

  const [form, setForm] = useState<Form>(EMPTY);
  const [resourceId, setResourceId] = useState<string | null>(id ?? null);
  const [loaded, setLoaded] = useState(isNew);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<ApiError | null>(null);
  const [section, setSection] = useState<string>('identity');
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: categories } = useFetch<{ items: Category[] }>('/admin/taxonomy/categories');
  const { data: softwareList } = useFetch<{ items: Array<{ id: string; name: string }> }>(
    '/admin/taxonomy/software',
  );
  const { data: licenses } = useFetch<{ items: Array<{ id: string; name: string; isDefault: boolean }> }>(
    '/admin/taxonomy/licenses',
  );
  const { data: existing, reload: reloadResource } = useFetch<{
    resource: ResourceDetail & {
      allVersions: Array<{
        id: string;
        version: string;
        releaseNotes: string;
        fileSizeLabel: string;
        originalName: string;
        checksum: string | null;
        retired: boolean;
        isCurrent: boolean;
        publishedAt: string;
      }>;
      relatedIds: string[];
      tutorialIds: string[];
      scheduledFor: string | null;
    };
  }>(resourceId ? `/admin/resources/${resourceId}` : null);

  // Hydrate the form once the resource arrives.
  useEffect(() => {
    if (!existing?.resource || loaded) return;
    const r = existing.resource;
    setForm({
      title: r.title,
      slug: r.slug,
      shortDescription: r.shortDescription,
      fullDescription: r.fullDescription,
      categoryId: r.category.id,
      subcategoryId: r.subcategory?.id ?? null,
      licenseId: r.license?.id ?? null,
      installationGuide: r.installationGuide,
      requirements: r.requirements,
      format: r.format ?? '',
      previewType: r.previewType,
      featured: r.featured,
      qualityFlags: r.qualityFlags,
      seoTitle: r.seoTitle ?? '',
      seoDescription: r.seoDescription ?? '',
      tags: r.tags.map((t) => t.name),
      software: r.softwareCompatibility.map((s) => ({
        softwareId: s.id,
        minVersion: s.minVersion,
        note: s.note,
      })),
      relatedIds: r.relatedIds,
      tutorialIds: r.tutorialIds,
    });
    setLoaded(true);
  }, [existing, loaded]);

  // Default the category and license so a new resource starts usable.
  useEffect(() => {
    if (!isNew) return;
    setForm((f) => ({
      ...f,
      categoryId: f.categoryId || categories?.items[0]?.id || '',
      licenseId: f.licenseId ?? licenses?.items.find((l) => l.isDefault)?.id ?? null,
    }));
  }, [isNew, categories, licenses]);

  const persist = useCallback(
    async (next: Form, options: { silent?: boolean } = {}) => {
      if (!next.title.trim() || !next.shortDescription.trim() || !next.categoryId) return;
      setSaveState('saving');
      setError(null);
      try {
        const payload = {
          ...next,
          format: next.format || null,
          seoTitle: next.seoTitle || null,
          seoDescription: next.seoDescription || null,
        };
        if (resourceId) {
          await api.patch(`/admin/resources/${resourceId}`, payload);
        } else {
          const created = await api.post<{ resource: ResourceDetail }>('/admin/resources', payload);
          setResourceId(created.resource.id);
          // Move to the real edit URL without losing what is on screen.
          navigate(`/admin/resources/${created.resource.id}`, { replace: true });
        }
        dirtyRef.current = false;
        setSaveState('saved');
        if (!options.silent) toast('Saved.', 'success');
        setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2500);
      } catch (err) {
        setSaveState('error');
        if (err instanceof ApiError) {
          setError(err);
          toast(err.message, 'error');
        }
      }
    },
    [resourceId, navigate, toast],
  );

  /** Autosave a draft so a long description survives a stray navigation. */
  const update = useCallback(
    (patch: Partial<Form>) => {
      setForm((current) => {
        const next = { ...current, ...patch };
        dirtyRef.current = true;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => void persist(next, { silent: true }), 1400);
        return next;
      });
    },
    [persist],
  );

  // Warn before losing unsaved work.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const resource = existing?.resource;
  const subcategories = useMemo(
    () => categories?.items.find((c) => c.id === form.categoryId)?.children ?? [],
    [categories, form.categoryId],
  );

  if (!isNew && !loaded) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/admin/resources" className="text-[13px] text-faint hover:text-ink">
            ← Resources
          </Link>
          <h1 className="mt-1 truncate text-[30px] leading-tight md:text-[34px]">
            {form.title || 'New resource'}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {resource ? <StatusBadge status={resource.status} /> : <Marker>Not saved yet</Marker>}
            <SaveIndicator state={saveState} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {resource && resource.status !== 'DRAFT' ? (
            <a href={`/resources/${resource.slug}`} target="_blank" rel="noopener noreferrer">
              <Button icon="external">View live</Button>
            </a>
          ) : null}
          <Button variant="primary" icon="check" onClick={() => persist(form)} loading={saveState === 'saving'}>
            Save
          </Button>
        </div>
      </header>

      {error?.issues.length ? (
        <div role="alert" className="rounded-md border border-[rgba(255,92,120,0.35)] bg-stop-wash p-3.5">
          <p className="text-[13.5px] font-semibold text-stop">Fix these before saving:</p>
          <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-soft">
            {error.issues.map((i) => (
              <li key={i.field}>
                <span className="font-mono text-[12px]">{i.field}</span>: {i.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Section rail keeps a long form navigable (PRD §44) */}
      <nav aria-label="Editor sections" className="scroll-x no-bar -mx-[var(--gutter)] flex gap-1 px-[var(--gutter)] md:mx-0 md:px-0">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setSection(s.id);
              document.getElementById(`section-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            aria-current={section === s.id}
            className={cx(
              'shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-fast',
              section === s.id ? 'bg-blue-wash text-blue' : 'text-soft hover:bg-sunk hover:text-ink',
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="flex flex-col gap-5">
        <section id="section-identity" className="scroll-mt-24">
          <Block title="Identity">
            <div className="flex flex-col gap-4">
              <TextField
                label="Title"
                required
                value={form.title}
                onChange={(e) => update({ title: e.target.value })}
                error={error?.fieldError('title')}
              />
              <TextField
                label="URL slug"
                value={form.slug}
                onChange={(e) => update({ slug: e.target.value })}
                hint={form.slug ? `/resources/${form.slug}` : 'Generated from the title if left blank.'}
              />
              <TextField
                label="One-line summary"
                required
                value={form.shortDescription}
                onChange={(e) => update({ shortDescription: e.target.value })}
                hint="Shown on cards and in search results. Say what it does."
                error={error?.fieldError('shortDescription')}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Category"
                  value={form.categoryId}
                  onChange={(e) => update({ categoryId: e.target.value, subcategoryId: null })}
                  error={error?.fieldError('categoryId')}
                >
                  {categories?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </SelectField>
                {subcategories.length > 0 ? (
                  <SelectField
                    label="Subcategory"
                    value={form.subcategoryId ?? ''}
                    onChange={(e) => update({ subcategoryId: e.target.value || null })}
                  >
                    <option value="">None</option>
                    {subcategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </SelectField>
                ) : null}
              </div>
              <TextField
                label="Format"
                value={form.format}
                onChange={(e) => update({ format: e.target.value })}
                hint="Shown as a chip, e.g. ZIP, CUBE, FFX."
              />
            </div>
          </Block>
        </section>

        <section id="section-description" className="scroll-mt-24">
          <Block title="Description">
            <div className="flex flex-col gap-4">
              <TextArea
                label="Full description"
                rows={10}
                value={form.fullDescription}
                onChange={(e) => update({ fullDescription: e.target.value })}
                hint="What it is, what is included, and why it is useful. Line breaks are kept."
              />
              <TextArea
                label="Requirements"
                rows={3}
                value={form.requirements}
                onChange={(e) => update({ requirements: e.target.value })}
                hint="Anything needed beyond the software itself: disk space, plugins, codecs."
              />
            </div>
          </Block>
        </section>

        <section id="section-media" className="scroll-mt-24">
          <Block title="Media" description="Thumbnail and preview. These appear before anyone downloads.">
            <div className="flex flex-col gap-5">
              <SelectField
                label="Preview type"
                value={form.previewType}
                onChange={(e) => update({ previewType: e.target.value as Form['previewType'] })}
                hint="Choose what suits the asset. A LUT wants before and after, a script wants screenshots."
              >
                <option value="NONE">No preview</option>
                <option value="IMAGE">Single image</option>
                <option value="VIDEO">Video</option>
                <option value="BEFORE_AFTER">Before / after slider</option>
                <option value="AUDIO">Audio</option>
                <option value="GALLERY">Image gallery</option>
              </SelectField>

              {resourceId ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <MediaSlot
                    resourceId={resourceId}
                    slot="thumbnail"
                    label="Thumbnail"
                    accept="image/png,image/jpeg,image/webp"
                    purpose="thumbnail"
                    currentUrl={resource?.thumbnailUrl ?? null}
                    onDone={reloadResource}
                  />
                  {form.previewType === 'BEFORE_AFTER' ? (
                    <>
                      <MediaSlot
                        resourceId={resourceId}
                        slot="previewBefore"
                        label="Before image"
                        accept="image/png,image/jpeg,image/webp"
                        purpose="preview"
                        currentUrl={resource?.previewBeforeUrl ?? null}
                        onDone={reloadResource}
                      />
                      <MediaSlot
                        resourceId={resourceId}
                        slot="previewAfter"
                        label="After image"
                        accept="image/png,image/jpeg,image/webp"
                        purpose="preview"
                        currentUrl={resource?.previewAfterUrl ?? null}
                        onDone={reloadResource}
                      />
                    </>
                  ) : form.previewType !== 'NONE' ? (
                    <MediaSlot
                      resourceId={resourceId}
                      slot="preview"
                      label="Preview file"
                      accept={
                        form.previewType === 'VIDEO'
                          ? 'video/mp4,video/webm'
                          : form.previewType === 'AUDIO'
                            ? 'audio/mpeg,audio/wav'
                            : 'image/png,image/jpeg,image/webp'
                      }
                      purpose="preview"
                      currentUrl={resource?.previewUrl ?? null}
                      onDone={reloadResource}
                    />
                  ) : null}
                </div>
              ) : (
                <p className="border-l-2 border-rule-strong py-1 pl-4 text-[13px] text-soft">
                  Save the resource first. Media attaches to it once it exists.
                </p>
              )}
            </div>
          </Block>
        </section>

        <section id="section-compatibility" className="scroll-mt-24">
          <Block title="Compatibility" description="Only list software you have actually tested.">
            <div className="flex flex-col gap-2.5">
              {softwareList?.items.map((s) => {
                const entry = form.software.find((x) => x.softwareId === s.id);
                return (
                  <div key={s.id} className="flex flex-wrap items-center gap-3">
                    <label className="flex min-w-[150px] flex-1 cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={!!entry}
                        onChange={(e) =>
                          update({
                            software: e.target.checked
                              ? [...form.software, { softwareId: s.id, minVersion: null, note: null }]
                              : form.software.filter((x) => x.softwareId !== s.id),
                          })
                        }
                        className="h-4 w-4 cursor-pointer accent-[var(--blue)]"
                      />
                      <span className="text-[14px]">{s.name}</span>
                    </label>
                    {entry ? (
                      <>
                        <input
                          type="text"
                          value={entry.minVersion ?? ''}
                          onChange={(e) =>
                            update({
                              software: form.software.map((x) =>
                                x.softwareId === s.id ? { ...x, minVersion: e.target.value || null } : x,
                              ),
                            })
                          }
                          placeholder="Min version"
                          aria-label={`Minimum version for ${s.name}`}
                          className="h-9 w-28 rounded-none border-0 border-b border-rule-strong bg-transparent px-0 text-[13px] text-ink transition-colors duration-fast hover:border-ink focus:border-blue focus:outline-none focus:ring-0"
                        />
                        <input
                          type="text"
                          value={entry.note ?? ''}
                          onChange={(e) =>
                            update({
                              software: form.software.map((x) =>
                                x.softwareId === s.id ? { ...x, note: e.target.value || null } : x,
                              ),
                            })
                          }
                          placeholder="Note (optional)"
                          aria-label={`Note for ${s.name}`}
                          className="h-9 min-w-0 flex-1 rounded-none border-0 border-b border-rule-strong bg-transparent px-0 text-[13px] text-ink transition-colors duration-fast hover:border-ink focus:border-blue focus:outline-none focus:ring-0"
                        />
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Block>
        </section>

        <section id="section-files" className="scroll-mt-24">
          <VersionsPanel
            resourceId={resourceId}
            versions={resource?.allVersions ?? []}
            onChanged={reloadResource}
          />
        </section>

        <section id="section-installation" className="scroll-mt-24">
          <Block title="Installation" description="Exact steps. This is the difference between a useful resource and a frustrating one.">
            <TextArea
              label="Installation guide"
              rows={10}
              value={form.installationGuide}
              onChange={(e) => update({ installationGuide: e.target.value })}
              hint="Shown in a monospace block, so numbered steps and paths stay readable."
            />
          </Block>
        </section>

        <section id="section-license" className="scroll-mt-24">
          <Block title="License">
            <SelectField
              label="License"
              value={form.licenseId ?? ''}
              onChange={(e) => update({ licenseId: e.target.value || null })}
              hint="Every downloadable resource should state what people may do with it."
            >
              <option value="">No license selected</option>
              {licenses?.items.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </SelectField>
          </Block>
        </section>

        <section id="section-seo" className="scroll-mt-24">
          <Block title="Discovery" description="Tags, search metadata and quality flags.">
            <div className="flex flex-col gap-4">
              <TagInput
                value={form.tags}
                onChange={(tags) => update({ tags })}
              />
              <TextField
                label="SEO title"
                value={form.seoTitle}
                onChange={(e) => update({ seoTitle: e.target.value })}
                hint="Leave blank to generate one from the title and category."
              />
              <TextArea
                label="SEO description"
                rows={2}
                value={form.seoDescription}
                onChange={(e) => update({ seoDescription: e.target.value })}
                hint="Leave blank to generate one from the summary and compatibility."
              />
              <div>
                <p className="mb-2 text-[13px] font-semibold">Quality flags</p>
                <p className="mb-2.5 text-[12.5px] text-faint">Use sparingly. They mean less the more you use them.</p>
                <div className="flex flex-wrap gap-2">
                  {['CREATOR_PICK', 'BEGINNER_FRIENDLY', 'ADVANCED', 'EXPERIMENTAL'].map((flag) => (
                    <button
                      key={flag}
                      onClick={() =>
                        update({
                          qualityFlags: form.qualityFlags.includes(flag)
                            ? form.qualityFlags.filter((f) => f !== flag)
                            : [...form.qualityFlags, flag],
                        })
                      }
                      aria-pressed={form.qualityFlags.includes(flag)}
                      className={cx(
                        'text-[13px] underline-offset-4 transition-colors duration-fast',
                        form.qualityFlags.includes(flag)
                          ? 'text-blue underline decoration-blue'
                          : 'text-faint hover:text-ink hover:underline',
                      )}
                    >
                      {flag.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Block>
        </section>

        <section id="section-publishing" className="scroll-mt-24">
          <PublishPanel
            resourceId={resourceId}
            resource={resource ?? null}
            featured={form.featured}
            onFeaturedChange={(featured) => update({ featured })}
            onChanged={reloadResource}
          />
        </section>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'PUBLISHED'
      ? 'go'
      : status === 'SCHEDULED'
        ? 'warn'
        : status === 'UNLISTED'
          ? 'blue'
          : status === 'ARCHIVED'
            ? 'stop'
            : 'neutral';
  return <Marker tone={tone}>{status.charAt(0) + status.slice(1).toLowerCase()}</Marker>;
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const map = {
    saving: { text: 'Saving…', className: 'text-faint' },
    saved: { text: 'Saved', className: 'text-go' },
    error: { text: 'Not saved', className: 'text-stop' },
  } as const;
  const entry = map[state];
  return (
    <span className={cx('flex items-center gap-1 text-[12.5px]', entry.className)} role="status">
      {state === 'saving' ? <Icon name="spinner" size={11} /> : null}
      {entry.text}
    </span>
  );
}

function MediaSlot({
  resourceId,
  slot,
  label,
  accept,
  purpose,
  currentUrl,
  onDone,
}: {
  resourceId: string;
  slot: string;
  label: string;
  accept: string;
  purpose: 'thumbnail' | 'preview';
  currentUrl: string | null;
  onDone: () => void;
}) {
  const { toast } = useToast();

  const attach = async (upload: CompletedUpload) => {
    try {
      await api.post(`/admin/resources/${resourceId}/media`, {
        uploadSessionId: upload.uploadSessionId,
        slot,
      });
      toast(`${label} updated.`, 'success');
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not attach that.', 'error');
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-semibold">{label}</p>
      {currentUrl ? (
        <div className="well aspect-video">
          <img src={currentUrl} alt={`Current ${label}`} loading="lazy" />
        </div>
      ) : null}
      <Uploader purpose={purpose} label={currentUrl ? `Replace ${label.toLowerCase()}` : label} accept={accept} onComplete={attach} compact={!!currentUrl} />
    </div>
  );
}

function VersionsPanel({
  resourceId,
  versions,
  onChanged,
}: {
  resourceId: string | null;
  versions: Array<{
    id: string;
    version: string;
    releaseNotes: string;
    fileSizeLabel: string;
    originalName: string;
    checksum: string | null;
    retired: boolean;
    isCurrent: boolean;
    publishedAt: string;
  }>;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [upload, setUpload] = useState<CompletedUpload | null>(null);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [compatibility, setCompatibility] = useState('');
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!resourceId || !upload) return;
    setBusy(true);
    try {
      await api.post(`/admin/resources/${resourceId}/versions`, {
        uploadSessionId: upload.uploadSessionId,
        version,
        releaseNotes: notes,
        compatibility,
        makeCurrent: true,
        notifyDownloaders: notify,
      });
      toast(`Version ${version} added.`, 'success');
      setOpen(false);
      setUpload(null);
      setVersion('');
      setNotes('');
      setCompatibility('');
      setNotify(false);
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not add that version.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const makeCurrent = async (versionId: string) => {
    if (!resourceId) return;
    await api
      .patch(`/admin/resources/${resourceId}/versions/${versionId}`, { makeCurrent: true })
      .catch((err) => toast(err instanceof ApiError ? err.message : 'That did not work.', 'error'));
    onChanged();
  };

  return (
    <>
      <Block
        title="Files and versions"
        description="The current version is what people download."
        action={
          resourceId ? (
            <Button size="sm" variant="primary" icon="plus" onClick={() => setOpen(true)}>
              Add version
            </Button>
          ) : null
        }
      >
        {!resourceId ? (
          <p className="border-l-2 border-rule-strong py-1 pl-4 text-[13px] text-soft">
            Save the resource first, then attach its file.
          </p>
        ) : versions.length === 0 ? (
          <div className="border-l-2 border-rule-strong py-3 pl-5">
            <p className="text-[13.5px] text-soft">No file yet.</p>
            <p className="mt-1 text-[12.5px] text-faint">
              A resource cannot be published until it has one.
            </p>
            <Button className="mt-3" variant="primary" size="sm" icon="upload" onClick={() => setOpen(true)}>
              Upload the file
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {versions.map((v) => (
              <li
                key={v.id}
                className={cx(
                  'rounded-md border p-3.5',
                  v.isCurrent ? 'border-blue bg-blue-wash/30' : 'border-rule',
                  v.retired && 'opacity-60',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13.5px] font-semibold">v{v.version}</span>
                  {v.isCurrent ? <Marker tone="blue">Current</Marker> : null}
                  {v.retired ? <Marker tone="neutral">Retired</Marker> : null}
                  <span className="ml-auto text-[12px] text-faint">{formatDate(v.publishedAt)}</span>
                </div>
                <p className="mt-1.5 truncate font-mono text-[12px] text-faint">
                  {v.originalName} · {v.fileSizeLabel}
                </p>
                {v.releaseNotes ? (
                  <p className="mt-1.5 text-[13px] text-soft">{v.releaseNotes}</p>
                ) : null}
                {!v.isCurrent && !v.retired ? (
                  <Button size="sm" className="mt-2.5" onClick={() => makeCurrent(v.id)}>
                    Make current
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add a version"
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={busy} disabled={!upload || !version.trim()}>
              Add version
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Uploader
            purpose="resource-file"
            label="Upload the resource file"
            onComplete={(u) => setUpload(u)}
          />
          {upload ? (
            <p className="text-[12.5px] text-go">
              {upload.originalName} · {formatBytes(upload.size)} ready
            </p>
          ) : null}
          <TextField
            label="Version"
            required
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.0"
          />
          <TextArea
            label="Release notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What changed in this version?"
          />
          <TextField
            label="Compatibility"
            value={compatibility}
            onChange={(e) => setCompatibility(e.target.value)}
            placeholder="After Effects 2022–2026"
          />
          <Toggle
            label="Tell people who downloaded this"
            description="Only reaches previous downloaders who opted in."
            checked={notify}
            onChange={setNotify}
          />
        </div>
      </Dialog>
    </>
  );
}

function PublishPanel({
  resourceId,
  resource,
  featured,
  onFeaturedChange,
  onChanged,
}: {
  resourceId: string | null;
  resource: (ResourceDetail & { scheduledFor: string | null }) | null;
  featured: boolean;
  onFeaturedChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState(true);
  const [scheduleAt, setScheduleAt] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const setStatus = async (status: string, extra: Record<string, unknown> = {}) => {
    if (!resourceId) return;
    setBusy(true);
    try {
      await api.post(`/admin/resources/${resourceId}/status`, { status, ...extra });
      toast(`Resource ${status.toLowerCase()}.`, 'success');
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!resourceId) return;
    setBusy(true);
    try {
      await api.del(`/admin/resources/${resourceId}`);
      toast('Resource deleted.', 'success');
      navigate('/admin/resources');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not delete that.', 'error');
      setBusy(false);
    }
  };

  const hasFile = !!resource?.versions.length;

  return (
    <>
      <Block title="Publishing">
        <div className="flex flex-col gap-5">
          <Toggle
            label="Feature on the homepage"
            description="One featured resource appears in the featured slot."
            checked={featured}
            onChange={onFeaturedChange}
          />

          {!hasFile && resourceId ? (
            <p className="flex items-start gap-2 rounded-md bg-warn-wash p-3 text-[13px] text-soft">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-warn" />
              Add a downloadable file before publishing.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon="check"
              disabled={!resourceId || !hasFile || busy}
              onClick={() => setStatus('PUBLISHED', { notify })}
            >
              Publish now
            </Button>
            <Button
              disabled={!resourceId || !hasFile || busy}
              onClick={() => setStatus('UNLISTED')}
            >
              Unlist
            </Button>
            <Button disabled={!resourceId || busy} onClick={() => setStatus('DRAFT')}>
              Back to draft
            </Button>
            <Button
              variant="quiet"
              disabled={!resourceId || busy}
              onClick={() => setStatus('ARCHIVED')}
            >
              Archive
            </Button>
          </div>

          <Toggle
            label="Notify subscribers when publishing"
            description="Only reaches people who opted into new-resource notifications."
            checked={notify}
            onChange={setNotify}
          />

          <div className="border-t border-rule pt-5">
            <p className="mb-2 text-[13px] font-semibold">Schedule instead</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1">
                <label htmlFor="schedule-at" className="sr-only">
                  Publish at
                </label>
                <input
                  id="schedule-at"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  className="w-full min-w-0 border-0 border-b border-rule-strong bg-transparent px-0 py-1.5 text-[14px] text-ink rounded-none transition-colors duration-fast hover:border-ink focus:border-blue focus:outline-none focus:ring-0"
                />
              </div>
              <Button
                disabled={!resourceId || !hasFile || !scheduleAt || busy}
                onClick={() =>
                  setStatus('SCHEDULED', {
                    scheduledFor: new Date(scheduleAt).toISOString(),
                    notify,
                  })
                }
              >
                Schedule
              </Button>
            </div>
            {resource?.scheduledFor ? (
              <p className="mt-2 text-[12.5px] text-warn">
                Scheduled for {formatDate(resource.scheduledFor)}
              </p>
            ) : null}
          </div>

          {resourceId ? (
            <div className="border-t border-rule pt-5">
              <Button variant="danger" icon="trash" onClick={() => setDeleteOpen(true)} disabled={busy}>
                Delete permanently
              </Button>
            </div>
          ) : null}
        </div>
      </Block>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={remove}
        title="Delete this resource?"
        description="The resource, every version and all its stored files are removed. Download history keeps the record, but the files are gone. This cannot be undone."
        confirmLabel="Delete permanently"
        destructive
        loading={busy}
      />
    </>
  );
}

function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const tag = draft.trim();
    if (!tag || value.includes(tag)) {
      setDraft('');
      return;
    }
    onChange([...value, tag]);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="tag-input" className="text-[13px] font-semibold">
        Tags
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1.5 text-[13px] text-soft"
          >
            {tag}
            <button
              onClick={() => onChange(value.filter((t) => t !== tag))}
              aria-label={`Remove ${tag}`}
              className="text-faint hover:text-stop"
            >
              <Icon name="close" size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          id="tag-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a tag and press Enter"
          className="w-full min-w-0 border-0 border-b border-rule-strong bg-transparent px-0 py-1.5 text-[14px] text-ink rounded-none transition-colors duration-fast hover:border-ink focus:border-blue focus:outline-none focus:ring-0 placeholder:text-ghost"
        />
        <Button onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}
