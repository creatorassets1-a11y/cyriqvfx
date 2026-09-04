import { useRef, useState } from 'react';
import type { Resource } from '../lib/types';
import { Icon } from '../ui/Icon';
import { cx } from '../ui/primitives';

/**
 * Seeing it before taking it.
 *
 * Every preview here obeys one rule: nothing heavy loads until someone asks
 * for it. A video shows its poster and only fetches the file on the first
 * play, audio is preload="none", and gallery images are lazy. That is what
 * keeps a resource page cheap on a phone, where most of these are opened.
 */

export function ResourcePreview({ resource }: { resource: Resource }) {
  switch (resource.previewType) {
    case 'VIDEO':
      return resource.previewUrl ? (
        <VideoPreview
          src={resource.previewUrl}
          poster={resource.previewPosterUrl ?? resource.thumbnailUrl}
          title={resource.title}
        />
      ) : null;

    case 'BEFORE_AFTER':
      return resource.previewBeforeUrl && resource.previewAfterUrl ? (
        <ComparePreview
          before={resource.previewBeforeUrl}
          after={resource.previewAfterUrl}
          title={resource.title}
        />
      ) : null;

    case 'AUDIO':
      return resource.previewUrl ? (
        <AudioPreview src={resource.previewUrl} title={resource.title} />
      ) : null;

    case 'GALLERY':
      return resource.gallery.length ? (
        <GalleryPreview items={resource.gallery} title={resource.title} />
      ) : null;

    case 'IMAGE':
      return resource.previewUrl || resource.thumbnailUrl ? (
        <figure className="frame aspect-[16/9] rounded-lg border border-line">
          <img
            src={(resource.previewUrl ?? resource.thumbnailUrl)!}
            alt={`Preview of ${resource.title}`}
            width={1280}
            height={720}
            decoding="async"
          />
        </figure>
      ) : null;

    default:
      return null;
  }
}

function VideoPreview({
  src,
  poster,
  title,
}: {
  src: string;
  poster: string | null;
  title: string;
}) {
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  return (
    <figure className="frame aspect-video rounded-lg border border-line">
      {playing ? (
        <video
          ref={video}
          src={src}
          poster={poster ?? undefined}
          controls
          autoPlay
          playsInline
          preload="auto"
          className="h-full w-full"
        />
      ) : (
        <>
          {poster ? (
            <img src={poster} alt={`Preview of ${title}`} width={1280} height={720} decoding="async" />
          ) : null}
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="absolute inset-0 z-[2] flex items-center justify-center bg-ground/25 transition-colors duration-fast ease-out hover:bg-ground/10"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-line-strong bg-ground/75 text-text">
              <Icon name="play" size={22} />
            </span>
            <span className="sr-only">Play the preview of {title}</span>
          </button>
        </>
      )}
    </figure>
  );
}

/** A wipe between two stills, driven by a range so it works on a keyboard. */
function ComparePreview({
  before,
  after,
  title,
}: {
  before: string;
  after: string;
  title: string;
}) {
  const [position, setPosition] = useState(50);

  return (
    <figure>
      <div className="frame relative aspect-video rounded-lg border border-line">
        <img src={before} alt={`${title} before`} width={1280} height={720} decoding="async" />
        <div
          className="absolute inset-0"
          style={{ clipPath: `inset(0 0 0 ${position}%)` }}
          aria-hidden="true"
        >
          <img
            src={after}
            alt=""
            width={1280}
            height={720}
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-accent"
          style={{ left: `${position}%` }}
          aria-hidden="true"
        />
      </div>

      <label className="mt-3 flex items-center gap-3 text-[12px] text-text-3">
        <span className="shrink-0">Before</span>
        <input
          type="range"
          min={0}
          max={100}
          value={position}
          aria-label={`Compare ${title} before and after`}
          onChange={(event) => setPosition(Number(event.target.value))}
          className="flex-1"
        />
        <span className="shrink-0">After</span>
      </label>
    </figure>
  );
}

function AudioPreview({ src, title }: { src: string; title: string }) {
  return (
    <figure className="rounded-lg border border-line bg-inset p-5">
      <figcaption className="mb-3 flex items-center gap-2 text-[13px] text-text-2">
        <Icon name="play" size={14} className="text-accent" />
        Listen to {title}
      </figcaption>
      {/* preload="none" so opening the page costs nothing until someone plays it. */}
      <audio src={src} controls preload="none" className="w-full" />
    </figure>
  );
}

function GalleryPreview({
  items,
  title,
}: {
  items: Array<{ id: string; url: string | null; caption: string | null }>;
  title: string;
}) {
  const [active, setActive] = useState(0);
  const shown = items[active];

  return (
    <figure>
      <div className="frame aspect-video rounded-lg border border-line">
        {shown?.url ? (
          <img
            src={shown.url}
            alt={shown.caption ?? `${title}, image ${active + 1} of ${items.length}`}
            width={1280}
            height={720}
            decoding="async"
          />
        ) : null}
      </div>

      {items.length > 1 ? (
        <div className="swipe mt-3 flex gap-2">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActive(index)}
              aria-label={`Show image ${index + 1}`}
              aria-current={index === active}
              className={cx(
                'frame h-16 w-24 shrink-0 rounded border transition-colors duration-fast ease-out',
                index === active ? 'border-accent' : 'border-line hover:border-line-strong',
              )}
            >
              {item.url ? (
                <img
                  src={item.url}
                  alt=""
                  width={192}
                  height={128}
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {shown?.caption ? (
        <figcaption className="mt-2 text-[12.5px] text-text-3">{shown.caption}</figcaption>
      ) : null}
    </figure>
  );
}
