import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import type {
  AdminResource,
  Category,
  ContentStatus,
  License,
  PreviewType,
  QualityFlag,
  Software,
} from '../../lib/types';
import { formatDate, statusLabel } from '../../lib/format';
import { FileDrop, type CompletedUpload } from '../../components/admin/FileUpload';
import { PageError } from '../../components/Chrome';
import { Confirm, Dialog } from '../../ui/Dialog';
import {
  Button,
  Check,
  Field,
  Input,
  Marker,
  Note,
  Select,
  Skeleton,
  Textarea,
  cx,
} from '../../ui/primitives';

/**
 * Writing a resource.
 *
 * One screen holds the whole thing: the copy, the taxonomy, the file, the
 * versions and the publishing decision. Nothing here can put the site into a
 * state that lies to a visitor — publishing is refused until there is a file
 * to download, and the reason is on screen long before the button is pressed.
 */

const PREVIEW_TYPES: PreviewType[] = ['NONE', 'IMAGE', 'VIDEO', 'BEFORE_AFTER', 'AUDIO', 'GALLERY'];
const FLAGS: QualityFlag[] = [
  'FEATURED',
  'CREATOR_PICK',
  'BEGINNER_FRIENDLY',
  'ADVANCED',
  'EXPERIMENTAL',
];

interface Draft {
  title: string;
  slug: string;
  shortDescription: string;
  fullDescription: string;
  categoryId: string;
  subcategoryId: string;
  licenseId: string;
  installationGuide: string;
  requirements: string;
  format: string;
  previewType: PreviewType;
  featured: boolean;
  qualityFlags: QualityFlag[];
  seoTitle: string;
  seoDescription: string;
  tags: string;
  softwareIds: string[];
}

const EMPTY: Draft = {
  title: '',
  slug: '',
  shortDescription: '',
  fullDescription: '',
  categoryId: '',
  subcategoryId: '',
  licenseId: '',
  installationGuide: '',
  requirements: '',
  format: '',
  previewType: 'NONE',
  featured: false,
  qualityFlags: [],
  seoTitle: '',
  seoDescription: '',
  tags: '',
  softwareIds: [],
};

