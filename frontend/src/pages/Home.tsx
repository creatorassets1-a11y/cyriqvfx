import { Link } from 'react-router-dom';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { HomePayload } from '../lib/types';
import { formatCount } from '../lib/format';
import { CardGrid, CardGridSkeleton, ResourceCard } from '../components/ResourceCard';
import { TutorialCard } from '../components/TutorialCard';
import { PageError } from '../components/Chrome';
import { DownloadButton } from '../components/DownloadButton';
import { Icon } from '../ui/Icon';
import { ButtonLink, Fact, Marker, SectionHead } from '../ui/primitives';

/**
 * The front page.
 *
 * It has to answer three questions before anyone scrolls: what this is, what
 * is in it, and whether it costs anything. The owner writes the first answer
 * in the CMS and the server puts it in the shell, so it is on screen in the
 * first paint rather than replacing a placeholder a moment later. The rest of
 * the page is the catalogue itself — real resources, real counts.
 */
export default function Home() {
  const { settings } = useSession();
  const { data, error, loading, reload } = useLoad<HomePayload>('/resources/home');

  if (error) return <PageError onRetry={reload} />;

  return (
    <>
      <section className="page pb-12 pt-12 md:pb-16 md:pt-20">
        <div className="max-w-3xl">
          <h1 className="text-[38px] leading-[1.04] md:text-[60px]">
            {settings?.heroTitle ?? 'Free resources for video editors.'}
          </h1>
          <p className="prose mt-5 text-[17px] md:text-[18px]">
            {settings?.heroSubtitle ??
              'Scene packs, presets, LUTs, overlays and the tutorials that show what to do with them.'}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink to="/resources" variant="primary" size="lg" iconAfter="arrow-right">
              {settings?.heroPrimaryCta ?? 'Browse resources'}
            </ButtonLink>
            <ButtonLink to="/tutorials" size="lg">
              {settings?.heroSecondaryCta ?? 'Watch a tutorial'}
            </ButtonLink>
          </div>

          <p className="mt-6 flex items-center gap-2 text-[13.5px] text-positive">
            <Icon name="check" size={15} className="shrink-0" />
            <span>No account required to download</span>
          </p>
        </div>

        {/* Rendered whether or not the counts have arrived: holding the row's
            space is what keeps the sections below it from moving when they do. */}
        <dl className="mt-12 flex flex-wrap gap-x-12 gap-y-4 border-t border-line pt-6">
          <Stat label="Resources" value={data ? formatCount(data.stats.resourceCount) : '—'} />
          <Stat label="Downloads" value={data ? formatCount(data.stats.downloadCount) : '—'} />
          <Stat label="Price" value="Free" />
        </dl>
      </section>

      <section className="page pb-16">
        <SectionHead
          kicker="New this month"
          title="Latest drops"
          action={
            <Link to="/resources?sort=newest" className="underlined text-[13.5px]">
              See everything
            </Link>
          }
        />

        {loading || !data ? (
          <CardGridSkeleton count={8} />
        ) : (
          <CardGrid>
            {data.latest.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} />
            ))}
          </CardGrid>
        )}
      </section>

      {data?.featured ? (
        <section className="border-y border-line bg-inset">
          <div className="page grid gap-8 py-14 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
            <div className="frame aspect-[16/10] rounded-lg border border-line">
              {data.featured.thumbnailUrl ? (
                <img
                  src={data.featured.thumbnailUrl}
                  alt={`Preview of ${data.featured.title}`}
                  width={960}
                  height={600}
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
            </div>

            <div>
              <Marker tone="accent">Creator pick</Marker>
              <h2 className="mt-3 text-[30px] md:text-[38px]">
                <Link to={`/resources/${data.featured.slug}`} className="hover:text-accent">
                  {data.featured.title}
                </Link>
              </h2>
              <p className="prose mt-3">{data.featured.shortDescription}</p>

              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
                <Fact>{data.featured.category.name}</Fact>
                {data.featured.fileSizeLabel ? <Fact>{data.featured.fileSizeLabel}</Fact> : null}
                <Fact icon="download">{formatCount(data.featured.downloadCount)}</Fact>
              </div>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <DownloadButton token={data.featured.downloadToken} size="md" />
                <ButtonLink to={`/resources/${data.featured.slug}`} size="md">
                  See the details
                </ButtonLink>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {data?.categories.length ? (
        <section className="page py-16">
          <SectionHead kicker="By software and format" title="Where to start" />
          <ul className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 lg:grid-cols-4">
            {data.categories.map((category) => (
              <li key={category.id} className="border-t border-line pt-3">
                <Link
                  to={`/categories/${category.slug}`}
                  className="group flex items-baseline justify-between gap-3"
                >
                  <span className="text-[15px] text-text-2 transition-colors duration-fast ease-out group-hover:text-accent">
                    {category.name}
                  </span>
                  <span className="font-mono text-[12px] text-text-4">
                    {category.resourceCount}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data?.popular.length ? (
        <section className="page pb-16">
          <SectionHead kicker="Most downloaded" title="What editors take most" />
          <CardGrid>
            {data.popular.slice(0, 4).map((resource) => (
              <ResourceCard key={resource.id} resource={resource} />
            ))}
          </CardGrid>
        </section>
      ) : null}

      {data?.tutorials.length ? (
        <section className="page pb-20">
          <SectionHead
            kicker="Watch and follow"
            title="Tutorials"
            action={
              <Link to="/tutorials" className="underlined text-[13.5px]">
                All tutorials
              </Link>
            }
          />
          <div className="grid gap-x-6 gap-y-9 md:grid-cols-3">
            {data.tutorials.map((tutorial) => (
              <TutorialCard key={tutorial.id} tutorial={tutorial} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="kicker">{label}</dt>
      <dd className="mt-1 font-mono text-[22px] text-text">{value}</dd>
    </div>
  );
}
