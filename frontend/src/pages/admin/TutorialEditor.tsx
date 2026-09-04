import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import type {
  Category,
  ContentStatus,
  Paged,
  ResourceCard,
  SkillLevel,
  Software,
  Tutorial,
} from '../../lib/types';
import { statusLabel } from '../../lib/format';
import { FileDrop, type CompletedUpload } from '../../components/admin/FileUpload';
import { PageError } from '../../components/Chrome';
import { Confirm } from '../../ui/Dialog';
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
} from '../../ui/primitives';

/**
 * Writing a tutorial.
 *
 * The part that matters is at the bottom: the resources this tutorial uses.
 * Linking them here is what makes the two halves of the site point at each
 * other, so a tutorial always has its files and a resource always shows the
 * tutorials that use it.
 */

interface AdminTutorial extends Tutorial {
  resourceIds: string[];
  softwareIds: string[];
  tagNames: string[];
  scheduledFor: string | null;
}

interface Draft {
  title: string;
  slug: string;
  summary: string;
  body: string;
  categoryId: string;
  skillLevel: SkillLevel;
  durationMinutes: string;
  videoUrl: string;
  transcript: string;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
  tags: string;
  softwareIds: string[];
  resourceIds: string[];
  steps: Array<{ title: string; body: string; timestampSeconds: number | null }>;
}

const EMPTY: Draft = {
  title: '',
  slug: '',
  summary: '',
  body: '',
  categoryId: '',
  skillLevel: 'BEGINNER',
  durationMinutes: '',
  videoUrl: '',
  transcript: '',
  featured: false,
  seoTitle: '',
  seoDescription: '',
  tags: '',
  softwareIds: [],
  resourceIds: [],
  steps: [],
};

const LEVELS: SkillLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];