export default function ResourceEditor() {
  const params = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const [id, setId] = useState<string | null>(params.id ?? null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const resource = useLoad<{ resource: AdminResource }>(id ? `/admin/resources/${id}` : null);
  const categories = useLoad<{ items: Category[] }>('/admin/taxonomy/categories');
  const software = useLoad<{ items: Software[] }>('/admin/taxonomy/software');
  const licenses = useLoad<{ items: License[] }>('/admin/taxonomy/licenses');

  const loaded = resource.data?.resource ?? null;
  useTitle(loaded ? `${loaded.title} · Owner tools` : 'New resource · Owner tools');

  // A message set just before a navigation (creating, for instance) travels
  // with the location so it survives the route change that follows it.
  useEffect(() => {
    const flash = (location.state as { flash?: string } | null)?.flash;
    if (flash) setMessage(flash);
  }, [location.state]);

  useEffect(() => {
    if (!loaded) return;
    setDraft({
      title: loaded.title,
      slug: loaded.slug,
      shortDescription: loaded.shortDescription,
      fullDescription: loaded.fullDescription,
      categoryId: loaded.category.id,
      subcategoryId: loaded.subcategory?.id ?? '',
      licenseId: loaded.license?.id ?? '',
      installationGuide: loaded.installationGuide,
      requirements: loaded.requirements,
      format: loaded.format ?? '',
      previewType: loaded.previewType,
      featured: loaded.featured,
      qualityFlags: loaded.qualityFlags,
      seoTitle: loaded.seoTitle ?? '',
      seoDescription: loaded.seoDescription ?? '',
      tags: loaded.tags.map((tag) => tag.name).join(', '),
      softwareIds: loaded.softwareCompatibility.map((item) => item.id),
    });
  }, [loaded]);

  // A new resource needs a category, and the first one is a better default
  // than an empty select that fails validation on the first save.
  useEffect(() => {
    if (id || draft.categoryId || !categories.data?.items.length) return;
    setDraft((current) => ({ ...current, categoryId: categories.data!.items[0].id }));
  }, [id, draft.categoryId, categories.data]);

  const subcategories = useMemo(
    () => categories.data?.items.find((item) => item.id === draft.categoryId)?.children ?? [],
    [categories.data, draft.categoryId],
  );

  function edit(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setMessage(null);
  }

  function body() {
    return {
      title: draft.title,
      slug: draft.slug || undefined,
      shortDescription: draft.shortDescription,
      fullDescription: draft.fullDescription,
      categoryId: draft.categoryId,
      subcategoryId: draft.subcategoryId || null,
      licenseId: draft.licenseId || null,
      installationGuide: draft.installationGuide,
      requirements: draft.requirements,
      format: draft.format || null,
      previewType: draft.previewType,
      featured: draft.featured,
      qualityFlags: draft.qualityFlags,
      seoTitle: draft.seoTitle || null,
      seoDescription: draft.seoDescription || null,
      tags: draft.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      software: draft.softwareIds.map((softwareId) => ({ softwareId })),
      relatedIds: loaded?.relatedIds ?? [],
      tutorialIds: loaded?.tutorialIds ?? [],
    };
  }

  async function save() {
    setSaving(true);
    setFailure(null);

    try {
      if (id) {
        await api.patch(`/admin/resources/${id}`, body());
        setMessage('Saved.');
        resource.reload();
      } else {
        const created = await api.post<{ resource: AdminResource }>('/admin/resources', body());
        setId(created.resource.id);
        navigate(`/admin/resources/${created.resource.id}`, {
          replace: true,
          state: { flash: 'Saved.' },
        });
        setMessage('Saved.');
      }
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
      else setMessage(null);
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status: ContentStatus, notify = false) {
    setFailure(null);

    try {
      await api.post(`/admin/resources/${id}/status`, { status, notify });
      setMessage(
        status === 'PUBLISHED'
          ? 'Resource published.'
          : status === 'ARCHIVED'
            ? 'Resource archived.'
            : status === 'UNLISTED'
              ? 'Resource unlisted.'
              : 'Resource unpublished.',
      );
      resource.reload();
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
    }
  }

  async function remove() {
    try {
      await api.delete(`/admin/resources/${id}`);
      navigate('/admin/resources', { state: { flash: 'Resource deleted.' } });
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
      setDeleteOpen(false);
    }
  }

  if (resource.error) return <PageError onRetry={resource.reload} />;
  if (id && !loaded) return <Skeleton className="h-96 w-full" />;

  const hasFile = !!loaded?.allVersions.some((version) => !version.retired);

  return (
    <>
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/admin/resources" className="text-[12.5px] text-text-3 hover:text-text">
            ← All resources
          </Link>
          <h1 className="mt-2 text-[30px]">{loaded ? loaded.title : 'New resource'}</h1>
          {loaded ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Marker tone={loaded.status === 'PUBLISHED' ? 'positive' : 'neutral'}>
                {statusLabel(loaded.status)}
              </Marker>
              <span className="font-mono text-[11.5px] text-text-4">/{loaded.slug}</span>
              {loaded.status === 'PUBLISHED' ? (
                <Link
                  to={`/resources/${loaded.slug}`}
                  className="text-[12.5px] text-accent hover:underline"
                >
                  View it live
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {message ? (
            <p role="status" className="text-[13px] text-positive">
              {message}
            </p>
          ) : null}
          <Button variant="primary" onClick={save} loading={saving}>
            Save
          </Button>
        </div>
      </header>

      {failure ? (
        <div className="mb-6">
          <Note tone="critical">{failure.message}</Note>
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[1fr_280px] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-8">
          <Panel title="What it is">
            <div className="flex flex-col gap-4">
              <Field label="Title" error={failure?.on('title')}>
                {(props) => (
                  <Input
                    {...props}
                    value={draft.title}
                    onChange={(event) => edit({ title: event.target.value })}
                  />
                )}
              </Field>

              <Field
                label="One-line summary"
                hint="Shown on cards and in search results. Say what it does, not what it is called."
                error={failure?.on('shortDescription')}
              >
                {(props) => (
                  <Input
                    {...props}
                    value={draft.shortDescription}
                    onChange={(event) => edit({ shortDescription: event.target.value })}
                  />
                )}
              </Field>

              <Field label="Full description" error={failure?.on('fullDescription')}>
                {(props) => (
                  <Textarea
                    {...props}
                    rows={7}
                    value={draft.fullDescription}
                    onChange={(event) => edit({ fullDescription: event.target.value })}
                  />
                )}
              </Field>

              <Field
                label="How to install it"
                hint="Written steps. Line breaks are kept exactly as typed."
                error={failure?.on('installationGuide')}
              >
                {(props) => (
                  <Textarea
                    {...props}
                    rows={6}
                    value={draft.installationGuide}
                    onChange={(event) => edit({ installationGuide: event.target.value })}
                  />
                )}
              </Field>

              <Field label="Requirements" optional error={failure?.on('requirements')}>
                {(props) => (
                  <Textarea
                    {...props}
                    rows={3}
                    value={draft.requirements}
                    onChange={(event) => edit({ requirements: event.target.value })}
                  />
                )}
              </Field>
            </div>
          </Panel>

          <Panel title="The file">
            {loaded ? (
              <>
                {!hasFile ? (
                  <div className="mb-4">
                    <Note tone="caution">Add a downloadable file before publishing.</Note>
                  </div>
                ) : null}

                <div className="mb-4">
                  <Button icon="upload" onClick={() => setVersionOpen(true)}>
                    Upload the file
                  </Button>
                </div>

                {loaded.allVersions.length ? (
                  <ul className="flex flex-col">
                    {loaded.allVersions.map((version) => (
                      <li
                        key={version.id}
                        className={cx(
                          'flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-3 first:border-t',
                          version.retired && 'opacity-50',
                        )}
                      >
                        <span className="font-mono text-[13.5px] font-semibold">
                          v{version.version}
                        </span>
                        {version.isCurrent ? <Marker tone="accent">Current</Marker> : null}
                        {version.retired ? <Marker tone="neutral">Retired</Marker> : null}
                        <span className="font-mono text-[11.5px] text-text-4">
                          {version.fileSizeLabel} / {version.originalName}
                        </span>
                        <span className="ml-auto font-mono text-[11.5px] text-text-4">
                          {formatDate(version.publishedAt)}
                        </span>
                        {!version.isCurrent && !version.retired ? (
                          <Button
                            size="sm"
                            variant="quiet"
                            onClick={async () => {
                              await api.patch(
                                `/admin/resources/${id}/versions/${version.id}`,
                                { makeCurrent: true },
                              );
                              setMessage(`v${version.version} is now the current version.`);
                              resource.reload();
                            }}
                          >
                            Make current
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-text-3">
                    No file yet. Every version keeps its own notes, size and checksum.
                  </p>
                )}
              </>
            ) : (
              <p className="text-[13px] text-text-3">
                Save this resource first, then upload the file it hands out.
              </p>
            )}
          </Panel>

          <Panel title="Preview">
            {loaded ? (
              <div className="flex flex-col gap-5">
                <Field label="Preview type">
                  {(props) => (
                    <Select
                      {...props}
                      value={draft.previewType}
                      onChange={(event) =>
                        edit({ previewType: event.target.value as PreviewType })
                      }
                    >
                      {PREVIEW_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {statusLabel(type)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <MediaSlot
                    resourceId={loaded.id}
                    slot="thumbnail"
                    label="Card thumbnail"
                    current={loaded.thumbnailUrl}
                    onDone={() => {
                      setMessage('Thumbnail updated.');
                      resource.reload();
                    }}
                  />
                  <MediaSlot
                    resourceId={loaded.id}
                    slot="preview"
                    label="Preview image or video"
                    current={loaded.previewUrl}
                    onDone={() => {
                      setMessage('Preview updated.');
                      resource.reload();
                    }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-text-3">Save it first, then add the preview.</p>
            )}
          </Panel>

          <Panel title="Search and sharing">
            <div className="flex flex-col gap-4">
              <Field label="URL slug" hint="Changing this changes the public address." optional>
                {(props) => (
                  <Input
                    {...props}
                    value={draft.slug}
                    onChange={(event) => edit({ slug: event.target.value })}
                    placeholder="auto-beat-marker"
                  />
                )}
              </Field>

              <Field label="SEO title" optional hint="Up to 70 characters.">
                {(props) => (
                  <Input
                    {...props}
                    value={draft.seoTitle}
                    onChange={(event) => edit({ seoTitle: event.target.value })}
                  />
                )}
              </Field>

              <Field label="SEO description" optional hint="Up to 200 characters.">
                {(props) => (
                  <Textarea
                    {...props}
                    rows={2}
                    value={draft.seoDescription}
                    onChange={(event) => edit({ seoDescription: event.target.value })}
                  />
                )}
              </Field>
            </div>
          </Panel>
        </div>

        <aside className="flex flex-col gap-8">
          <Panel title="Publishing">
            {loaded ? (
              <div className="flex flex-col gap-2.5">
                {loaded.status !== 'PUBLISHED' ? (
                  <Button variant="primary" disabled={!hasFile} onClick={() => setStatus('PUBLISHED', true)}>
                    Publish now
                  </Button>
                ) : (
                  <Button onClick={() => setStatus('DRAFT')}>Unpublish</Button>
                )}
                <Button disabled={!hasFile} onClick={() => setStatus('UNLISTED')}>
                  Unlist (link only)
                </Button>
                <Button onClick={() => setStatus('ARCHIVED')}>Archive</Button>
              </div>
            ) : (
              <p className="text-[13px] text-text-3">Publishing opens once it is saved.</p>
            )}
          </Panel>

          <Panel title="Filing">
            <div className="flex flex-col gap-4">
              <Field label="Category" error={failure?.on('categoryId')}>
                {(props) => (
                  <Select
                    {...props}
                    value={draft.categoryId}
                    onChange={(event) => edit({ categoryId: event.target.value, subcategoryId: '' })}
                  >
                    {(categories.data?.items ?? []).map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {subcategories.length ? (
                <Field label="Subcategory" optional>
                  {(props) => (
                    <Select
                      {...props}
                      value={draft.subcategoryId}
                      onChange={(event) => edit({ subcategoryId: event.target.value })}
                    >
                      <option value="">None</option>
                      {subcategories.map((child) => (
                        <option key={child.id} value={child.id}>
                          {child.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}

              <Field label="License" optional>
                {(props) => (
                  <Select
                    {...props}
                    value={draft.licenseId}
                    onChange={(event) => edit({ licenseId: event.target.value })}
                  >
                    <option value="">Not set</option>
                    {(licenses.data?.items ?? []).map((license) => (
                      <option key={license.id} value={license.id}>
                        {license.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Format" optional hint="ZIP, CUBE, MOGRT…">
                {(props) => (
                  <Input
                    {...props}
                    value={draft.format}
                    onChange={(event) => edit({ format: event.target.value })}
                  />
                )}
              </Field>

              <Field label="Tags" optional hint="Comma separated.">
                {(props) => (
                  <Input
                    {...props}
                    value={draft.tags}
                    onChange={(event) => edit({ tags: event.target.value })}
                  />
                )}
              </Field>
            </div>
          </Panel>

          <Panel title="Works with">
            <div className="flex flex-col gap-2">
              {(software.data?.items ?? []).map((item) => (
                <Check
                  key={item.id}
                  checked={draft.softwareIds.includes(item.id)}
                  onChange={(checked) =>
                    edit({
                      softwareIds: checked
                        ? [...draft.softwareIds, item.id]
                        : draft.softwareIds.filter((value) => value !== item.id),
                    })
                  }
                  label={item.name}
                />
              ))}
            </div>
          </Panel>

          <Panel title="Promotion">
            <div className="flex flex-col gap-2">
              <Check
                checked={draft.featured}
                onChange={(checked) => edit({ featured: checked })}
                label="Feature on the front page"
              />
              {FLAGS.map((flag) => (
                <Check
                  key={flag}
                  checked={draft.qualityFlags.includes(flag)}
                  onChange={(checked) =>
                    edit({
                      qualityFlags: checked
                        ? [...draft.qualityFlags, flag]
                        : draft.qualityFlags.filter((value) => value !== flag),
                    })
                  }
                  label={statusLabel(flag)}
                />
              ))}
            </div>
          </Panel>

          {loaded ? (
            <Panel title="Danger">
              <p className="mb-3 text-[12.5px] leading-relaxed text-text-3">
                Deleting removes the resource, its versions and its files. Archiving keeps them and
                takes it off the site.
              </p>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                Delete permanently
              </Button>
            </Panel>
          ) : null}
        </aside>
      </div>

      {loaded ? (
        <VersionDialog
          open={versionOpen}
          resourceId={loaded.id}
          firstVersion={loaded.allVersions.length === 0}
          onClose={() => setVersionOpen(false)}
          onAdded={(version) => {
            setVersionOpen(false);
            setMessage(`Version ${version} added.`);
            resource.reload();
          }}
        />
      ) : null}

      <Confirm
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={remove}
        title="Delete this resource?"
        body="The resource, every version of it and the stored files all go. This cannot be undone."
        confirmLabel="Delete permanently"
      />
    </>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="kicker mb-4 border-b border-line pb-2">{title}</h2>
      {children}
    </section>
  );
}

/** One media slot: upload, and it replaces what is there. */
function MediaSlot({
  resourceId,
  slot,
  label,
  current,
  onDone,
}: {
  resourceId: string;
  slot: 'thumbnail' | 'preview';
  label: string;
  current: string | null;
  onDone: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);

  async function attach(upload: CompletedUpload) {
    setFailure(null);
    try {
      await api.post(`/admin/resources/${resourceId}/media`, {
        uploadSessionId: upload.uploadSessionId,
        slot,
      });
      onDone();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'That could not be attached.');
    }
  }

  return (
    <div>
      <p className="mb-2 text-[13px] font-semibold">{label}</p>
      {current ? (
        <div className="frame mb-2 aspect-[16/10] rounded border border-line">
          <img src={current} alt={`Current ${label.toLowerCase()}`} width={320} height={200} />
        </div>
      ) : null}
      <FileDrop
        purpose={slot === 'thumbnail' ? 'thumbnail' : 'preview'}
        accept="image/*,video/*"
        label={current ? 'Replace it' : 'Add one'}
        onDone={attach}
      />
      {failure ? (
        <div className="mt-2">
          <Note tone="critical">{failure}</Note>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Adding a version.
 *
 * The file goes up first and is verified before this form will submit, so a
 * version row can never point at bytes that did not arrive intact.
 */
function VersionDialog({
  open,
  resourceId,
  firstVersion,
  onClose,
  onAdded,
}: {
  open: boolean;
  resourceId: string;
  firstVersion: boolean;
  onClose: () => void;
  onAdded: (version: string) => void;
}) {
  const [upload, setUpload] = useState<CompletedUpload | null>(null);
  const [version, setVersion] = useState('1.0');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [compatibility, setCompatibility] = useState('');
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);

  async function add() {
    if (!upload) return;
    setBusy(true);
    setFailure(null);

    try {
      await api.post(`/admin/resources/${resourceId}/versions`, {
        uploadSessionId: upload.uploadSessionId,
        version,
        releaseNotes,
        compatibility,
        makeCurrent: true,
        notifyDownloaders: notify,
      });
      onAdded(version);
      setUpload(null);
      setReleaseNotes('');
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={firstVersion ? 'Add the file' : 'Add a new version'}
      description="The file uploads straight to storage and is checked before it is attached."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!upload} loading={busy} onClick={add}>
            Add version
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <FileDrop
          purpose="resource-file"
          label="Drop the file here, or choose one"
          hint="ZIP, FFX, MOGRT, CUBE, DRFX and the rest."
          onDone={setUpload}
        />

        <Field label="Version" hint="However you number them: 1.0, 2026.1, v3." error={failure?.on('version')}>
          {(props) => (
            <Input
              {...props}
              value={version}
              onChange={(event) => setVersion(event.target.value)}
            />
          )}
        </Field>

        <Field label="Release notes" optional error={failure?.on('releaseNotes')}>
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              value={releaseNotes}
              onChange={(event) => setReleaseNotes(event.target.value)}
              placeholder="What changed in this version."
            />
          )}
        </Field>

        <Field label="Compatibility note" optional error={failure?.on('compatibility')}>
          {(props) => (
            <Input
              {...props}
              value={compatibility}
              onChange={(event) => setCompatibility(event.target.value)}
              placeholder="After Effects 2022 and newer"
            />
          )}
        </Field>

        {!firstVersion ? (
          <Check
            checked={notify}
            onChange={setNotify}
            label="Tell everyone who downloaded the old version"
          />
        ) : null}

        {failure && failure.issues.length === 0 ? <Note tone="critical">{failure.message}</Note> : null}
      </div>
    </Dialog>
  );
}
