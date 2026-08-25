import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResourceDetail } from '../lib/api';
import { useInView } from '../lib/hooks';
import { Icon } from './Icon';
import { cx, IconButton } from './ui';

/**
 * Preview system (PRD §14). The mode follows the asset type, so a LUT gets a
 * before/after slider, audio gets a player, video gets a real video element.
 * Heavy media only loads once it is near the viewport, and never autoplays on
 * a phone (PRD §5).
 */

export function ResourcePreview({ resource }: { resource: ResourceDetail }) {
  switch (resource.previewType) {
    case 'BEFORE_AFTER':
      return resource.previewBeforeUrl && resource.previewAfterUrl ? (
        <BeforeAfter before={resource.previewBeforeUrl} after={resource.previewAfterUrl} />
      ) : (
        <StaticPreview url={resource.thumbnailUrl} title={resource.title} />
      );
    case 'VIDEO':
      return (
        <VideoPreview
          src={resource.previewUrl}
          poster={resource.previewPosterUrl ?? resource.thumbnailUrl}
          title={resource.title}
        />
      );
    case 'AUDIO':
      return (
        <AudioPreview
          src={resource.previewUrl}
          poster={resource.thumbnailUrl}
          title={resource.title}
        />
      );
    case 'GALLERY':
      return resource.gallery.length > 0 ? (
        <Gallery items={resource.gallery} title={resource.title} />
      ) : (
        <StaticPreview url={resource.thumbnailUrl} title={resource.title} />
      );
    default:
      return <StaticPreview url={resource.previewUrl ?? resource.thumbnailUrl} title={resource.title} />;
  }
}

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'well aspect-video',
        className,
      )}
    >
      {children}
    </div>
  );
}

function StaticPreview({ url, title }: { url: string | null; title: string }) {
  if (!url) {
    return (
      <Frame>
        <div className="absolute inset-0 grid place-items-center gap-2 text-ghost">
          <Icon name="file" size={30} />
          <p className="text-[13px]">No preview for this one</p>
        </div>
      </Frame>
    );
  }
  return (
    <Frame>
      <img src={url} alt={`Preview of ${title}`} width={1280} height={720} decoding="async" />
    </Frame>
  );
}

/**
 * Video preview. Nothing is fetched until the element is close to the viewport,
 * and playback is user-initiated on touch devices where autoplay would cost
 * bandwidth and battery.
 */
function VideoPreview({
  src,
  poster,
  title,
}: {
  src: string | null;
  poster: string | null;
  title: string;
}) {
  const [wrapperRef, inView] = useInView<HTMLDivElement>('300px');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setStarted(true);
    if (video.paused) {
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      video.pause();
      setPlaying(false);
    }
  }, []);

  if (!src) return <StaticPreview url={poster} title={title} />;

  return (
    <div ref={wrapperRef}>
      <Frame>
        {inView ? (
          <video
            ref={videoRef}
            // Nothing is fetched until someone presses play. The poster image
            // already shows what the resource looks like, so even a metadata
            // fetch would be bandwidth spent on a video most visitors on a
            // phone will never watch (PRD §5).
            preload="none"
            poster={poster ?? undefined}
            playsInline
            muted
            loop
            controls={started}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            aria-label={`Preview of ${title}`}
          >
            <source src={src} />
            Your browser cannot play this preview.
          </video>
        ) : poster ? (
          <img src={poster} alt="" width={1280} height={720} />
        ) : null}

        {!started ? (
          <button
            onClick={toggle}
            aria-label={`Play preview of ${title}`}
            className="absolute inset-0 grid place-items-center bg-black/25 transition-colors duration-fast hover:bg-black/35"
          >
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-black shadow-lg transition-transform duration-fast ease-spring hover:scale-105">
              <Icon name="play" size={22} className="ml-0.5" />
            </span>
          </button>
        ) : null}

        {started && !playing ? (
          <button
            onClick={toggle}
            aria-label="Resume preview"
            className="absolute inset-0 grid place-items-center"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-black/60 text-white">
              <Icon name="play" size={18} className="ml-0.5" />
            </span>
          </button>
        ) : null}
      </Frame>
    </div>
  );
}

