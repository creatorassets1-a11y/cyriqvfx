import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type Category, type ResourceCard, type TutorialDetail } from '../../lib/api';
import { useFetch } from '../../lib/hooks';
import {
  Marker,
  Button,
  ConfirmDialog,
  cx,
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

/**
 * Tutorial editor (PRD §23, §24). The resource links are the point, because a
 * tutorial that does not connect to what it uses is just a blog post.
 */

interface Step {
  title: string;
  body: string;
  timestampSeconds: number | null;
}

interface Form {
  title: string;
  slug: string;
  summary: string;
  body: string;
  categoryId: string | null;
  skillLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  durationSeconds: number | null;
  videoUrl: string;
  transcript: string;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
  softwareIds: string[];
  tags: string[];
  resourceIds: string[];
  steps: Step[];
}

const EMPTY: Form = {
  title: '',
  slug: '',
  summary: '',
  body: '',
  categoryId: null,
  skillLevel: 'BEGINNER',
  durationSeconds: null,
  videoUrl: '',
  transcript: '',
  featured: false,
  seoTitle: '',
  seoDescription: '',
  softwareIds: [],
  tags: [],
  resourceIds: [],
  steps: [],
};

export default function TutorialEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [form, setForm] = useState<Form>(EMPTY);
  const [tutorialId, setTutorialId] = useState<string | null>(id ?? null);
  const [loaded, setLoaded] = useState(!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const dirtyRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: categories } = useFetch<{ items: Category[] }>('/admin/taxonomy/categories');
  const { data: softwareList } = useFetch<{ items: Array<{ id: string; name: string }> }>(
    '/admin/taxonomy/software',
  );
  const { data: resources } = useFetch<{ items: ResourceCard[] }>(
    '/admin/resources?perPage=100',
  );
  const { data: existing, reload } = useFetch<{
    tutorial: TutorialDetail & {
      resourceIds: string[];
      softwareIds: string[];
      tagNames: string[];
    };
  }>(tutorialId ? `/admin/tutorials/${tutorialId}` : null);

  useEffect(() => {
    if (!existing?.tutorial || loaded) return;
    const t = existing.tutorial;
    setForm({
      title: t.title,
      slug: t.slug,
      summary: t.summary,
      body: t.body,
      categoryId: t.category?.id ?? null,
      skillLevel: t.skillLevel,
      durationSeconds: t.durationSeconds,
      videoUrl: t.isExternalVideo ? (t.videoUrl ?? '') : '',
      transcript: t.transcript ?? '',
      featured: t.featured,
      seoTitle: t.seoTitle ?? '',
      seoDescription: t.seoDescription ?? '',
      softwareIds: t.softwareIds,
      tags: t.tagNames,
      resourceIds: t.resourceIds,
      steps: t.steps.map((s) => ({
        title: s.title,
        body: s.body,
        timestampSeconds: s.timestampSeconds,
      })),
    });
    setLoaded(true);
  }, [existing, loaded]);

  const persist = useCallback(
    async (next: Form, silent = false) => {
      if (!next.title.trim() || !next.summary.trim()) return;
      setSaving(true);
      setError(null);
      try {
        const payload = {
          ...next,
          categoryId: next.categoryId || null,
          videoUrl: next.videoUrl || null,
          transcript: next.transcript || null,
          seoTitle: next.seoTitle || null,
          seoDescription: next.seoDescription || null,
        };
        if (tutorialId) {
          await api.patch(`/admin/tutorials/${tutorialId}`, payload);
        } else {
          const created = await api.post<{ tutorial: TutorialDetail }>('/admin/tutorials', payload);
          setTutorialId(created.tutorial.id);
          navigate(`/admin/tutorials/${created.tutorial.id}`, { replace: true });
        }
        dirtyRef.current = false;
        if (!silent) toast('Saved.', 'success');
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err);
          toast(err.message, 'error');
        }
      } finally {
        setSaving(false);
      }
    },
    [tutorialId, navigate, toast],
  );

  const update = useCallback(
    (patch: Partial<Form>) => {
      setForm((current) => {
        const next = { ...current, ...patch };
        dirtyRef.current = true;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void persist(next, true), 1400);
        return next;
      });
    },
    [persist],
  );

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const setStatus = async (status: string, notify = false) => {
    if (!tutorialId) return;
    try {
      await api.post(`/admin/tutorials/${tutorialId}/status`, { status, notify });
      toast(`Tutorial ${status.toLowerCase()}.`, 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work.', 'error');
    }
  };

  const attachCover = async (upload: CompletedUpload) => {
    if (!tutorialId) return;
    try {
      await api.post(`/admin/tutorials/${tutorialId}/media`, {
        uploadSessionId: upload.uploadSessionId,
        slot: 'cover',
      });
      toast('Cover updated.', 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not attach that.', 'error');
    }
  };

  const remove = async () => {
    if (!tutorialId) return;
    try {
      await api.del(`/admin/tutorials/${tutorialId}`);
      toast('Tutorial deleted.', 'success');
      navigate('/admin/tutorials');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not delete that.', 'error');
    }
  };

  if (id && !loaded) return <Skeleton className="h-96" />;

  const tutorial = existing?.tutorial;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/admin/tutorials" className="text-[13px] text-faint hover:text-ink">
            ← Tutorials
          </Link>
          <h1 className="mt-1 truncate text-[30px] leading-tight md:text-[34px]">
            {form.title || 'New tutorial'}
          </h1>
          {tutorial ? (
            <Marker tone={tutorial.status === 'PUBLISHED' ? 'go' : 'neutral'}>
              {tutorial.status.charAt(0) + tutorial.status.slice(1).toLowerCase()}
            </Marker>
          ) : null}
        </div>
        <Button variant="primary" icon="check" onClick={() => persist(form)} loading={saving}>
          Save
        </Button>
      </header>

      <Block title="Basics">
        <div className="flex flex-col gap-4">
          <TextField
            label="Title"
            required
            value={form.title}
            onChange={(e) => update({ title: e.target.value })}
            error={error?.fieldError('title')}
          />
          <TextArea
            label="Summary"
            required
            rows={2}
            value={form.summary}
            onChange={(e) => update({ summary: e.target.value })}
            hint="One or two sentences. Shown on cards and in search."
            error={error?.fieldError('summary')}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              label="Skill level"
              value={form.skillLevel}
              onChange={(e) => update({ skillLevel: e.target.value as Form['skillLevel'] })}
            >
              <option value="BEGINNER">Beginner</option>
              <option value="INTERMEDIATE">Intermediate</option>
              <option value="ADVANCED">Advanced</option>
            </SelectField>
            <SelectField
              label="Category"
              value={form.categoryId ?? ''}
              onChange={(e) => update({ categoryId: e.target.value || null })}
            >
              <option value="">None</option>
              {categories?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Duration (minutes)"
              type="number"
              min={0}
              value={form.durationSeconds ? Math.round(form.durationSeconds / 60) : ''}
              onChange={(e) =>
                update({ durationSeconds: e.target.value ? Number(e.target.value) * 60 : null })
              }
            />
          </div>
        </div>
      </Block>

      <Block title="Media">
        <div className="flex flex-col gap-4">
          <TextField
            label="Video URL"
            value={form.videoUrl}
            onChange={(e) => update({ videoUrl: e.target.value })}
            placeholder="https://www.youtube.com/watch?v=…"
            hint="YouTube or Vimeo. The player only loads after someone clicks play."
          />
          {tutorialId ? (
            <div>
              <p className="mb-2 text-[13px] font-semibold">Cover image</p>
              {tutorial?.coverUrl ? (
                <div className="well mb-2 aspect-video max-w-sm">
                  <img src={tutorial.coverUrl} alt="Current cover" loading="lazy" />
                </div>
              ) : null}
              <Uploader
                purpose="tutorial-media"
                label={tutorial?.coverUrl ? 'Replace cover' : 'Upload a cover image'}
                accept="image/png,image/jpeg,image/webp"
                onComplete={attachCover}
                compact={!!tutorial?.coverUrl}
              />
            </div>
          ) : (
            <p className="border-l-2 border-rule-strong py-1 pl-4 text-[13px] text-soft">
              Save the tutorial first, then add a cover image.
            </p>
          )}
        </div>
      </Block>

      {/* The resource connection, the differentiator the PRD calls out (§24) */}
      <Block
        title="Resources used"
        description="These appear beside the tutorial, and the tutorial appears on each resource page."
      >
        {!resources || resources.items.length === 0 ? (
          <p className="text-[13.5px] text-faint">No resources to link yet.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto border-y border-rule py-2">
            {resources.items.map((r) => (
              <label
                key={r.id}
                className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 transition-colors duration-fast hover:bg-sunk"
              >
                <input
                  type="checkbox"
                  checked={form.resourceIds.includes(r.id)}
                  onChange={(e) =>
                    update({
                      resourceIds: e.target.checked
                        ? [...form.resourceIds, r.id]
                        : form.resourceIds.filter((x) => x !== r.id),
                    })
                  }
                  className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--blue)]"
                />
                <span className="well h-8 w-12 shrink-0 overflow-hidden rounded">
                  {r.thumbnailUrl ? <img src={r.thumbnailUrl} alt="" loading="lazy" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{r.title}</span>
                <span className="shrink-0 text-[12px] text-faint">{r.category.name}</span>
              </label>
            ))}
          </div>
        )}
      </Block>

      <Block title="Software">
        <div className="flex flex-wrap gap-2">
          {softwareList?.items.map((s) => (
            <button
              key={s.id}
              onClick={() =>
                update({
                  softwareIds: form.softwareIds.includes(s.id)
                    ? form.softwareIds.filter((x) => x !== s.id)
                    : [...form.softwareIds, s.id],
                })
              }
              aria-pressed={form.softwareIds.includes(s.id)}
              className={cx(
                'text-[14px] underline-offset-4 transition-colors duration-fast',
                form.softwareIds.includes(s.id)
                  ? 'text-blue underline decoration-blue'
                  : 'text-faint hover:text-ink hover:underline',
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      </Block>

      <Block title="Written content">
        <div className="flex flex-col gap-4">
          <TextArea
            label="Intro"
            rows={5}
            value={form.body}
            onChange={(e) => update({ body: e.target.value })}
            hint="Context before the steps. Keep it short, because the steps do the work."
          />
          <TextArea
            label="Transcript"
            rows={4}
            value={form.transcript}
            onChange={(e) => update({ transcript: e.target.value })}
            hint="Optional. Collapsed by default on the page, and good for search."
          />
        </div>
      </Block>

      <Block
        title="Steps"
        description="Numbered sections with optional video timestamps."
        action={
          <Button
            size="sm"
            icon="plus"
            onClick={() =>
              update({ steps: [...form.steps, { title: '', body: '', timestampSeconds: null }] })
            }
          >
            Add step
          </Button>
        }
      >
        {form.steps.length === 0 ? (
          <p className="text-[13.5px] text-faint">No steps yet.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {form.steps.map((step, i) => (
              <li key={i} className="border-b border-rule py-3.5">
                <div className="mb-2.5 flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-wash font-mono text-[12px] font-bold text-blue">
                    {i + 1}
                  </span>
                  <div className="ml-auto flex gap-1">
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => {
                        if (i === 0) return;
                        const next = [...form.steps];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        update({ steps: next });
                      }}
                      disabled={i === 0}
                      aria-label="Move step up"
                    >
                      <Icon name="chevron-down" size={13} className="rotate-180" />
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => {
                        if (i === form.steps.length - 1) return;
                        const next = [...form.steps];
                        [next[i], next[i + 1]] = [next[i + 1], next[i]];
                        update({ steps: next });
                      }}
                      disabled={i === form.steps.length - 1}
                      aria-label="Move step down"
                    >
                      <Icon name="chevron-down" size={13} />
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      icon="trash"
                      onClick={() => update({ steps: form.steps.filter((_, x) => x !== i) })}
                      aria-label="Remove step"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <TextField
                    label="Step title"
                    value={step.title}
                    onChange={(e) => {
                      const next = [...form.steps];
                      next[i] = { ...step, title: e.target.value };
                      update({ steps: next });
                    }}
                  />
                  <TextArea
                    label="What to do"
                    rows={3}
                    value={step.body}
                    onChange={(e) => {
                      const next = [...form.steps];
                      next[i] = { ...step, body: e.target.value };
                      update({ steps: next });
                    }}
                  />
                  <TextField
                    label="Timestamp (seconds)"
                    type="number"
                    min={0}
                    value={step.timestampSeconds ?? ''}
                    onChange={(e) => {
                      const next = [...form.steps];
                      next[i] = {
                        ...step,
                        timestampSeconds: e.target.value ? Number(e.target.value) : null,
                      };
                      update({ steps: next });
                    }}
                    hint="Optional. Links the step to a point in the video."
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Block>

      <Block title="Publishing">
        <div className="flex flex-col gap-4">
          <Toggle
            label="Feature this tutorial"
            checked={form.featured}
            onChange={(v) => update({ featured: v })}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon="check"
              disabled={!tutorialId}
              onClick={() => setStatus('PUBLISHED', true)}
            >
              Publish
            </Button>
            <Button disabled={!tutorialId} onClick={() => setStatus('DRAFT')}>
              Back to draft
            </Button>
            {tutorialId ? (
              <Button
                variant="danger"
                icon="trash"
                className="ml-auto"
                onClick={() => setDeleteOpen(true)}
              >
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      </Block>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={remove}
        title="Delete this tutorial?"
        description="The tutorial and its cover image are removed. Linked resources are not affected. This cannot be undone."
        confirmLabel="Delete permanently"
        destructive
      />
    </div>
  );
}
