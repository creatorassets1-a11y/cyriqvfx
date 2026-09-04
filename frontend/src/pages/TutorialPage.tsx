import { Link, useParams } from 'react-router-dom';
import { useLoad, useTitle } from '../lib/hooks';
import type { Tutorial } from '../lib/types';
import { formatDate, formatDuration, skillLabel } from '../lib/format';
import { CardGrid, ResourceCard } from '../components/ResourceCard';
import { TutorialCard } from '../components/TutorialCard';
import { ShareMenu } from '../components/ShareMenu';
import { PageError } from '../components/Chrome';
import { Fact, Skeleton } from '../ui/primitives';
import NotFound from './NotFound';

/**
 * A tutorial.
 *
 * The video (or the written steps) comes first, the resources it uses come
 * immediately after, and the steps are timestamped so someone can jump into
 * the part they are stuck on. Nothing here autoplays or preloads.
 */
export default function TutorialPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, error, loading, reload } = useLoad<Tutorial>(slug ? `/tutorials/${slug}` : null);

  useTitle(data ? `${data.title} · Cyriq VFX` : undefined);

  if (error?.status === 404) return <NotFound />;
  if (error) return <PageError onRetry={reload} />;

  if (loading || !data) {
    return (
      <div className="page py-12">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="mt-6 aspect-video w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="page py-8 md:py-12">
      <nav aria-label="Breadcrumb" className="mb-6 text-[12.5px] text-text-3">
        <Link to="/tutorials" className="hover:text-text">
          Tutorials
        </Link>
      </nav>

      <header className="mb-8 max-w-3xl">
        <h1 className="text-[32px] leading-[1.06] md:text-[44px]">{data.title}</h1>
        <p className="prose mt-4 text-[17px]">{data.summary}</p>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Fact>{skillLabel(data.skillLevel)}</Fact>
          {data.durationSeconds ? (
            <Fact icon="clock">{formatDuration(data.durationSeconds)}</Fact>
          ) : null}
          {data.category ? <Fact>{data.category.name}</Fact> : null}
          {data.publishedAt ? <Fact icon="calendar">{formatDate(data.publishedAt)}</Fact> : null}
          <span className="ml-auto">
            <ShareMenu title={data.title} path={`/tutorials/${data.slug}`} />
          </span>
        </div>
      </header>

      {data.videoUrl ? (
        data.isExternalVideo ? (
          <div className="frame aspect-video rounded-lg border border-line">
            <iframe
              src={data.videoUrl}
              title={data.title}
              loading="lazy"
              allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          </div>
        ) : (
          <div className="frame aspect-video rounded-lg border border-line">
            {/* preload="none": the file is fetched when someone presses play. */}
            <video
              src={data.videoUrl}
              poster={data.coverUrl ?? undefined}
              controls
              preload="none"
              playsInline
              className="h-full w-full"
            />
          </div>
        )
      ) : data.coverUrl ? (
        <div className="frame aspect-video rounded-lg border border-line">
          <img
            src={data.coverUrl}
            alt={`Cover for ${data.title}`}
            width={1280}
            height={720}
            decoding="async"
          />
        </div>
      ) : null}

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_300px] lg:gap-16">
        <div className="min-w-0">
          {data.body ? (
            <section className="mb-12">
              <h2 className="mb-5 border-t border-line pt-4 text-[24px]">What this covers</h2>
              <div className="prose whitespace-pre-line">{data.body}</div>
            </section>
          ) : null}

          {data.steps.length ? (
            <section className="mb-12">
              <h2 className="mb-5 border-t border-line pt-4 text-[24px]">Steps</h2>
              <ol className="flex flex-col">
                {data.steps.map((step, index) => (
                  <li key={step.id} className="border-b border-line py-5 first:border-t">
                    <div className="flex items-baseline gap-4">
                      <span className="font-mono text-[12px] text-text-4">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-sans text-[15.5px] font-semibold">{step.title}</h3>
                        {step.body ? (
                          <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-text-2">
                            {step.body}
                          </p>
                        ) : null}
                      </div>
                      {step.timestampSeconds !== null ? (
                        <span className="shrink-0 font-mono text-[12px] text-accent">
                          {formatDuration(step.timestampSeconds)}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {data.transcript ? (
            <details className="mb-12 border-t border-line pt-4">
              <summary className="cursor-pointer text-[15px] font-semibold">Transcript</summary>
              <div className="prose mt-4 whitespace-pre-line">{data.transcript}</div>
            </details>
          ) : null}
        </div>

        <aside>
          {data.software.length ? (
            <section className="mb-8">
              <h2 className="kicker mb-3 border-b border-line pb-2">Software</h2>
              <ul className="flex flex-col gap-1.5 text-[13.5px] text-text-2">
                {data.software.map((software) => (
                  <li key={software.id}>{software.name}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {data.tags.length ? (
            <section>
              <h2 className="kicker mb-3 border-b border-line pb-2">Tags</h2>
              <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
                {data.tags.map((tag) => (
                  <li key={tag.id}>
                    <Link
                      to={`/resources?tag=${tag.slug}`}
                      className="text-[13px] text-text-3 hover:text-accent"
                    >
                      {tag.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>

      {data.resources.length ? (
        <section className="mt-4">
          <h2 className="mb-6 border-t border-line pt-4 text-[26px]">Resources used</h2>
          <CardGrid>
            {data.resources.map((resource) => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                footnote={
                  resource.note ? (
                    <p className="mt-1.5 text-[13px] leading-relaxed text-accent">{resource.note}</p>
                  ) : undefined
                }
              />
            ))}
          </CardGrid>
        </section>
      ) : null}

      {data.related.length ? (
        <section className="mt-14">
          <h2 className="mb-6 border-t border-line pt-4 text-[24px]">Watch next</h2>
          <div className="grid gap-x-6 gap-y-9 md:grid-cols-3">
            {data.related.slice(0, 3).map((tutorial) => (
              <TutorialCard key={tutorial.id} tutorial={tutorial} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
