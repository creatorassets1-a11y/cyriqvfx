import { Link, useSearchParams } from 'react-router-dom';
import { useFetch, useTitle } from '../lib/hooks';
import type { Paged, TutorialCard } from '../lib/api';
import { Marker, cx, EmptyState, LinkButton, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatDuration, skillLabel } from '../lib/format';
import { PageError } from '../components/Layout';

const LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;

export default function Tutorials() {
  const [params, setParams] = useSearchParams();
  useTitle('Editing tutorials · Cyriq VFX');

  const { data, loading, error, reload } = useFetch<
    Paged<TutorialCard> & { facets: { software: Array<{ id: string; name: string; slug: string; count: number }> } }
  >(`/tutorials?${params.toString()}`);

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next);
  };

  if (error) return <PageError onRetry={reload} />;

  const level = params.get('level');
  const software = params.get('software');

  return (
    <div className="page py-10 md:py-16">
      <header className="border-b border-ink pb-4">
        <p className="eyebrow">Shown, not told</p>
        <h1 className="mt-2 text-[38px] leading-[1.05] md:text-[52px]">Tutorials</h1>
        <p className="copy mt-3">
          Each one links the exact resources it uses, so you can follow along with the same files.
        </p>
      </header>

      <div className="mb-10 mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
        <FilterPill active={!level && !software} onClick={() => setParams(new URLSearchParams())}>
          All
        </FilterPill>
        {LEVELS.map((l) => (
          <FilterPill
            key={l}
            active={level === l}
            onClick={() => setFilter('level', level === l ? null : l)}
          >
            {skillLabel(l)}
          </FilterPill>
        ))}
        {data?.facets.software.map((s) => (
          <FilterPill
            key={s.id}
            active={software === s.slug}
            onClick={() => setFilter('software', software === s.slug ? null : s.slug)}
          >
            {s.name}
          </FilterPill>
        ))}
      </div>

      {loading && !data ? (
        <div className="grid gap-x-8 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="border-t border-rule pt-4">
              <Skeleton className="mb-3 aspect-video w-full" />
              <Skeleton className="mb-2 h-5 w-3/4" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon="play"
          title="Tutorials are coming soon"
          description={
            level || software
              ? 'Nothing matches those filters yet. Try clearing them.'
              : 'There are no published tutorials yet. In the meantime, the resource pages include full install and usage notes.'
          }
          action={<LinkButton to="/resources">Browse resources</LinkButton>}
        />
      ) : (
        <div className="grid gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
          {data.items.map((t) => (
            <article key={t.id} className="group min-w-0 border-t border-rule pt-4">
              <Link to={`/tutorials/${t.slug}`} className="block">
                <div className="well aspect-video">
                  {t.coverUrl ? (
                    <img
                      src={t.coverUrl}
                      alt=""
                      loading="lazy"
                      width={640}
                      height={360}
                      className="transition-transform duration-normal ease-out md:group-hover:scale-[1.04]"
                    />
                  ) : null}
                  <span
                    className="absolute inset-0 grid place-items-center text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)] transition-transform duration-fast ease-spring group-hover:scale-110"
                    aria-hidden
                  >
                    <Icon name="play" size={32} />
                  </span>
                  {t.durationSeconds ? (
                    <span className="absolute bottom-2 right-2 font-mono text-[11px] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                      {formatDuration(t.durationSeconds)}
                    </span>
                  ) : null}
                </div>

                <div className="pt-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <Marker tone="blue">{skillLabel(t.skillLevel)}</Marker>
                    {t.resourceCount > 0 ? (
                      <span className="font-mono text-[11.5px] text-ghost">
                        {t.resourceCount} {t.resourceCount === 1 ? 'resource' : 'resources'}
                      </span>
                    ) : null}
                  </div>
                  <h2 className="mt-1.5 font-display text-[21px] leading-[1.13] transition-colors duration-fast group-hover:text-blue">
                    {t.title}
                  </h2>
                  <p className="mt-2 line-clamp-2 text-[14px] leading-relaxed text-soft">
                    {t.summary}
                  </p>
                </div>
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'text-[14px] underline-offset-[6px] transition-colors duration-fast',
        active
          ? 'text-blue underline decoration-blue decoration-2'
          : 'text-faint hover:text-ink hover:underline hover:decoration-rule-strong',
      )}
    >
      {children}
    </button>
  );
}