export default function TutorialEditor() {
  const params = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const [id, setId] = useState<string | null>(params.id ?? null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const tutorial = useLoad<{ tutorial: AdminTutorial }>(id ? `/admin/tutorials/${id}` : null);
  const categories = useLoad<{ items: Category[] }>('/admin/taxonomy/categories');
  const software = useLoad<{ items: Software[] }>('/admin/taxonomy/software');
  const resources = useLoad<Paged<ResourceCard>>('/admin/resources?perPage=100');

  const loaded = tutorial.data?.tutorial ?? null;
  useTitle(loaded ? `${loaded.title} · Owner tools` : 'New tutorial · Owner tools');

  useEffect(() => {
    const flash = (location.state as { flash?: string } | null)?.flash;
    if (flash) setMessage(flash);
  }, [location.state]);

  useEffect(() => {
    if (!loaded) return;
    setDraft({
      title: loaded.title,
      slug: loaded.slug,
      summary: loaded.summary,
      body: loaded.body,
      categoryId: loaded.category?.id ?? '',
      skillLevel: loaded.skillLevel,
      durationMinutes: loaded.durationSeconds ? String(Math.round(loaded.durationSeconds / 60)) : '',
      videoUrl: loaded.isExternalVideo ? (loaded.videoUrl ?? '') : '',
      transcript: loaded.transcript ?? '',
      featured: loaded.featured,
      seoTitle: loaded.seoTitle ?? '',
      seoDescription: loaded.seoDescription ?? '',
      tags: loaded.tagNames.join(', '),
      softwareIds: loaded.softwareIds,
      resourceIds: loaded.resourceIds,
      steps: loaded.steps.map((step) => ({
        title: step.title,
        body: step.body,
        timestampSeconds: step.timestampSeconds,
      })),
    });
  }, [loaded]);

  function edit(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setMessage(null);
  }

  function body() {
    const minutes = Number(draft.durationMinutes);
    return {
      title: draft.title,
      slug: draft.slug || undefined,
      summary: draft.summary,
      body: draft.body,
      categoryId: draft.categoryId || null,
      skillLevel: draft.skillLevel,
      durationSeconds: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : null,
      videoUrl: draft.videoUrl || null,
      transcript: draft.transcript || null,
      featured: draft.featured,
      seoTitle: draft.seoTitle || null,
      seoDescription: draft.seoDescription || null,
      softwareIds: draft.softwareIds,
      tags: draft.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      resourceIds: draft.resourceIds,
      steps: draft.steps.filter((step) => step.title.trim()),
    };
  }

  async function save() {
    setSaving(true);
    setFailure(null);

    try {
      if (id) {
        await api.patch(`/admin/tutorials/${id}`, body());
        setMessage('Saved.');
        tutorial.reload();
      } else {
        const created = await api.post<{ tutorial: AdminTutorial }>('/admin/tutorials', body());
        setId(created.tutorial.id);
        navigate(`/admin/tutorials/${created.tutorial.id}`, {
          replace: true,
          state: { flash: 'Saved.' },
        });
        setMessage('Saved.');
      }
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status: ContentStatus, notify = false) {
    setFailure(null);

    try {
      await api.post(`/admin/tutorials/${id}/status`, { status, notify });
      setMessage(status === 'PUBLISHED' ? 'Tutorial published.' : 'Tutorial unpublished.');
      tutorial.reload();
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
    }
  }

  async function attachMedia(slot: 'cover' | 'video', upload: CompletedUpload) {
    try {
      await api.post(`/admin/tutorials/${id}/media`, {
        uploadSessionId: upload.uploadSessionId,
        slot,
      });
      setMessage(slot === 'cover' ? 'Cover updated.' : 'Video uploaded.');
      tutorial.reload();
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
    }
  }

  async function remove() {
    try {
      await api.delete(`/admin/tutorials/${id}`);
      navigate('/admin/tutorials', { state: { flash: 'Tutorial deleted.' } });
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
      setDeleteOpen(false);
    }
  }

  if (tutorial.error) return <PageError onRetry={tutorial.reload} />;
  if (id && !loaded) return <Skeleton className="h-96 w-full" />;

  return (
    <>
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/admin/tutorials" className="text-[12.5px] text-text-3 hover:text-text">
            ← All tutorials
          </Link>
          <h1 className="mt-2 text-[30px]">{loaded ? loaded.title : 'New tutorial'}</h1>
          {loaded ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Marker tone={loaded.status === 'PUBLISHED' ? 'positive' : 'neutral'}>
                {statusLabel(loaded.status)}
              </Marker>
              <span className="font-mono text-[11.5px] text-text-4">/{loaded.slug}</span>
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
          <Panel title="The tutorial">
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
                label="Summary"
                hint="One or two lines, shown on cards and in search."
                error={failure?.on('summary')}
              >
                {(props) => (
                  <Input
                    {...props}
                    value={draft.summary}
                    onChange={(event) => edit({ summary: event.target.value })}
                  />
                )}
              </Field>

              <Field
                label="Intro"
                hint="What this covers, written out. A tutorial can publish on writing alone."
                error={failure?.on('body')}
              >
                {(props) => (
                  <Textarea
                    {...props}
                    rows={8}
                    value={draft.body}
                    onChange={(event) => edit({ body: event.target.value })}
                  />
                )}
              </Field>

              <Field label="Transcript" optional error={failure?.on('transcript')}>
                {(props) => (
                  <Textarea
                    {...props}
                    rows={4}
                    value={draft.transcript}
                    onChange={(event) => edit({ transcript: event.target.value })}
                  />
                )}
              </Field>
            </div>
          </Panel>

          <Panel title="Video">
            <div className="flex flex-col gap-4">
              <Field
                label="Embed URL"
                optional
                hint="Paste a hosted video URL, or upload the file below."
                error={failure?.on('videoUrl')}
              >
                {(props) => (
                  <Input
                    {...props}
                    value={draft.videoUrl}
                    onChange={(event) => edit({ videoUrl: event.target.value })}
                    placeholder="https://…"
                  />
                )}
              </Field>

              {loaded ? (
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 text-[13px] font-semibold">Cover image</p>
                    {loaded.coverUrl ? (
                      <div className="frame mb-2 aspect-video rounded border border-line">
                        <img src={loaded.coverUrl} alt="Current cover" width={320} height={180} />
                      </div>
                    ) : null}
                    <FileDrop
                      purpose="tutorial-media"
                      accept="image/*"
                      label={loaded.coverUrl ? 'Replace the cover' : 'Add a cover'}
                      onDone={(upload) => attachMedia('cover', upload)}
                    />
                  </div>

                  <div>
                    <p className="mb-2 text-[13px] font-semibold">Video file</p>
                    <FileDrop
                      purpose="tutorial-media"
                      accept="video/*"
                      label="Upload the video"
                      hint="Large files upload in parts."
                      onDone={(upload) => attachMedia('video', upload)}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-text-3">Save it first, then add media.</p>
              )}
            </div>
          </Panel>

          <Panel title="Steps">
            <div className="flex flex-col gap-4">
              {draft.steps.map((step, index) => (
                <div key={index} className="flex flex-col gap-2 border-b border-line pb-4">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[12px] text-text-4">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <Input
                      value={step.title}
                      aria-label={`Step ${index + 1} title`}
                      placeholder="What happens in this step"
                      onChange={(event) =>
                        edit({
                          steps: draft.steps.map((item, position) =>
                            position === index ? { ...item, title: event.target.value } : item,
                          ),
                        })
                      }
                    />
                    <Input
                      value={step.timestampSeconds ?? ''}
                      aria-label={`Step ${index + 1} timestamp in seconds`}
                      placeholder="secs"
                      inputMode="numeric"
                      className="w-24"
                      onChange={(event) =>
                        edit({
                          steps: draft.steps.map((item, position) =>
                            position === index
                              ? {
                                  ...item,
                                  timestampSeconds: event.target.value
                                    ? Number(event.target.value)
                                    : null,
                                }
                              : item,
                          ),
                        })
                      }
                    />
                    <Button
                      size="sm"
                      variant="quiet"
                      aria-label={`Remove step ${index + 1}`}
                      icon="trash"
                      onClick={() =>
                        edit({ steps: draft.steps.filter((_, position) => position !== index) })
                      }
                    />
                  </div>

                  <Textarea
                    value={step.body}
                    rows={2}
                    aria-label={`Step ${index + 1} detail`}
                    placeholder="Anything worth spelling out"
                    onChange={(event) =>
                      edit({
                        steps: draft.steps.map((item, position) =>
                          position === index ? { ...item, body: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </div>
              ))}

              <Button
                icon="plus"
                className="self-start"
                onClick={() =>
                  edit({ steps: [...draft.steps, { title: '', body: '', timestampSeconds: null }] })
                }
              >
                Add a step
              </Button>
            </div>
          </Panel>

          <Panel title="Resources used">
            <p className="mb-4 text-[12.5px] text-text-3">
              Linking a resource here also shows this tutorial on that resource's page.
            </p>
            <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {(resources.data?.items ?? []).map((resource) => (
                <Check
                  key={resource.id}
                  checked={draft.resourceIds.includes(resource.id)}
                  onChange={(checked) =>
                    edit({
                      resourceIds: checked
                        ? [...draft.resourceIds, resource.id]
                        : draft.resourceIds.filter((value) => value !== resource.id),
                    })
                  }
                  label={resource.title}
                />
              ))}
            </div>
          </Panel>
        </div>

        <aside className="flex flex-col gap-8">
          <Panel title="Publishing">
            {loaded ? (
              <div className="flex flex-col gap-2.5">
                {loaded.status === 'PUBLISHED' ? (
                  <Button onClick={() => setStatus('DRAFT')}>Unpublish</Button>
                ) : (
                  <Button variant="primary" onClick={() => setStatus('PUBLISHED', true)}>
                    Publish
                  </Button>
                )}
                <Button onClick={() => setStatus('ARCHIVED')}>Archive</Button>
              </div>
            ) : (
              <p className="text-[13px] text-text-3">Publishing opens once it is saved.</p>
            )}
          </Panel>

          <Panel title="Filing">
            <div className="flex flex-col gap-4">
              <Field label="Category" optional>
                {(props) => (
                  <Select
                    {...props}
                    value={draft.categoryId}
                    onChange={(event) => edit({ categoryId: event.target.value })}
                  >
                    <option value="">None</option>
                    {(categories.data?.items ?? []).map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Level">
                {(props) => (
                  <Select
                    {...props}
                    value={draft.skillLevel}
                    onChange={(event) => edit({ skillLevel: event.target.value as SkillLevel })}
                  >
                    {LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {statusLabel(level)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Length in minutes" optional>
                {(props) => (
                  <Input
                    {...props}
                    inputMode="numeric"
                    value={draft.durationMinutes}
                    onChange={(event) => edit({ durationMinutes: event.target.value })}
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

          <Panel title="Software">
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
            <Check
              checked={draft.featured}
              onChange={(checked) => edit({ featured: checked })}
              label="Feature this tutorial"
            />
          </Panel>

          {loaded ? (
            <Panel title="Danger">
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                Delete
              </Button>
            </Panel>
          ) : null}
        </aside>
      </div>

      <Confirm
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={remove}
        title="Delete this tutorial?"
        body="The tutorial and its steps are removed. Resources it linked are untouched."
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
