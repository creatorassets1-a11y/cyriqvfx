import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useFetch, useTitle } from '../lib/hooks';
import type { TutorialDetail as TutorialDetailType } from '../lib/api';
import { Marker, Button, Fact, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatDate, formatDuration, skillLabel } from '../lib/format';
import NotFound from './NotFound';
import { PageError } from '../components/Layout';

/**
 * Tutorial page (PRD §25). Media, a short summary, the resources it uses, and
 * step-by-step sections, not a wall of text.
 */
export default function TutorialDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { data, loading, error, reload } = useFetch<TutorialDetailType>(
    slug ? `/tutorials/${slug}` : null,
  );
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  useTitle(data ? `${data.title} · Cyriq VFX` : undefined);

  if (error?.status === 404) return <NotFound />;
  if (error) return <PageError onRetry={reload} />;

  if (loading || !data) {
    return (
      <div className="page py-10">
        <Skeleton className="mb-5 h-11 w-3/4" />
        <Skeleton className="aspect-video w-full" />
      </div>
    );
  }

  return (
    <div className="page py-8 md:py-12">
      <nav aria-label="Breadcrumb" className="mb-7 flex items-center gap-1.5 text-[12.5px] text-faint">
        <Link to="/tutorials" className="hover:text-ink">
          Tutorials
        </Link>
        {data.category ? (
          <>
            <Icon name="chevron-right" size={13} />
            <span className="text-soft">{data.category.name}</span>
          </>
        ) : null}
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1fr_300px] lg:gap-16">
        <div className="min-w-0">
          <header className="mb-7">
            <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              <Marker tone="blue">{skillLabel(data.skillLevel)}</Marker>
              {data.software.map((s) => (
                <Marker key={s.id} tone="neutral">
                  {s.name}
                </Marker>
              ))}
              {data.durationSeconds ? (
                <span className="flex items-center gap-1 text-[12.5px] text-faint">
                  <Icon name="clock" size={12} />
                  {formatDuration(data.durationSeconds)}
                </span>
              ) : null}
            </div>
            <h1 className="text-[34px] leading-[1.05] md:text-[46px]">{data.title}</h1>
            <p className="copy mt-4 text-[17px]">{data.summary}</p>
          </header>

          <TutorialMedia tutorial={data} />

          {data.body ? <div className="copy mt-8 whitespace-pre-line">{data.body}</div> : null}

          {data.steps.length > 0 ? (
            <section className="mt-12">
              <h2 className="mb-6 border-b border-ink pb-3 text-[26px] md:text-[30px]">Steps</h2>
              <ol className="flex flex-col">
                {data.steps.map((step, i) => (
                  <li key={step.id} className="border-b border-rule py-6">
                    <div className="flex items-baseline gap-4">
                      <span className="w-6 shrink-0 font-mono text-[12px] text-blue">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <h3 className="flex-1 font-display text-[20px] leading-snug">{step.title}</h3>
                      {step.timestampSeconds !== null ? (
                        <span className="shrink-0 font-mono text-[12px] text-ghost">
                          {formatDuration(step.timestampSeconds)}
                        </span>
                      ) : null}
                    </div>
                    {step.body ? (
                      <p className="mt-3 pl-10 text-[15px] leading-[1.7] text-soft">{step.body}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {data.transcript ? (
            <section className="mt-8">
              <Button
                icon={transcriptOpen ? 'chevron-down' : 'chevron-right'}
                onClick={() => setTranscriptOpen((o) => !o)}
                aria-expanded={transcriptOpen}
              >
                {transcriptOpen ? 'Hide transcript' : 'Read the transcript'}
              </Button>
              {transcriptOpen ? (
                <div className="copy mt-5 max-w-none whitespace-pre-line border-l-2 border-rule-strong pl-5">
                  {data.transcript}
                </div>
              ) : null}
            </section>
          ) : null}

          <p className="mt-10 border-t border-rule pt-5 font-mono text-[12px] text-ghost">
            Published {formatDate(data.publishedAt)}
            {data.updatedAt !== data.publishedAt ? ` / Updated ${formatDate(data.updatedAt)}` : ''}
          </p>
        </div>

        {/* Resources used: the loop the PRD calls the strongest retention path */}
        <aside className="min-w-0 lg:border-l lg:border-rule lg:pl-10">
          <div className="sticky top-[calc(var(--bar)+1.5rem)] flex flex-col gap-8">
            {data.resources.length > 0 ? (
              <section>
                <h2 className="eyebrow border-b border-ink pb-2.5">Resources used</h2>
                <p className="mt-3 text-[13px] text-faint">
                  Everything in this tutorial, free to download.
                </p>
                <ul className="mt-4 flex flex-col">
                  {data.resources.map((r) => (
                    <li key={r.id} className="border-b border-rule">
                      <Link to={`/resources/${r.slug}`} className="group flex gap-3 py-3">
                        <span className="well h-11 w-16 shrink-0">
                          {r.thumbnailUrl ? (
                            <img src={r.thumbnailUrl} alt="" loading="lazy" />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] transition-colors duration-fast group-hover:text-blue">
                            {r.title}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-ghost">
                            {r.category.name}
                            {r.fileSizeLabel ? ` / ${r.fileSizeLabel}` : ''}
                          </span>
                          {r.note ? (
                            <span className="mt-1 block text-[12px] text-soft">{r.note}</span>
                          ) : null}
                        </span>
                        <Icon
                          name="download"
                          size={14}
                          className="mt-1 shrink-0 text-ghost group-hover:text-blue"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {data.tags.length > 0 ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {data.tags.map((t) => (
                  <Fact key={t.id}>{t.name}</Fact>
                ))}
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      {data.related.length > 0 ? (
        <section className="mt-20">
          <h2 className="mb-7 border-b border-ink pb-3 text-[26px] md:text-[30px]">
            More tutorials
          </h2>
          <div className="grid gap-x-8 gap-y-10 md:grid-cols-3">
            {data.related.map((t) => (
              <Link key={t.id} to={`/tutorials/${t.slug}`} className="group min-w-0">
                <div className="well aspect-video">
                  {t.coverUrl ? (
                    <img
                      src={t.coverUrl}
                      alt=""
                      loading="lazy"
                      className="transition-transform duration-normal ease-out md:group-hover:scale-[1.04]"
                    />
                  ) : null}
                  <span
                    className="absolute inset-0 grid place-items-center text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
                    aria-hidden
                  >
                    <Icon name="play" size={26} />
                  </span>
                </div>
                <h3 className="mt-3 font-display text-[19px] leading-snug transition-colors duration-fast group-hover:text-blue">
                  {t.title}
                </h3>
                <p className="mt-1.5 font-mono text-[11.5px] text-ghost">
                  {skillLabel(t.skillLevel)}
                  {t.durationSeconds ? ` / ${formatDuration(t.durationSeconds)}` : ''}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TutorialMedia({ tutorial }: { tutorial: TutorialDetailType }) {
  const [playing, setPlaying] = useState(false);

  // An external video (YouTube/Vimeo) only loads its iframe after a click, so
  // the page never ships a third-party player to someone who does not watch.
  if (tutorial.isExternalVideo && tutorial.videoUrl) {
    const embed = toEmbedUrl(tutorial.videoUrl);
    return (
      <div className="well aspect-video">
        {playing && embed ? (
          <iframe
            src={`${embed}?autoplay=1`}
            title={tutorial.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <>
            {tutorial.coverUrl ? <img src={tutorial.coverUrl} alt="" /> : null}
            <button
              onClick={() => setPlaying(true)}
              aria-label={`Play ${tutorial.title}`}
              className="absolute inset-0 grid place-items-center bg-black/25 transition-colors duration-fast hover:bg-black/35"
            >
              <span className="grid h-16 w-16 place-items-center rounded-full bg-white text-black shadow-lg transition-transform duration-fast ease-spring hover:scale-105">
                <Icon name="play" size={24} className="ml-1" />
              </span>
            </button>
          </>
        )}
      </div>
    );
  }

  if (tutorial.videoUrl) {
    return (
      <div className="well aspect-video">
        <video
          controls
          preload="metadata"
          poster={tutorial.coverUrl ?? undefined}
          playsInline
          className="h-full w-full"
        >
          <source src={tutorial.videoUrl} />
          Your browser cannot play this video.
        </video>
      </div>
    );
  }

  if (tutorial.coverUrl) {
    return (
      <div className="well aspect-video">
        <img src={tutorial.coverUrl} alt="" width={1280} height={720} />
      </div>
    );
  }

  return null;
}

function toEmbedUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtube.com')) {
      const id = parsed.searchParams.get('v');
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (parsed.hostname === 'youtu.be') {
      return `https://www.youtube-nocookie.com/embed${parsed.pathname}`;
    }
    if (parsed.hostname.includes('vimeo.com')) {
      return `https://player.vimeo.com/video${parsed.pathname}`;
    }
  } catch {
    return null;
  }
  return null;
}
