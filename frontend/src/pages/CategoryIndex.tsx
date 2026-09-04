import { Link } from 'react-router-dom';
import { useLoad } from '../lib/hooks';
import type { Category } from '../lib/types';
import { PageError } from '../components/Chrome';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/primitives';

/**
 * Categories.
 *
 * Categories are rows in the database that the owner controls, not constants
 * in the code, so this page renders whatever they have made — including the
 * subcategories under each one, which are usually the more useful link.
 */
export default function CategoryIndex() {
  const { data, error, loading, reload } = useLoad<{ items: Category[] }>('/categories');

  if (error) return <PageError onRetry={reload} />;

  return (
    <div className="page py-10 md:py-14">
      <header className="mb-10">
        <h1 className="text-[34px] md:text-[42px]">Categories</h1>
        <p className="prose mt-3">
          Everything in the library, grouped by what it is and what it is for.
        </p>
      </header>

      {loading || !data ? (
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <ul className="grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
          {data.items.map((category) => (
            <li key={category.id} className="group relative border-t border-line pt-4">
              <h2 className="text-[21px]">
                <Link
                  to={`/categories/${category.slug}`}
                  className="card-link transition-colors duration-fast ease-out group-hover:text-accent"
                >
                  {category.name}
                </Link>
              </h2>

              <p className="mt-1 font-mono text-[12px] text-text-4">
                {category.resourceCount}{' '}
                {category.resourceCount === 1 ? 'resource' : 'resources'}
              </p>

              {category.description ? (
                <p className="mt-2 text-[13.5px] leading-relaxed text-text-3">
                  {category.description}
                </p>
              ) : null}

              {category.children.length ? (
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  {category.children.map((child) => (
                    <li key={child.id} className="relative z-[2]">
                      <Link
                        to={`/resources?subcategory=${child.slug}`}
                        className="text-[13px] text-text-3 hover:text-accent"
                      >
                        {child.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}

              <p className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-text-4 transition-colors duration-fast ease-out group-hover:text-accent">
                Open
                <Icon name="arrow-right" size={13} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
