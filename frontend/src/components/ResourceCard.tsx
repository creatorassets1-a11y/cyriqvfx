import { Link } from 'react-router-dom';
import type { ResourceCard as Card } from '../lib/types';
import { formatCount } from '../lib/format';
import { cx, Fact, Marker, Skeleton } from '../ui/primitives';
import { Icon } from '../ui/Icon';

/**
 * One resource in a list.
 *
 * The card is not a box: it is a picture, a title and the three facts that
 * decide whether someone wants it — what it works with, how big it is, and
 * how many people have taken it. The whole card is clickable through a single
 * stretched link on the title, so the accessible name of that link is exactly
 * the resource's title and nothing else.
 */

interface Props {
  resource: Card;
  /** Heading level, so a card never breaks the outline of the page it is on. */
  level?: 2 | 3 | 4;
  /** Shown under the title instead of the summary (download history uses it). */
  footnote?: React.ReactNode;
  /** A control pinned to the corner of the media, such as "remove from saved". */
  action?: React.ReactNode;
}

export function ResourceCard({ resource, level = 3, footnote, action }: Props) {
  const Heading = `h${level}` as 'h2' | 'h3' | 'h4';

  return (
    <article className="group relative flex flex-col">
      <div className="frame relative aspect-[16/10] rounded-md border border-line">
        {resource.thumbnailUrl ? (
          <img
            src={resource.thumbnailUrl}
            alt={`Preview of ${resource.title}`}
            width={640}
            height={400}
            loading="lazy"
            decoding="async"
            className="transition-transform duration-slow ease-out group-hover:scale-[1.02]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-text-4">
            <Icon name="image" size={22} />
          </div>
        )}

        {resource.previewType === 'VIDEO' ? (
          <span className="absolute bottom-2 left-2 z-[2] flex items-center gap-1 rounded-full bg-ground/80 px-2 py-0.5 font-mono text-[10.5px] text-text-2">
            <Icon name="play" size={10} />
            Preview
          </span>
        ) : null}

        {action ? <div className="absolute right-2 top-2 z-[2]">{action}</div> : null}
      </div>

      <div className="flex flex-1 flex-col pt-3">
        {resource.isNew || resource.isUpdated ? (
          <div className="mb-1.5 flex gap-4">
            {resource.isNew ? <Marker tone="accent">New</Marker> : null}
            {resource.isUpdated ? <Marker tone="positive">Updated</Marker> : null}
          </div>
        ) : null}

        <Heading className="text-[16.5px] font-normal leading-snug">
          <Link
            to={`/resources/${resource.slug}`}
            className="card-link transition-colors duration-fast ease-out group-hover:text-accent"
          >
            {resource.title}
          </Link>
        </Heading>

        {footnote ?? (
          <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-text-3">
            {resource.shortDescription}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5">
          <Fact>{resource.category.name}</Fact>
          {resource.fileSizeLabel ? <Fact>{resource.fileSizeLabel}</Fact> : null}
          <Fact icon="download">{formatCount(resource.downloadCount)}</Fact>
        </div>
      </div>
    </article>
  );
}

/** The same shape, before the data arrives, so the grid never jumps. */
export function ResourceCardSkeleton() {
  return (
    <div className="flex flex-col">
      <Skeleton className="aspect-[16/10] w-full rounded-md" />
      <Skeleton className="mt-3 h-4 w-3/4" />
      <Skeleton className="mt-2 h-3 w-full" />
      <Skeleton className="mt-1.5 h-3 w-2/3" />
    </div>
  );
}

/**
 * The grid these cards live in. Four across on a full-width page, three when
 * a sidebar is taking a column of its own — passed explicitly rather than
 * layered as conflicting utility classes, where the winner would depend on the
 * order Tailwind happened to emit them in.
 */
export function CardGrid({
  children,
  columns = 4,
}: {
  children: React.ReactNode;
  columns?: 3 | 4;
}) {
  return (
    <div
      className={cx(
        'grid grid-cols-1 gap-x-6 gap-y-9 min-[560px]:grid-cols-2',
        columns === 4 ? 'lg:grid-cols-3 xl:grid-cols-4' : 'lg:grid-cols-2 xl:grid-cols-3',
      )}
    >
      {children}
    </div>
  );
}

export function CardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <CardGrid>
      {Array.from({ length: count }, (_, index) => (
        <ResourceCardSkeleton key={index} />
      ))}
    </CardGrid>
  );
}
