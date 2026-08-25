import { Link } from 'react-router-dom';
import { useFetch, useTitle } from '../lib/hooks';
import type { Category } from '../lib/api';
import { EmptyState, Skeleton } from '../components/ui';
import { Icon, categoryIcon } from '../components/Icon';
import { PageError } from '../components/Layout';

/**
 * The index of shelves. Set as a list, so the names carry the page and the
 * counts line up down one edge.
 */
export default function Categories() {
  const { data, loading, error, reload } = useFetch<{ items: Category[] }>('/categories');
  useTitle('Categories · Cyriq VFX');

  if (error) return <PageError onRetry={reload} />;

  return (
    <div className="page py-10 md:py-16">
      <header className="border-b border-ink pb-4">
        <p className="eyebrow">Index</p>
        <h1 className="mt-2 text-[38px] leading-[1.05] md:text-[52px]">Categories</h1>
        <p className="copy mt-3">Everything in the library, grouped by what it is.</p>
      </header>

      {loading ? (
        <div className="mt-8 flex flex-col gap-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon="folder"
          title="No categories yet"
          description="Categories appear here once the library has resources in them."
        />
      ) : (
        <ul className="mt-4 flex flex-col">
          {data.items.map((c) => (
            <li key={c.id} className="border-b border-rule">
              <Link
                to={`/categories/${c.slug}`}
                className="group grid grid-cols-[auto_1fr_auto] items-baseline gap-x-5 py-6 md:grid-cols-[auto_minmax(0,22rem)_1fr_auto]"
              >
                <Icon
                  name={categoryIcon(c.icon)}
                  size={20}
                  className="translate-y-1 text-ghost transition-colors duration-fast group-hover:text-blue"
                />

                <span className="min-w-0">
                  <h2 className="font-display text-[24px] leading-tight transition-colors duration-fast group-hover:text-blue md:text-[28px]">
                    {c.name}
                  </h2>
                  {c.children.length > 0 ? (
                    <span className="mt-1.5 block truncate text-[12.5px] text-ghost">
                      {c.children.slice(0, 3).map((child) => child.name).join(', ')}
                      {c.children.length > 3 ? `, plus ${c.children.length - 3} more` : ''}
                    </span>
                  ) : null}
                </span>

                {c.description ? (
                  <span className="col-span-2 col-start-2 mt-2 block max-w-[52ch] text-[14px] leading-relaxed text-soft md:col-span-1 md:col-start-3 md:mt-0 md:pr-8">
                    {c.description}
                  </span>
                ) : (
                  <span className="hidden md:block" />
                )}

                <span className="col-start-3 row-start-1 justify-self-end font-mono text-[12.5px] text-ghost md:col-start-4">
                  {c.resourceCount}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
