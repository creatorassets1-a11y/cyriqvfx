import { useSearchParams } from 'react-router-dom';
import { query } from '../lib/api';
import { useLoad } from '../lib/hooks';
import type { Paged, TutorialCard as Card } from '../lib/types';
import { TutorialCard, TutorialCardSkeleton } from '../components/TutorialCard';
import { PageError } from '../components/Chrome';
import { Empty, Pagination, cx } from '../ui/primitives';

/**
 * Tutorials.
 *
 * The library and the tutorials are the same product seen from two sides, so
 * this page filters on the same axes the resources do — software and level —
 * and every tutorial links the resources it uses.
 */

const LEVELS = [
  { value: '', label: 'Every level' },
  { value: 'BEGINNER', label: 'Beginner' },
  { value: 'INTERMEDIATE', label: 'Intermediate' },
  { value: 'ADVANCED', label: 'Advanced' },
];

export default function TutorialIndex() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1');

  const { data, error, loading, reload } = useLoad<Paged<Card>>(
    `/tutorials${query({
      level: params.get('level'),
      category: params.get('category'),
      software: params.get('software'),
      page: page > 1 ? page : undefined,
    })}`,
  );

  function update(key: string, value: string | null) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('page');
      return next;
    });
  }

  if (error) return <PageError onRetry={reload} />;

  return (
    <div className="page py-10 md:py-14">
      <header className="mb-8">
        <h1 className="text-[34px] md:text-[42px]">Tutorials</h1>
        <p className="prose mt-3">
          How to actually use what is in the library, start to finish, with the files linked.
        </p>
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-line py-3">
        <span className="kicker">Level</span>
        {LEVELS.map((level) => {
          const selected = (params.get('level') ?? '') === level.value;
          return (
            <button
              key={level.value || 'all'}
              type="button"
              onClick={() => update('level', level.value || null)}
              className={cx(
                'text-[13.5px] transition-colors duration-fast ease-out',
                selected ? 'text-accent' : 'text-text-3 hover:text-text',
              )}
            >
              {level.label}
            </button>
          );
        })}
      </div>

      {loading && !data ? (
        <div className="grid gap-x-6 gap-y-9 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <TutorialCardSkeleton key={index} />
          ))}
        </div>
      ) : data && data.items.length ? (
        <>
          <div className="grid gap-x-6 gap-y-9 md:grid-cols-2 lg:grid-cols-3">
            {data.items.map((tutorial) => (
              <TutorialCard key={tutorial.id} tutorial={tutorial} level={2} />
            ))}
          </div>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            onPage={(next) => update('page', String(next))}
          />
        </>
      ) : (
        <Empty
          icon="film"
          title="No tutorials here yet"
          body="Nothing matches that filter. Try another level, or look at all of them."
        />
      )}
    </div>
  );
}
