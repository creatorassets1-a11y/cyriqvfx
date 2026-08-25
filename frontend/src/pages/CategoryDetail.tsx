import { Link, useParams } from 'react-router-dom';
import { useFetch, useTitle } from '../lib/hooks';
import type { Category, ResourceCard as ResourceCardType } from '../lib/api';
import { ResourceCard, ResourceCardSkeleton } from '../components/ResourceCard';
import { EmptyState, LinkButton, MoreLink, Skeleton } from '../components/ui';
import { Icon, categoryIcon } from '../components/Icon';
import NotFound from './NotFound';
import { PageError } from '../components/Layout';

interface CategoryPage {
  category: Category;
  featured: ResourceCardType[];
  latest: ResourceCardType[];
  popular: ResourceCardType[];
  total: number;
}

/** Category landing page (PRD §45). */
export default function CategoryDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { data, loading, error, reload } = useFetch<CategoryPage>(
    slug ? `/categories/${slug}` : null,
  );

  useTitle(data ? `Free ${data.category.name} for video editors · Cyriq VFX` : undefined);

  if (error?.status === 404) return <NotFound />;
  if (error) return <PageError onRetry={reload} />;

  if (loading || !data) {
    return (
      <div className="page py-10 md:py-16">
        <Skeleton className="mb-4 h-11 w-56" />
        <Skeleton className="mb-10 h-4 w-full max-w-lg" />
        <div className="grid grid-cols-1 gap-x-8 gap-y-10 min-[560px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <ResourceCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const { category } = data;

  return (
    <div className="page py-10 md:py-16">
      <nav aria-label="Breadcrumb" className="mb-7 flex items-center gap-1.5 text-[12.5px] text-faint">
        <Link to="/categories" className="hover:text-ink">
          Categories
        </Link>
        <Icon name="chevron-right" size={13} />
        <span className="text-soft">{category.name}</span>
      </nav>

      <header className="border-b border-ink pb-4">
        <p className="eyebrow flex items-center gap-2">
          <Icon name={categoryIcon(category.icon)} size={14} className="text-blue" />
          Category
        </p>
        <h1 className="mt-3 text-[38px] leading-[1.05] md:text-[52px]">{category.name}</h1>
        {category.description ? <p className="copy mt-3">{category.description}</p> : null}
        <p className="mt-4 font-mono text-[12.5px] text-faint">
          {data.total} free {data.total === 1 ? 'resource' : 'resources'}
        </p>
      </header>

      {category.children.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {category.children.map((child) => (
            <Link
              key={child.id}
              to={`/resources?subcategory=${child.slug}`}
              className="text-[14px] text-soft underline decoration-rule-strong underline-offset-4 transition-colors duration-fast hover:text-blue hover:decoration-blue"
            >
              {child.name}
              <span className="ml-1.5 font-mono text-[11.5px] text-ghost no-underline">
                {child.resourceCount}
              </span>
            </Link>
          ))}
        </div>
      ) : null}

      {data.total === 0 ? (
        <EmptyState
          icon="folder"
          title={`Nothing in ${category.name} yet`}
          description="This category is set up but has no published resources so far."
          action={<LinkButton to="/resources">Browse everything</LinkButton>}
        />
      ) : (
        <div className="mt-10 flex flex-col gap-16">
          {data.featured.length > 0 ? (
            <section>
              <h2 className="mb-7 border-b border-rule pb-3 text-[24px] md:text-[28px]">Featured</h2>
              <div className="grid grid-cols-1 gap-x-8 gap-y-10 min-[560px]:grid-cols-2 lg:grid-cols-3">
                {data.featured.map((r) => (
                  <ResourceCard key={r.id} resource={r} />
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <div className="mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-rule pb-3">
              <h2 className="text-[24px] md:text-[28px]">Latest</h2>
              <MoreLink to={`/resources?category=${category.slug}`}>See all with filters</MoreLink>
            </div>
            <div className="grid grid-cols-1 gap-x-8 gap-y-10 min-[560px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.latest.map((r) => (
                <ResourceCard key={r.id} resource={r} />
              ))}
            </div>
          </section>

          {data.popular.length > 0 && data.popular.some((r) => r.downloadCount > 0) ? (
            <section>
              <h2 className="mb-7 border-b border-rule pb-3 text-[24px] md:text-[28px]">
                Most downloaded
              </h2>
              <div className="grid grid-cols-1 gap-x-8 gap-y-10 min-[560px]:grid-cols-2 lg:grid-cols-3">
                {data.popular
                  .filter((r) => r.downloadCount > 0)
                  .map((r) => (
                    <ResourceCard key={r.id} resource={r} />
                  ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