/** Before/after slider for grades and overlays (PRD §14). */
function BeforeAfter({ before, after }: { before: string; after: string }) {
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromClientX = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.min(100, Math.max(0, pct)));
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
      if (clientX !== undefined) setFromClientX(clientX);
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, [setFromClientX]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        className="well relative aspect-video select-none"
        onMouseDown={(e) => {
          dragging.current = true;
          setFromClientX(e.clientX);
        }}
        onTouchStart={(e) => {
          dragging.current = true;
          const x = e.touches[0]?.clientX;
          if (x !== undefined) setFromClientX(x);
        }}
      >
        <img src={before} alt="Before" width={1280} height={720} draggable={false} />
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 0 0 ${position}%)` }}
        >
          <img
            src={after}
            alt="After"
            width={1280}
            height={720}
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>

        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow-[0_0_12px_rgba(0,0,0,0.5)]"
          style={{ left: `${position}%` }}
        >
          <span className="pointer-events-none absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black shadow">
            <Icon name="shuffle" size={15} />
          </span>
        </div>

        <span className="pointer-events-none absolute bottom-2 left-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
          Before
        </span>
        <span className="pointer-events-none absolute bottom-2 right-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
          After
        </span>
      </div>

      {/* Keyboard-accessible equivalent of the drag handle (PRD §56). */}
      <label className="flex items-center gap-3 text-[12.5px] text-faint">
        <span className="shrink-0">Compare</span>
        <input
          type="range"
          min={0}
          max={100}
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
          aria-label="Before and after comparison position"
          className="h-1 flex-1 cursor-pointer accent-[var(--blue)]"
        />
      </label>
    </div>
  );
}

/** Lightweight audio player. No waveform library for a preview (PRD §14). */
function AudioPreview({
  src,
  poster,
  title,
}: {
  src: string | null;
  poster: string | null;
  title: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  if (!src) return <StaticPreview url={poster} title={title} />;

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().then(() => setPlaying(true)).catch(() => {});
    else {
      audio.pause();
      setPlaying(false);
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-4 border-y border-rule py-5">
      <IconButton
        icon={playing ? 'pause' : 'play'}
        label={playing ? 'Pause preview' : 'Play preview'}
        variant="primary"
        onClick={toggle}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">{title}</p>
        <div className="mt-2 flex items-center gap-2.5">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={progress}
            aria-label="Seek"
            onChange={(e) => {
              const next = Number(e.target.value);
              if (audioRef.current) audioRef.current.currentTime = next;
              setProgress(next);
            }}
            className="h-1 flex-1 cursor-pointer accent-[var(--blue)]"
          />
          <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-faint">
            {fmt(progress)} / {duration ? fmt(duration) : '0:00'}
          </span>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
      />
    </div>
  );
}

function Gallery({
  items,
  title,
}: {
  items: ResourceDetail['gallery'];
  title: string;
}) {
  const [active, setActive] = useState(0);
  const current = items[active];

  return (
    <div className="flex flex-col gap-2.5">
      <Frame>
        {current?.url ? (
          <img src={current.url} alt={current.caption ?? `${title} screenshot ${active + 1}`} />
        ) : null}
      </Frame>
      {items.length > 1 ? (
        <div className="scroll-x no-bar flex gap-2 pb-1">
          {items.map((item, i) => (
            <button
              key={item.id}
              onClick={() => setActive(i)}
              aria-label={`Show image ${i + 1}`}
              aria-current={i === active}
              className={cx(
                'well h-14 w-20 shrink-0 overflow-hidden rounded border-2 transition-colors duration-fast',
                i === active ? 'border-blue' : 'border-transparent hover:border-rule-strong',
              )}
            >
              {item.url ? <img src={item.url} alt="" loading="lazy" /> : null}
            </button>
          ))}
        </div>
      ) : null}
      {current?.caption ? <p className="text-[13px] text-faint">{current.caption}</p> : null}
    </div>
  );
}
