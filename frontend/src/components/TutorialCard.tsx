import { Link } from 'react-router-dom';
import { formatDuration, skillLabel } from '../lib/format';
import { Fact, Skeleton } from '../ui/primitives';
import { Icon } from '../ui/Icon';

/**
 * A tutorial in a list. Same rules as a resource card: one stretched link on
 * the title, a picture that reserves its box, and the facts that decide
 * whether it is worth someone's next ten minutes.
 */

export interface TutorialSummary {
  id: string;
  title: string;
  slug: string;
  summary: string;
  coverUrl: string | null;
  durationSeconds: number | null;
  skillLevel: string;
  resourceCount?: number;
}

export function TutorialCard({
  tutorial,
  level = 3,
}: {
  tutorial: TutorialSummary;
  level?: 2 | 3 | 4;
}) {
  const Heading = `h${level}` as 'h2' | 'h3' | 'h4';

  return (
    <article className="group relative flex flex-col">
      <div className="frame relative aspect-video rounded-md border border-line">
        {tutorial.coverUrl ? (
          <img
            src={tutorial.coverUrl}
            alt={`Cover for ${tutorial.title}`}
            width={640}
            height={360}
            loading="lazy"
            decoding="async"
            className="transition-transform duration-slow ease-out group-hover:scale-[1.02]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-text-4">
            <Icon name="film" size={22} />
          </div>
        )}

        <span className="absolute inset-0 z-[2] flex items-center justify-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-line-strong bg-ground/70 text-text transition-colors duration-fast ease-out group-hover:border-accent group-hover:text-accent">
            <Icon name="play" size={16} />
          </span>
        </span>

        {tutorial.durationSeconds ? (
          <span className="absolute bottom-2 right-2 z-[2] rounded-full bg-ground/85 px-2 py-0.5 font-mono text-[10.5px] text-text-2">
            {formatDuration(tutorial.durationSeconds)}
          </span>
        ) : null}
      </div>

      <div className="pt-3">
        <Heading className="text-[16.5px] font-normal leading-snug">
          <Link
            to={`/tutorials/${tutorial.slug}`}
            className="card-link transition-colors duration-fast ease-out group-hover:text-accent"
          >
            {tutorial.title}
          </Link>
        </Heading>

        <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-text-3">
          {tutorial.summary}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5">
          <Fact>{skillLabel(tutorial.skillLevel)}</Fact>
          {tutorial.resourceCount ? (
            <Fact icon="file">
              {tutorial.resourceCount} {tutorial.resourceCount === 1 ? 'resource' : 'resources'}
            </Fact>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function TutorialCardSkeleton() {
  return (
    <div className="flex flex-col">
      <Skeleton className="aspect-video w-full rounded-md" />
      <Skeleton className="mt-3 h-4 w-2/3" />
      <Skeleton className="mt-2 h-3 w-full" />
    </div>
  );
}
