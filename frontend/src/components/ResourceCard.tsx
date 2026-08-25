import { memo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ResourceCard as ResourceCardType } from '../lib/api';
import { formatCount } from '../lib/format';
import { Marker, cx, Skeleton } from './ui';
import { Icon } from './Icon';
import { SaveButton } from './SaveButton';

/**
 * Resource entry (PRD §12).
 *
 * A catalogue entry, not a card: a rule above it, the still, then the type set
 * underneath. Enough to decide whether to open it and no more. One state
 * marker, the software it works with, size and count.
 */

interface Props {
  resource: ResourceCardType;
  /** Larger treatment for the first item in an editorial row. */
  emphasis?: boolean;
  showSave?: boolean;
}

function ResourceCardBase({ resource, emphasis, showSave = true }: Props) {
  const [loaded, setLoaded] = useState(false);
  const poster = resource.thumbnailUrl ?? resource.previewPosterUrl;

  // One state marker at most, in priority order.
  const state = resource.isNew
    ? { label: 'New', tone: 'blue' as const }
    : resource.isUpdated
      ? { label: 'Updated', tone: 'go' as const }
      : resource.featured
        ? { label: 'Featured', tone: 'warn' as const }
        : null;

  return (
    <article className="group relative flex min-w-0 flex-col border-t border-rule pt-4">
      <div className={cx('well', emphasis ? 'aspect-[16/10]' : 'aspect-[16/9]')}>
        {poster ? (
          <img
            src={poster}
            alt=""
            loading="lazy"
            decoding="async"
            width={emphasis ? 800 : 640}
            height={emphasis ? 500 : 360}
            onLoad={() => setLoaded(true)}
            className={cx(
              'transition-[opacity,transform] duration-normal ease-out',
              loaded ? 'opacity-100' : 'opacity-0',
              'md:group-hover:scale-[1.04]',
            )}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-ghost">
            <Icon name={previewIcon(resource.previewType)} size={26} />
          </div>
        )}

        {showSave ? (
          <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity duration-fast focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
            <SaveButton resourceId={resource.id} compact />
          </div>
        ) : null}

        {resource.previewType === 'VIDEO' ? (
          <span
            className="pointer-events-none absolute bottom-2 left-2 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]"
            aria-hidden
          >
            <Icon name="play" size={18} />
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col pt-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="eyebrow truncate text-blue">{resource.category.name}</span>
          {state ? <Marker tone={state.tone} className="shrink-0">{state.label}</Marker> : null}
        </div>

        <h3
          className={cx(
            'mt-1.5 font-display leading-[1.15]',
            emphasis ? 'text-[24px]' : 'text-[19px]',
          )}
        >
          {/* The whole entry is clickable through this stretched link. */}
          <Link
            to={`/resources/${resource.slug}`}
            className="after:absolute after:inset-0 after:content-[''] group-hover:text-blue"
          >
            {resource.title}
          </Link>
        </h3>

        <p className="mt-2 line-clamp-2 text-[14px] leading-relaxed text-soft">
          {resource.shortDescription}
        </p>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-2 text-[12px] text-faint">
          {resource.software.slice(0, 2).map((s) => (
            <span key={s.id} className="text-soft">
              {s.name}
            </span>
          ))}
          {resource.software.length > 2 ? <span>plus {resource.software.length - 2} more</span> : null}

          <span className="ml-auto flex items-baseline gap-3 font-mono text-[11.5px]">
            {resource.fileSizeLabel ? <span>{resource.fileSizeLabel}</span> : null}
            {/* Shown only once it means something. No invented social proof. */}
            {resource.downloadCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Icon name="download" size={11} />
                {formatCount(resource.downloadCount)}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </article>
  );
}

function previewIcon(type: string) {
  switch (type) {
    case 'VIDEO':
      return 'video' as const;
    case 'AUDIO':
      return 'music' as const;
    case 'IMAGE':
    case 'BEFORE_AFTER':
    case 'GALLERY':
      return 'image' as const;
    default:
      return 'file' as const;
  }
}

/** Entries re-render often inside long grids; the props are stable so memo pays. */
export const ResourceCard = memo(ResourceCardBase);

/**
 * The placeholder mirrors the real entry's spacing line for line, so swapping
 * one for the other moves nothing on the page.
 */
export function ResourceCardSkeleton({ emphasis }: { emphasis?: boolean }) {
  return (
    <div className="border-t border-rule pt-4">
      <Skeleton className={cx('w-full', emphasis ? 'aspect-[16/10]' : 'aspect-[16/9]')} />
      <div className="pt-3">
        <Skeleton className="h-[14px] w-24" />
        <Skeleton className="mt-[7px] h-[22px] w-3/4" />
        <Skeleton className="mt-2 h-[22px] w-full" />
        <Skeleton className="mt-1 h-[22px] w-5/6" />
        <Skeleton className="mt-5 h-[15px] w-2/3" />
      </div>
    </div>
  );
}

export function ResourceGrid({
  resources,
  loading,
  skeletonCount = 8,
  className,
}: {
  resources: ResourceCardType[];
  loading?: boolean;
  skeletonCount?: number;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'grid grid-cols-1 gap-x-8 gap-y-10 min-[560px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
        className,
      )}
    >
      {loading
        ? Array.from({ length: skeletonCount }, (_, i) => <ResourceCardSkeleton key={i} />)
        : resources.map((r) => <ResourceCard key={r.id} resource={r} />)}
    </div>
  );
}
