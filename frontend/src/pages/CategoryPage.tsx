import { Link, useParams } from 'react-router-dom';
import { useLoad, useTitle } from '../lib/hooks';
import type { CategoryPayload } from '../lib/types';
import { CardGrid, CardGridSkeleton, ResourceCard } from '../components/ResourceCard';
import { PageError } from '../components/Chrome';
import { ButtonLink, SectionHead } from '../ui/primitives';
import NotFound from './NotFound';

/**
 * A category landing page: what is new in it, what is most taken from it, and
 * a way through to the filtered library when someone wants the whole list.
 */
export default function CategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, error, loading, reload } = useLoad<CategoryPayload>(
    slug ? `/categories/${slug}` : null,
  );

  useTitle(data ? `${data.category.name} · Cyriq VFX` : undefined);

  if (error?.status === 404) return <NotFound />;
  if (error) return <PageError onRetry={reload} />;

  if (loading || !data) {
    return (
      <div className="page py-12">
        <CardGridSkeleton count={8} />
      </div>
    );
  }

  const { category } = data;

  return (
    <div className="page py-10 md:py-14">
      <nav aria-label="Breadcrumb" className="mb-6 text-[12.5px] text-text-3">
        <Link to="/categories" className="hover:text-text">
          Categories
        </Link>
      </nav>

      <header className="mb-10 max-w-2xl">
        <h1 className="text-[34px] md:text-[44px]">{category.name}</h1>
        {category.description ? <p className="prose mt-4">{category.description}</p> : null}
        <p className="mt-4 font-mono text-[12.5px] text-text-4">
          {data.total} {data.total === 1 ? 'resource' : 'resources'}
        </p>

        {category.children.length ? (
          <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-2">
            {category.children.map((child) => (
              <li key={child.id}>
                <Link
                  to={`/resources?subcategory=${child.slug}`}
                  className="rounded-full border border-line-strong px-3 py-1 text-[13px] text-text-2 hover:border-accent hover:text-accent"
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      {data.featured.length ? (
        <section className="mb-14">
          <SectionHead kicker="Start here" title="Picked from this category" />
          <CardGrid>
            {data.featured.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} />
            ))}
          </CardGrid>
        </section>
      ) : null}

      <section className="mb-14">
        <SectionHead
          title="Latest"
          action={
            <Link to={`/resources?category=${category.slug}`} className="underlined text-[13.5px]">
              See all {data.total}
            </Link>
          }
        />
        {data.latest.length ? (
          <CardGrid>
            {data.latest.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} />
            ))}
          </CardGrid>
        ) : (
          <p className="border-y border-line py-12 text-center text-[14px] text-text-3">
            Nothing has been published in this category yet.
          </p>
        )}
      </section>

      {data.popular.length ? (
        <section>
          <SectionHead title="Most downloaded here" />
          <CardGrid>
            {data.popular.slice(0, 4).map((resource) => (
              <ResourceCard key={resource.id} resource={resource} />
            ))}
          </CardGrid>
        </section>
      ) : null}

      <div className="mt-14 border-t border-line pt-8">
        <ButtonLink to={`/resources?category=${category.slug}`} variant="primary">
          Browse every {category.name} resource
        </ButtonLink>
      </div>
    </div>
  );
}
