import { Link } from 'react-router-dom';
import { useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import type { ResourceCard as ResourceCardType, ResourceDetail } from '../lib/api';
import { ResourceCard, ResourceCardSkeleton } from '../components/ResourceCard';
import { Marker, Fact, MoreLink, Section, cx, LinkButton } from '../components/ui';
import { Icon, categoryIcon } from '../components/Icon';
import { DownloadButton } from '../components/DownloadButton';
import { formatCount, formatDate, formatDuration, skillLabel } from '../lib/format';
import { PageError } from '../components/Layout';

/**
 * The front page (PRD §11, §82).
 *
 * Laid out as a catalogue: a masthead, then numbered sections separated by
 * rules. Nothing is placed inside a card. Every number shown is real, and the
 * slots that hold them are reserved so a late response cannot shift the page.
 */

interface HomeData {
  latest: ResourceCardType[];
  featured: ResourceDetail | null;
  popular: ResourceCardType[];
  recentlyUpdated: ResourceCardType[];
  categories: Array<{
    id: string;
    name: string;
    slug: string;
    icon: string | null;
    description: string | null;
    resourceCount: number;
  }>;
  tutorials: Array<{
    id: string;
    title: string;
    slug: string;
    summary: string;
    coverUrl: string | null;
    durationSeconds: number | null;
    skillLevel: string;
    publishedAt: string | null;
    resourceCount: number;
  }>;
  stats: { resourceCount: number; downloadCount: number };
}

export default function Home() {
  const { settings } = useAuth();
  const { data, loading, error, reload } = useFetch<HomeData>('/resources/home');

  if (error) return <PageError onRetry={reload} />;

  return (
    <>
      <Masthead
        title={settings?.heroTitle ?? 'Free resources for video editors.'}
        subtitle={
          settings?.heroSubtitle ??
          'Scene packs, After Effects tools, LUTs, presets, overlays, templates and SFX, with the tutorials that show you how to use them.'
        }
        primaryCta={settings?.heroPrimaryCta ?? 'Browse resources'}
        secondaryCta={settings?.heroSecondaryCta ?? 'Latest drops'}
        stats={data?.stats}
        categories={data?.categories ?? []}
      />

      {/* Latest leads, because that is what a returning visitor came for. */}
      <Section
        id="latest"
        eyebrow="01 / New this month"
        title="Latest drops"
        description="Newest first. Everything here is free."
        action={<MoreLink to="/resources">All resources</MoreLink>}
        className="page mt-16 scroll-mt-24 md:mt-24"
      >
        <div className="grid grid-cols-1 gap-x-8 gap-y-10 min-[560px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {loading
            ? Array.from({ length: 4 }, (_, i) => <ResourceCardSkeleton key={i} />)
            : data?.latest.slice(0, 8).map((r) => <ResourceCard key={r.id} resource={r} />)}
        </div>
      </Section>

      {data?.featured ? <FeaturedResource resource={data.featured} /> : null}

      {data && data.categories.length > 0 ? (
        <Section
          eyebrow="03 / The shelves"
          title="Browse by category"
          className="page mt-16 md:mt-24"
        >
          <ul className="grid grid-cols-1 gap-x-10 min-[560px]:grid-cols-2 lg:grid-cols-4">
            {data.categories.slice(0, 8).map((c) => (
              <li key={c.id} className="border-b border-rule">
                <Link
                  to={`/categories/${c.slug}`}
                  className="group flex items-center gap-3 py-4 transition-colors duration-fast"
                >
                  <Icon
                    name={categoryIcon(c.icon)}
                    size={18}
                    className="shrink-0 text-ghost transition-colors duration-fast group-hover:text-blue"
                  />
                  <span className="min-w-0 flex-1 truncate font-display text-[18px] transition-colors duration-fast group-hover:text-blue">
                    {c.name}
                  </span>
                  <span className="shrink-0 font-mono text-[12px] text-ghost">
                    {c.resourceCount}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* Two unequal columns rather than another identical grid (PRD §82). */}
      {data && (data.popular.length > 0 || data.recentlyUpdated.length > 0) ? (
        <section className="page mt-16 grid gap-12 md:mt-24 lg:grid-cols-[1.7fr_1fr] lg:gap-16">
          {/* min-w-0: grid items default to min-width:auto and refuse to shrink
              below their content, which overflows narrow phones. */}
          <div className="min-w-0">
            <h2 className="mb-6 border-b border-ink pb-3 text-[24px] md:text-[28px]">
              Most downloaded
            </h2>
            {data.popular.length > 0 ? (
              <ol className="flex flex-col">
                {data.popular.map((r, i) => (
                  <li key={r.id} className="border-b border-rule">
                    <Link
                      to={`/resources/${r.slug}`}
                      className="group flex items-center gap-4 py-3.5"
                    >
                      <span className="w-6 shrink-0 font-mono text-[12px] text-ghost">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="well h-11 w-[72px] shrink-0">
                        {r.thumbnailUrl ? (
                          <img src={r.thumbnailUrl} alt="" loading="lazy" width={144} height={81} />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-[17px] transition-colors duration-fast group-hover:text-blue">
                          {r.title}
                        </span>
                        <span className="block truncate text-[12.5px] text-faint">
                          {r.category.name}
                          {r.software[0] ? `, ${r.software[0].name}` : ''}
                        </span>
                      </span>
                      {r.downloadCount > 0 ? (
                        <span className="shrink-0 font-mono text-[12px] text-faint">
                          {formatCount(r.downloadCount)}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="border-l-2 border-rule-strong py-2 pl-5 text-[14px] text-faint">
                Download counts appear here once people start downloading.
              </p>
            )}
          </div>

          <div className="min-w-0">
            <h2 className="mb-6 border-b border-ink pb-3 text-[24px] md:text-[28px]">
              Recently updated
            </h2>
            <ul className="flex flex-col">
              {data.recentlyUpdated.map((r) => (
                <li key={r.id} className="border-b border-rule">
                  <Link
                    to={`/resources/${r.slug}`}
                    className="group flex items-baseline justify-between gap-4 py-3.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px] transition-colors duration-fast group-hover:text-blue">
                        {r.title}
                      </span>
                      <span className="text-[12.5px] text-faint">{formatDate(r.updatedAt)}</span>
                    </span>
                    {r.version ? (
                      <span className="shrink-0 font-mono text-[12px] text-blue">v{r.version}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {data && data.tutorials.length > 0 ? (
        <Section
          eyebrow="04 / Shown, not told"
          title="Latest tutorials"
          description="Each one links the exact resources it uses."
          action={<MoreLink to="/tutorials">All tutorials</MoreLink>}
          className="page mt-16 md:mt-24"
        >
          <div className="grid gap-x-8 gap-y-10 md:grid-cols-3">
            {data.tutorials.map((t) => (
              <Link
                key={t.id}
                to={`/tutorials/${t.slug}`}
                className="group min-w-0 border-t border-rule pt-4"
              >
                <div className="well aspect-video">
                  {t.coverUrl ? (
                    <img
                      src={t.coverUrl}
                      alt=""
                      loading="lazy"
                      width={640}
                      height={360}
                      className="transition-transform duration-normal ease-out md:group-hover:scale-[1.04]"
                    />
                  ) : null}
                  <span
                    className="absolute inset-0 grid place-items-center text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
                    aria-hidden
                  >
                    <Icon name="play" size={30} />
                  </span>
                  {t.durationSeconds ? (
                    <span className="absolute bottom-2 right-2 font-mono text-[11px] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                      {formatDuration(t.durationSeconds)}
                    </span>
                  ) : null}
                </div>
                <div className="pt-3">
                  <div className="flex items-center gap-2.5">
                    <span className="eyebrow text-blue">{skillLabel(t.skillLevel)}</span>
                    {t.resourceCount > 0 ? (
                      <span className="font-mono text-[11.5px] text-ghost">
                        {t.resourceCount}{' '}
                        {t.resourceCount === 1 ? 'resource' : 'resources'}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-1.5 font-display text-[19px] leading-[1.15] transition-colors duration-fast group-hover:text-blue">
                    {t.title}
                  </h3>
                  <p className="mt-2 line-clamp-2 text-[14px] leading-relaxed text-soft">
                    {t.summary}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      <AboutStrip />
    </>
  );
}

/**
 * The masthead. A headline, a note, two actions, and beside it the library
 * index. A vertical rule separates them on wide screens instead of a panel.
 */
function Masthead({
  title,
  subtitle,
  primaryCta,
  secondaryCta,
  stats,
  categories,
}: {
  title: string;
  subtitle: string;
  primaryCta: string;
  secondaryCta: string;
  stats?: { resourceCount: number; downloadCount: number };
  categories: HomeData['categories'];
}) {
  return (
    <section className="border-b border-rule">
      <div className="page grid gap-12 py-14 md:py-20 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-20">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--go)]" aria-hidden />
            No account required to download
          </p>

          <h1 className="mt-5 text-[38px] leading-[1.02] sm:text-[52px] lg:text-[64px]">{title}</h1>

          <p className="copy mt-6 text-[17px]">{subtitle}</p>

          <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
            <LinkButton to="/resources" variant="primary" size="lg" iconRight="arrow-right">
              {primaryCta}
            </LinkButton>
            <Link
              to="/#latest"
              className="link text-[15px] font-medium"
            >
              {secondaryCta}
            </Link>
          </div>

          {/* Real counts from the database, or nothing at all (PRD §109). The
              slot is always present, so numbers arriving late cannot push the
              page down (PRD §57). */}
          <p className="mt-8 min-h-[1.25rem] font-mono text-[12.5px] text-faint">
            {stats && stats.resourceCount > 0 ? (
              <>
                {stats.resourceCount} {stats.resourceCount === 1 ? 'resource' : 'resources'}
                {stats.downloadCount > 0 ? ` / ${formatCount(stats.downloadCount)} downloads` : ''}
              </>
            ) : null}
          </p>
        </div>

        {/* On wide screens the space beside the headline answers "what can I
            get here?" directly, rather than sitting empty or holding
            decoration. Hidden below lg, where the masthead must stay short. */}
        {categories.length > 0 ? (
          <div className="hidden min-w-0 lg:block lg:border-l lg:border-rule lg:pl-16">
            <p className="eyebrow mb-4">In the library</p>
            <ul className="flex flex-col">
              {categories.slice(0, 6).map((c) => (
                <li key={c.id} className="border-b border-rule first:border-t">
                  <Link
                    to={`/categories/${c.slug}`}
                    className="group flex items-center gap-3 py-2.5"
                  >
                    <Icon
                      name={categoryIcon(c.icon)}
                      size={15}
                      className="shrink-0 text-ghost transition-colors duration-fast group-hover:text-blue"
                    />
                    <span className="min-w-0 flex-1 truncate text-[14.5px] transition-colors duration-fast group-hover:text-blue">
                      {c.name}
                    </span>
                    <span className="shrink-0 font-mono text-[11.5px] text-ghost">
                      {c.resourceCount}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function FeaturedResource({ resource }: { resource: ResourceDetail }) {
  const license = resource.license;
  return (
    <Section eyebrow="02 / Pick of the month" title="Featured" className="page mt-16 md:mt-24">
      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        <div className="well aspect-[16/10] md:aspect-auto md:min-h-[320px]">
          {resource.thumbnailUrl ? (
            <img
              src={resource.thumbnailUrl}
              alt=""
              width={800}
              height={500}
              // Above the fold on most screens, so it loads eagerly. React 18
              // passes only the lowercase spelling of this attribute through.
              loading="eager"
              {...{ fetchpriority: 'high' }}
            />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Marker tone="warn">Featured</Marker>
            <Marker tone="blue">{resource.category.name}</Marker>
            {resource.isNew ? <Marker tone="go">New</Marker> : null}
          </div>

          <h3 className="mt-4 text-[28px] leading-[1.08] md:text-[36px]">
            <Link to={`/resources/${resource.slug}`} className="hover:text-blue">
              {resource.title}
            </Link>
          </h3>

          <p className="copy mt-4">{resource.shortDescription}</p>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-rule pt-4">
            {resource.softwareCompatibility.slice(0, 3).map((s) => (
              <Fact key={s.id}>
                {s.name}
                {s.minVersion ? ` ${s.minVersion}+` : ''}
              </Fact>
            ))}
            {resource.version ? <Fact>v{resource.version}</Fact> : null}
            {resource.fileSizeLabel ? <Fact>{resource.fileSizeLabel}</Fact> : null}
          </div>

          {license ? (
            <p className="mt-4 flex items-start gap-2 text-[13.5px] text-soft">
              <Icon
                name={license.commercialUse ? 'check' : 'info'}
                size={14}
                className={cx('mt-1 shrink-0', license.commercialUse ? 'text-go' : 'text-warn')}
              />
              {license.summary}
            </p>
          ) : null}

          <div className="mt-auto flex flex-wrap items-center gap-x-7 gap-y-3 pt-7">
            <DownloadButton token={resource.downloadToken} size="md" />
            <MoreLink to={`/resources/${resource.slug}`}>See details</MoreLink>
          </div>
        </div>
      </div>
    </Section>
  );
}

/**
 * The closing note, set on the deep navy of the mark. A change of ground
 * rather than another framed panel.
 */
function AboutStrip() {
  const { settings } = useAuth();
  if (!settings) return null;

  return (
    <section data-band className="mt-20 bg-navy-deep py-16 text-white md:mt-28 md:py-20">
      <div className="page grid gap-10 md:grid-cols-[1.5fr_1fr] md:gap-16">
        <div className="min-w-0">
          <p className="eyebrow text-blue-light">About</p>
          <h2 className="mt-3 text-[28px] leading-[1.1] text-white md:text-[36px]">
            {settings.aboutTitle}
          </h2>
          <p className="mt-5 max-w-[62ch] text-[16px] leading-[1.72] text-white/70">
            {settings.aboutBody}
          </p>
        </div>
        <div className="flex min-w-0 flex-col justify-end gap-5 md:border-l md:border-white/15 md:pl-16">
          <p className="text-[14.5px] leading-relaxed text-white/70">
            Every resource lists the software it works with, what is inside the file, and a license
            you can actually read before you download.
          </p>
          <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
            <Link
              to="/about"
              className="text-[14.5px] font-medium text-white underline decoration-white/40 underline-offset-4 transition-colors duration-fast hover:decoration-white"
            >
              About the library
            </Link>
            <Link
              to="/requests"
              className="text-[14.5px] text-white/70 transition-colors duration-fast hover:text-white"
            >
              Request something
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
