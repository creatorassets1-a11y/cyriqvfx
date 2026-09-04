import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { query } from '../lib/api';
import { useDebounced, useIsDesktop, useLoad } from '../lib/hooks';
import type { Facets, Paged, ResourceCard as Card } from '../lib/types';
import { CardGrid, CardGridSkeleton, ResourceCard } from '../components/ResourceCard';
import { PageError } from '../components/Chrome';
import { Icon } from '../ui/Icon';
import { Button, ButtonLink, Check, cx, Empty, Input, Pagination, Select } from '../ui/primitives';

/**
 * The library.
 *
 * Every choice a visitor makes lives in the URL, so a filtered view is a link
 * they can send to someone: the page is completely described by its query
 * string and nothing is hidden in component state. On a phone the facets fold
 * into a sheet, but the search field never does — searching is the thing most
 * people came to do.
 */

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most downloaded' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'az', label: 'A to Z' },
];

/** Multi-value facets travel as a comma-separated list, as the API expects. */
function toggleCsv(current: string | null, value: string): string {
  const values = current ? current.split(',').filter(Boolean) : [];
  const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  return next.join(',');
}

export default function Library() {
  const [params, setParams] = useSearchParams();
  const desktop = useIsDesktop();
  const [facetsOpen, setFacetsOpen] = useState(false);

  const urlTerm = params.get('q') ?? '';
  const [term, setTerm] = useState(urlTerm);
  const debouncedTerm = useDebounced(term, 250);

  // The field owns the typing; the URL owns the result. They meet here.
  useEffect(() => {
    setTerm(urlTerm);
  }, [urlTerm]);

  useEffect(() => {
    if (debouncedTerm === urlTerm) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (debouncedTerm) next.set('q', debouncedTerm);
        else next.delete('q');
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [debouncedTerm, urlTerm, setParams]);

  const page = Number(params.get('page') ?? '1');
  const path = useMemo(
    () =>
      `/resources${query({
        q: params.get('q'),
        category: params.get('category'),
        software: params.get('software'),
        tag: params.get('tag'),
        format: params.get('format'),
        license: params.get('license'),
        commercial: params.get('commercial'),
        flag: params.get('flag'),
        sort: params.get('sort') ?? 'newest',
        page: page > 1 ? page : undefined,
      })}`,
    [params, page],
  );

  const listing = useLoad<Paged<Card>>(path);
  const facets = useLoad<Facets>('/resources/facets');

  function update(key: string, value: string | null) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('page');
      return next;
    });
  }

  const active = ['category', 'software', 'tag', 'format', 'license', 'commercial', 'flag'].filter(
    (key) => params.get(key),
  );

  if (listing.error) return <PageError onRetry={listing.reload} />;

  return (
    <div className="page py-10 md:py-14">
      <header className="mb-8">
        <h1 className="text-[34px] md:text-[42px]">Resources</h1>
        <p className="prose mt-3">
          Everything in the library, free to download. Filter by software, format or license, or
          search for what you need.
        </p>
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <label htmlFor="library-search" className="sr-only">
            Search resources
          </label>
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-4"
          />
          <Input
            id="library-search"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Scene packs, LUTs, transitions…"
            className="pl-9"
          />
        </div>

        <label className="shrink-0">
          <span className="sr-only">Sort by</span>
          <Select
            value={params.get('sort') ?? 'newest'}
            onChange={(event) => update('sort', event.target.value)}
            className="w-auto"
          >
            {SORTS.map((sort) => (
              <option key={sort.value} value={sort.value}>
                {sort.label}
              </option>
            ))}
          </Select>
        </label>

        {desktop ? null : (
          <Button icon="filter" onClick={() => setFacetsOpen(true)} className="shrink-0">
            Filters{active.length ? ` (${active.length})` : ''}
          </Button>
        )}
      </div>

      <div className="grid gap-10 lg:grid-cols-[220px_1fr] lg:gap-12">
        {desktop ? (
          <FacetPanel facets={facets.data} params={params} onChange={update} />
        ) : facetsOpen ? (
          <div className="fixed inset-0 z-[80] flex items-end lg:hidden">
            <div
              className="absolute inset-0 bg-[var(--scrim)] animate-fade"
              onClick={() => setFacetsOpen(false)}
              aria-hidden="true"
            />
            <div className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-lg border-t border-line-strong bg-raised p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] animate-sheet">
              <div className="mb-4 flex items-center justify-between">
                <p className="kicker">Filters</p>
                <button
                  type="button"
                  onClick={() => setFacetsOpen(false)}
                  aria-label="Close filters"
                  className="p-1 text-text-3"
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
              <FacetPanel facets={facets.data} params={params} onChange={update} />
              <Button variant="primary" block className="mt-5" onClick={() => setFacetsOpen(false)}>
                Show results
              </Button>
            </div>
          </div>
        ) : null}

        <div className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <p role="status" className="font-mono text-[12.5px] text-text-3">
              {listing.loading && !listing.data
                ? 'Loading…'
                : `${listing.data?.total ?? 0} ${listing.data?.total === 1 ? 'resource' : 'resources'}`}
            </p>

            {active.length ? (
              <button
                type="button"
                onClick={() =>
                  setParams((current) => {
                    const next = new URLSearchParams(current);
                    active.forEach((key) => next.delete(key));
                    next.delete('page');
                    return next;
                  })
                }
                className="text-[12.5px] text-text-3 hover:text-text"
              >
                Clear {active.length} {active.length === 1 ? 'filter' : 'filters'}
              </button>
            ) : null}
          </div>

          {listing.loading && !listing.data ? (
            <CardGridSkeleton count={8} />
          ) : listing.data && listing.data.items.length > 0 ? (
            <>
              <CardGrid columns={3}>
                {listing.data.items.map((resource) => (
                  <ResourceCard key={resource.id} resource={resource} level={2} />
                ))}
              </CardGrid>
              <Pagination
                page={listing.data.page}
                totalPages={listing.data.totalPages}
                onPage={(next) => update('page', String(next))}
              />
            </>
          ) : params.get('q') ? (
            <Empty
              icon="search"
              title="Nothing matched that search"
              body={`No resource matches “${params.get('q')}”. Try a shorter phrase, or browse by category instead.`}
              action={<ButtonLink to="/categories">Browse categories</ButtonLink>}
            />
          ) : (
            <Empty
              icon="filter"
              title="No resources match those filters"
              body="Nothing in the library fits every filter at once. Try removing one."
              action={
                <Button
                  onClick={() =>
                    setParams((current) => {
                      const next = new URLSearchParams(current);
                      active.forEach((key) => next.delete(key));
                      return next;
                    })
                  }
                >
                  Clear filters
                </Button>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FacetPanel({
  facets,
  params,
  onChange,
}: {
  facets: Facets | null;
  params: URLSearchParams;
  onChange: (key: string, value: string | null) => void;
}) {
  if (!facets) {
    return (
      <aside className="hidden lg:block" aria-hidden="true">
        <div className="loading h-64 w-full rounded" />
      </aside>
    );
  }

  const software = params.get('software');
  const tags = params.get('tag');

  return (
    <aside className="flex flex-col gap-7">
      <FacetGroup title="Category">
        <ul className="flex flex-col gap-1.5">
          {facets.categories.map((category) => {
            const selected = params.get('category') === category.slug;
            return (
              <li key={category.id}>
                <button
                  type="button"
                  onClick={() => onChange('category', selected ? null : category.slug)}
                  className={cx(
                    'flex w-full items-baseline justify-between gap-3 text-left text-[13.5px]',
                    selected ? 'text-accent' : 'text-text-2 hover:text-text',
                  )}
                >
                  <span>{category.name}</span>
                  <span className="font-mono text-[11.5px] text-text-4">{category.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </FacetGroup>

      <FacetGroup title="Works with">
        <div className="flex flex-col gap-2">
          {facets.software.map((item) => (
            <Check
              key={item.id}
              checked={(software ?? '').split(',').includes(item.slug)}
              onChange={() => onChange('software', toggleCsv(software, item.slug) || null)}
              label={
                <span className="flex items-baseline justify-between gap-3">
                  <span>{item.name}</span>
                  <span className="font-mono text-[11.5px] text-text-4">{item.count}</span>
                </span>
              }
            />
          ))}
        </div>
      </FacetGroup>

      <FacetGroup title="License">
        <div className="flex flex-col gap-2">
          <Check
            checked={params.get('commercial') === 'true'}
            onChange={(checked) => onChange('commercial', checked ? 'true' : null)}
            label="Commercial use allowed"
          />
          {facets.licenses.map((license) => (
            <Check
              key={license.id}
              checked={params.get('license') === license.slug}
              onChange={(checked) => onChange('license', checked ? license.slug : null)}
              label={
                <span className="flex items-baseline justify-between gap-3">
                  <span>{license.name}</span>
                  <span className="font-mono text-[11.5px] text-text-4">{license.count}</span>
                </span>
              }
            />
          ))}
        </div>
      </FacetGroup>

      {facets.formats.length ? (
        <FacetGroup title="Format">
          <div className="flex flex-wrap gap-1.5">
            {facets.formats.map((format) => {
              const selected = params.get('format') === format.value;
              return (
                <button
                  key={format.value}
                  type="button"
                  onClick={() => onChange('format', selected ? null : format.value)}
                  className={cx(
                    'rounded-full border px-2.5 py-1 font-mono text-[11.5px] transition-colors duration-fast ease-out',
                    selected
                      ? 'border-accent text-accent'
                      : 'border-line-strong text-text-3 hover:text-text',
                  )}
                >
                  {format.value}
                </button>
              );
            })}
          </div>
        </FacetGroup>
      ) : null}

      {facets.tags.length ? (
        <FacetGroup title="Tags">
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {facets.tags.slice(0, 18).map((tag) => {
              const selected = (tags ?? '').split(',').includes(tag.slug);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => onChange('tag', toggleCsv(tags, tag.slug) || null)}
                  className={cx(
                    'text-[13px] transition-colors duration-fast ease-out',
                    selected ? 'text-accent' : 'text-text-3 hover:text-text',
                  )}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </FacetGroup>
      ) : null}

      <p className="border-t border-line pt-4 text-[12.5px] leading-relaxed text-text-4">
        Looking for something that is not here?{' '}
        <Link to="/requests" className="underlined">
          Request it
        </Link>
        .
      </p>
    </aside>
  );
}

function FacetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="kicker mb-3 border-b border-line pb-2">{title}</h2>
      {children}
    </section>
  );
}
