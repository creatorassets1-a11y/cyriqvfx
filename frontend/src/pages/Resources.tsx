import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebounced, useFetch, useIsDesktop } from '../lib/hooks';
import type { Facets, Paged, ResourceCard as ResourceCardType } from '../lib/api';
import { ResourceCard, ResourceCardSkeleton } from '../components/ResourceCard';
import { Button, cx, EmptyState, LinkButton, Sheet } from '../components/ui';
import { Icon } from '../components/Icon';
import { PageError } from '../components/Layout';
import { useTitle } from '../lib/hooks';

/**
 * Resource library (PRD §10).
 *
 * Filters live in the URL so a filtered view is shareable and the back button
 * works. Desktop gets a persistent sidebar; mobile gets a bottom sheet rather
 * than a wall of controls above the results.
 */

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most downloaded' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'az', label: 'A to Z' },
] as const;

const PER_PAGE = 24;

export default function Resources() {
  const [params, setParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '');
  const debouncedSearch = useDebounced(searchInput, 300);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [accumulated, setAccumulated] = useState<ResourceCardType[]>([]);
  const isDesktop = useIsDesktop();

  useTitle('Browse free editing resources · Cyriq VFX');

  const page = Number(params.get('page') ?? 1);

  // Typing updates the URL, but never adds a history entry per keystroke.
  useEffect(() => {
    const current = params.get('q') ?? '';
    if (debouncedSearch === current) return;
    const next = new URLSearchParams(params);
    if (debouncedSearch) next.set('q', debouncedSearch);
    else next.delete('q');
    next.delete('page');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = useMemo(() => {
    const q = new URLSearchParams(params);
    q.set('perPage', String(PER_PAGE));
    if (!q.get('page')) q.set('page', '1');
    return q.toString();
  }, [params]);

  const { data, loading, error, reload } = useFetch<Paged<ResourceCardType>>(`/resources?${query}`);
  const { data: facets } = useFetch<Facets>('/resources/facets');

  // "Load more" appends; a filter change replaces.
  useEffect(() => {
    if (!data) return;
    setAccumulated((prev) => (data.page === 1 ? data.items : [...prev, ...data.items]));
  }, [data]);

  const setFilter = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('page');
      setParams(next);
      setAccumulated([]);
    },
    [params, setParams],
  );

  const toggleMulti = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params);
      const current = (next.get(key) ?? '').split(',').filter(Boolean);
      const updated = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      if (updated.length) next.set(key, updated.join(','));
      else next.delete(key);
      next.delete('page');
      setParams(next);
      setAccumulated([]);
    },
    [params, setParams],
  );

  const clearAll = useCallback(() => {
    setSearchInput('');
    setParams(new URLSearchParams());
    setAccumulated([]);
  }, [setParams]);

  const activeFilters = useMemo(() => {
    const list: Array<{ key: string; value: string; label: string }> = [];
    const add = (key: string, label: string, value: string) => list.push({ key, value, label });

    const category = params.get('category');
    if (category) {
      add('category', facets?.categories.find((c) => c.slug === category)?.name ?? category, category);
    }
    for (const slug of (params.get('software') ?? '').split(',').filter(Boolean)) {
      add('software', facets?.software.find((s) => s.slug === slug)?.name ?? slug, slug);
    }
    for (const slug of (params.get('tag') ?? '').split(',').filter(Boolean)) {
      add('tag', facets?.tags.find((t) => t.slug === slug)?.name ?? slug, slug);
    }
    for (const value of (params.get('format') ?? '').split(',').filter(Boolean)) {
      add('format', value, value);
    }
    const license = params.get('license');
    if (license) add('license', facets?.licenses.find((l) => l.slug === license)?.name ?? license, license);
    if (params.get('commercial') === 'true') add('commercial', 'Commercial use OK', 'true');
    return list;
  }, [params, facets]);

  const removeFilter = useCallback(
    (key: string, value: string) => {
      if (key === 'software' || key === 'tag' || key === 'format') toggleMulti(key, value);
      else setFilter(key, null);
    },
    [toggleMulti, setFilter],
  );

  const loadMore = useCallback(() => {
    const next = new URLSearchParams(params);
    next.set('page', String(page + 1));
    setParams(next, { replace: true });
  }, [params, page, setParams]);

  const sort = params.get('sort') ?? 'newest';
  const showSkeletons = loading && accumulated.length === 0;

  if (error) return <PageError onRetry={reload} />;

  const filterPanel = facets ? (
    <FilterControls
      facets={facets}
      params={params}
      onToggle={toggleMulti}
      onSet={setFilter}
    />
  ) : (
    <div className="flex flex-col gap-6">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="shimmer h-24" />
      ))}
    </div>
  );

  return (
    <div className="page py-10 md:py-16">
      <header className="border-b border-ink pb-4">
        <p className="eyebrow">The library</p>
        <h1 className="mt-2 text-[38px] leading-[1.05] md:text-[52px]">Resources</h1>
        <p className="copy mt-3">
          Everything in the library. Free, with clear licenses and no signup.
        </p>
      </header>

      {/* Search and sort. Both are ruled lines rather than filled controls. */}
      <div className="mt-8 flex flex-wrap items-end gap-x-8 gap-y-5">
        <div className="min-w-0 flex-1 sm:max-w-md">
          <label htmlFor="library-search" className="sr-only">
            Search resources
          </label>
          <div className="flex items-center gap-2 border-b border-rule-strong pb-1.5 transition-colors duration-fast focus-within:border-blue hover:border-ink">
            <Icon name="search" size={16} className="shrink-0 text-ghost" />
            <input
              id="library-search"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name, tag or software"
              className="w-full min-w-0 border-0 bg-transparent p-0 text-[15px] text-ink placeholder:text-ghost focus:outline-none focus:ring-0"
            />
          </div>
        </div>

        <div className="flex items-end gap-6">
          <div>
            <label htmlFor="sort" className="eyebrow mb-1.5 block">
              Sort
            </label>
            <div className="relative border-b border-rule-strong pb-1.5 transition-colors duration-fast focus-within:border-blue hover:border-ink">
              <select
                id="sort"
                value={sort}
                onChange={(e) => setFilter('sort', e.target.value === 'newest' ? null : e.target.value)}
                className="appearance-none border-0 bg-transparent p-0 pr-6 text-[14.5px] text-ink focus:outline-none focus:ring-0"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <Icon
                name="chevron-down"
                size={14}
                className="pointer-events-none absolute bottom-2 right-0 text-ghost"
              />
            </div>
          </div>

          <Button icon="filter" onClick={() => setFiltersOpen(true)} className="lg:hidden">
            Filters
            {activeFilters.length > 0 ? (
              <span className="ml-1 font-mono text-[12px] text-blue">{activeFilters.length}</span>
            ) : null}
          </Button>
        </div>
      </div>

      {/* Active filters stay visible, so the state of the view is never a mystery. */}
      {activeFilters.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="eyebrow">Filtered by</span>
          {activeFilters.map((f) => (
            <button
              key={`${f.key}-${f.value}`}
              onClick={() => removeFilter(f.key, f.value)}
              className="group inline-flex items-center gap-1.5 text-[13px] text-blue"
            >
              <span className="underline decoration-blue-lighter underline-offset-4 group-hover:decoration-blue">
                {f.label}
              </span>
              <Icon name="close" size={11} />
            </button>
          ))}
          <button
            onClick={clearAll}
            className="text-[13px] text-faint underline-offset-4 hover:text-ink hover:underline"
          >
            Clear all
          </button>
        </div>
      ) : null}

      <div className="mt-8 grid gap-x-12 gap-y-8 lg:grid-cols-[220px_1fr]">
        <aside className="hidden min-w-0 lg:block lg:border-r lg:border-rule lg:pr-8">
          <div className="sticky top-[calc(var(--bar)+1.5rem)] max-h-[calc(100vh-var(--bar)-3rem)] overflow-y-auto">
            {filterPanel}
          </div>
        </aside>

        <div className="min-w-0">
          <p className="mb-6 font-mono text-[12.5px] text-faint" role="status" aria-live="polite">
            {loading && !data
              ? 'Loading resources'
              : data
                ? `${data.total} ${data.total === 1 ? 'resource' : 'resources'}`
                : ''}
          </p>

          {showSkeletons ? (
            <div className="grid grid-cols-1 gap-x-8 gap-y-10 min-[560px]:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <ResourceCardSkeleton key={i} />
              ))}
            </div>
          ) : accumulated.length === 0 ? (
            <EmptyState
              icon="search"
              title="Nothing matched that search"
              description={
                activeFilters.length > 0
                  ? 'Try a broader keyword, or remove one of the filters above.'
                  : 'Try a broader keyword.'
              }
              action={
                activeFilters.length > 0 ? (
                  <Button onClick={clearAll}>Clear filters</Button>
                ) : (
                  <LinkButton to="/categories">Browse categories</LinkButton>
                )
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-x-8 gap-y-10 min-[560px]:grid-cols-2 xl:grid-cols-3">
                {accumulated.map((r) => (
                  <ResourceCard key={r.id} resource={r} />
                ))}
              </div>

              {data?.hasMore ? (
                <div className="mt-12 flex justify-center border-t border-rule pt-8">
                  <Button size="lg" onClick={loadMore} loading={loading}>
                    Load more
                  </Button>
                </div>
              ) : accumulated.length > PER_PAGE ? (
                <p className="mt-12 border-t border-rule pt-8 text-center font-mono text-[12.5px] text-faint">
                  That is everything.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Mobile filters live in a sheet, not stacked above the results (PRD §10) */}
      {!isDesktop ? (
        <Sheet
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          title="Filters"
          footer={
            <div className="flex gap-2">
              <Button fullWidth onClick={clearAll}>
                Clear all
              </Button>
              <Button variant="primary" fullWidth onClick={() => setFiltersOpen(false)}>
                Show {data?.total ?? 0} results
              </Button>
            </div>
          }
        >
          {filterPanel}
        </Sheet>
      ) : null}
    </div>
  );
}

function FilterControls({
  facets,
  params,
  onToggle,
  onSet,
}: {
  facets: Facets;
  params: URLSearchParams;
  onToggle: (key: string, value: string) => void;
  onSet: (key: string, value: string | null) => void;
}) {
  const selected = (key: string) => (params.get(key) ?? '').split(',').filter(Boolean);

  return (
    <div className="flex flex-col">
      <FilterGroup title="Category" defaultOpen>
        <div className="flex flex-col gap-0.5">
          <FilterOption
            label="All categories"
            checked={!params.get('category')}
            onChange={() => onSet('category', null)}
            type="radio"
          />
          {facets.categories.map((c) => (
            <FilterOption
              key={c.id}
              label={c.name}
              count={c.count}
              checked={params.get('category') === c.slug}
              onChange={() => onSet('category', c.slug)}
              type="radio"
            />
          ))}
        </div>
      </FilterGroup>

      {facets.software.length > 0 ? (
        <FilterGroup title="Works with" defaultOpen>
          <div className="flex flex-col gap-0.5">
            {facets.software.map((s) => (
              <FilterOption
                key={s.id}
                label={s.name}
                count={s.count}
                checked={selected('software').includes(s.slug)}
                onChange={() => onToggle('software', s.slug)}
              />
            ))}
          </div>
        </FilterGroup>
      ) : null}

      <FilterGroup title="License">
        <div className="flex flex-col gap-0.5">
          <FilterOption
            label="Commercial use OK"
            checked={params.get('commercial') === 'true'}
            onChange={() => onSet('commercial', params.get('commercial') === 'true' ? null : 'true')}
          />
          {facets.licenses.map((l) => (
            <FilterOption
              key={l.id}
              label={l.name}
              count={l.count}
              checked={params.get('license') === l.slug}
              onChange={() => onSet('license', params.get('license') === l.slug ? null : l.slug)}
            />
          ))}
        </div>
      </FilterGroup>

      {facets.formats.length > 0 ? (
        <FilterGroup title="Format">
          <div className="flex flex-wrap gap-1.5">
            {facets.formats.map((f) => (
              <button
                key={f.value}
                onClick={() => onToggle('format', f.value)}
                aria-pressed={selected('format').includes(f.value)}
                className={cx(
                  'font-mono text-[12px] underline-offset-4 transition-colors duration-fast',
                  selected('format').includes(f.value)
                    ? 'text-blue underline decoration-blue'
                    : 'text-faint hover:text-ink hover:underline',
                )}
              >
                {f.value}
              </button>
            ))}
          </div>
        </FilterGroup>
      ) : null}

      {facets.tags.length > 0 ? (
        <FilterGroup title="Tags">
          <div className="flex flex-wrap gap-1.5">
            {facets.tags.slice(0, 24).map((t) => (
              <button
                key={t.id}
                onClick={() => onToggle('tag', t.slug)}
                aria-pressed={selected('tag').includes(t.slug)}
                className={cx(
                  'text-[12.5px] underline-offset-4 transition-colors duration-fast',
                  selected('tag').includes(t.slug)
                    ? 'text-blue underline decoration-blue'
                    : 'text-faint hover:text-ink hover:underline',
                )}
              >
                {t.name}
              </button>
            ))}
          </div>
        </FilterGroup>
      ) : null}
    </div>
  );
}

function FilterGroup({
  title,
  children,
  defaultOpen,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <section className="border-b border-rule py-4 first:pt-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <h3 className="eyebrow">{title}</h3>
        <Icon
          name="chevron-down"
          size={15}
          className={cx('text-ghost transition-transform duration-fast', open && 'rotate-180')}
        />
      </button>
      {/* Content is unmounted when closed, so nothing renders off-screen. */}
      {open ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

function FilterOption({
  label,
  count,
  checked,
  onChange,
  type = 'checkbox',
}: {
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
  type?: 'checkbox' | 'radio';
}) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-center gap-2.5 py-1.5 transition-colors duration-fast',
        'hover:text-ink',
      )}
    >
      <input
        type={type}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--blue)]"
      />
      <span className={cx('flex-1 text-[13.5px]', checked ? 'text-ink' : 'text-soft')}>{label}</span>
      {count !== undefined ? (
        <span className="shrink-0 font-mono text-[11.5px] text-ghost">{count}</span>
      ) : null}
    </label>
  );
}
