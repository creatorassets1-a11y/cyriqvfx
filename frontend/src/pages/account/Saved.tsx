import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import type { Paged, ResourceCard as Card } from '../../lib/types';
import { CardGrid, CardGridSkeleton, ResourceCard } from '../../components/ResourceCard';
import { PageError } from '../../components/Chrome';
import { Icon } from '../../ui/Icon';
import { ButtonLink, Empty, Pagination } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';

/** Saved resources, with the one control that belongs here: unsaving. */
export default function Saved() {
  const [page, setPage] = useState(1);
  const { toast } = useToast();
  const { data, error, loading, reload, set } = useLoad<Paged<Card>>(
    `/me/saved${page > 1 ? `?page=${page}` : ''}`,
  );

  useTitle('Saved · Cyriq VFX');

  async function remove(resource: Card) {
    // Removed on screen first: the request is a formality the page should not
    // make anyone watch.
    if (data) set({ ...data, items: data.items.filter((item) => item.id !== resource.id) });

    try {
      await api.delete(`/me/saved/${resource.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That could not be removed.', 'error');
      reload();
    }
  }

  if (error) return <PageError onRetry={reload} />;

  return (
    <>
      <header className="mb-7">
        <h1 className="text-[30px]">Saved</h1>
        <p className="mt-1.5 text-[13.5px] text-text-3">
          Resources you have kept for later.
        </p>
      </header>

      {loading && !data ? (
        <CardGridSkeleton count={4} />
      ) : data && data.items.length ? (
        <>
          <CardGrid>
            {data.items.map((resource) => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                action={
                  <button
                    type="button"
                    onClick={() => remove(resource)}
                    aria-label={`Remove ${resource.title} from saved`}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-ground/80 text-text-2 backdrop-blur transition-colors duration-fast ease-out hover:border-critical hover:text-critical"
                  >
                    <Icon name="close" size={14} />
                  </button>
                }
              />
            ))}
          </CardGrid>

          <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </>
      ) : (
        <Empty
          icon="bookmark"
          title="Nothing saved yet"
          body="Save resources you want to revisit and they will wait here for you."
          action={<ButtonLink to="/resources" variant="primary">Browse the library</ButtonLink>}
        />
      )}
    </>
  );
}
