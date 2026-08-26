import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useFetch, useTitle } from '../lib/hooks';
import type { ResourceDetail as ResourceDetailType } from '../lib/api';
import { ResourcePreview } from '../components/Preview';
import { DownloadButton, StickyDownloadBar } from '../components/DownloadButton';
import { SaveButton } from '../components/SaveButton';
import { ShareMenu } from '../components/ShareMenu';
import { ResourceCard } from '../components/ResourceCard';
import { Marker, Fact, cx, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatCount, formatDate, formatDuration, flagLabel, skillLabel } from '../lib/format';
import NotFound from './NotFound';
import { PageError } from '../components/Layout';

/**
 * Resource detail (PRD §13, §83).
 *
 * Visual order: identity → preview → value → compatibility/license → download
 * → details → installation → versions → tutorials → related. The page answers
 * "can I use this?" before anyone has to read a paragraph.
 */
export default function ResourceDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { data, loading, error, reload } = useFetch<ResourceDetailType>(
    slug ? `/resources/${slug}` : null,
  );
  const ctaRef = useRef<HTMLDivElement>(null);
  const [showSticky, setShowSticky] = useState(false);

  useTitle(data ? `${data.title} · Cyriq VFX` : undefined);

  // The sticky mobile bar appears only once the real CTA is off screen.
  useEffect(() => {
    const node = ctaRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowSticky(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [data]);

  if (error?.status === 404) return <NotFound />;
  if (error) return <PageError onRetry={reload} />;
  if (loading || !data) return <DetailSkeleton />;

  const license = data.license;
  const currentVersion = data.versions.find((v) => v.isCurrent) ?? data.versions[0];

  return (
    <>
      <div className="page py-8 md:py-12">
        <nav aria-label="Breadcrumb" className="mb-7 flex items-center gap-1.5 text-[12.5px] text-faint">
          <Link to="/resources" className="hover:text-ink">
            Resources
          </Link>
          <Icon name="chevron-right" size={13} />
          <Link to={`/categories/${data.category.slug}`} className="hover:text-ink">
            {data.category.name}
          </Link>
        </nav>

        <div className="grid gap-10 lg:grid-cols-[1fr_320px] lg:gap-16">
          {/* Main column */}
          <div className="min-w-0">
            <header className="mb-7">
              <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                {data.isNew ? <Marker tone="blue">New</Marker> : null}
                {data.isUpdated ? <Marker tone="go">Updated</Marker> : null}
                {data.qualityFlags.map((f) => (
                  <Marker key={f} tone={f === 'EXPERIMENTAL' ? 'warn' : 'neutral'}>
                    {flagLabel(f)}
                  </Marker>
                ))}
              </div>

              <h1 className="text-[34px] leading-[1.05] md:text-[46px]">{data.title}</h1>
              <p className="copy mt-4 text-[17px]">{data.shortDescription}</p>
            </header>

            <ResourcePreview resource={data} />

            {/* Compatibility and license, answered before the fold on mobile */}
            <div className="mt-8 grid gap-8 sm:grid-cols-2 sm:gap-10">
              <FactPanel
                title="Works with"
                icon="check"
                tone={data.softwareCompatibility.length > 0 ? 'go' : 'neutral'}
              >
                {data.softwareCompatibility.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {data.softwareCompatibility.map((s) => (
                      <li key={s.id} className="text-[13.5px]">
                        <span className="font-medium text-ink">{s.name}</span>
                        {s.minVersion ? (
                          <span className="text-soft"> {s.minVersion} and newer</span>
                        ) : null}
                        {s.note ? <span className="block text-[12.5px] text-faint">{s.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13.5px] text-soft">
                    Not tied to specific software. See the requirements below.
                  </p>
                )}
              </FactPanel>

              <FactPanel
                title="License"
                icon={license?.commercialUse ? 'check' : 'info'}
                tone={license?.commercialUse ? 'go' : 'warn'}
              >
                {license ? (
                  <>
                    <p className="text-[13.5px] font-medium text-ink">{license.name}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-soft">{license.summary}</p>
                    <ul className="mt-2.5 flex flex-col gap-1">
                      <Permission allowed={license.personalUse} label="Personal projects" />
                      <Permission allowed={license.commercialUse} label="Commercial and client work" />
                      <Permission allowed={license.modification} label="Modify and remix" />
                      <Permission allowed={license.redistribution} label="Redistribute the file" />
                      <Permission allowed={license.resale} label="Resell" />
                      {license.attributionRequired ? (
                        <li className="flex items-center gap-1.5 text-[12.5px] text-warn">
                          <Icon name="info" size={12} />
                          Credit required
                        </li>
                      ) : null}
                    </ul>
                  </>
                ) : (
                  <p className="text-[13.5px] text-soft">
                    No license has been set for this resource yet.
                  </p>
                )}
              </FactPanel>
            </div>

            {/* Mobile CTA sits right after the facts */}
            <div ref={ctaRef} className="mt-10 lg:hidden">
              <DownloadCard resource={data} currentVersion={currentVersion} />
            </div>

            <div className="mt-14 flex flex-col gap-12">
              {data.fullDescription ? (
                <Section title="About this resource">
                  <div className="copy whitespace-pre-line">{data.fullDescription}</div>
                </Section>
              ) : null}

              {data.requirements ? (
                <Section title="Requirements">
                  <p className="copy">{data.requirements}</p>
                </Section>
              ) : null}

              {data.installationGuide ? (
                <Section title="How to install it">
                  <div className="steps border-l-2 border-blue-lighter pl-5">
                    {data.installationGuide}
                  </div>
                </Section>
              ) : null}

              {data.versions.length > 0 ? (
                <Section title="Version history">
                  <ol className="flex flex-col">
                    {data.versions.map((v) => (
                      <li
                        key={v.id}
                        className={cx(
                          'border-b border-rule py-5 first:border-t',
                          v.isCurrent && 'border-l-2 border-l-blue pl-5',
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <span className="font-mono text-[14px] font-semibold text-ink">
                            v{v.version}
                          </span>
                          {v.isCurrent ? <Marker tone="blue">Current</Marker> : null}
                          <span className="ml-auto text-[12.5px] text-faint">
                            {formatDate(v.publishedAt)}
                          </span>
                        </div>
                        {v.releaseNotes ? (
                          <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-soft">
                            {v.releaseNotes}
                          </p>
                        ) : null}
                        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                          <Fact>{v.fileSizeLabel}</Fact>
                          {v.compatibility ? <Fact>{v.compatibility}</Fact> : null}
                          {!v.isCurrent ? (
                            <a
                              href={`/download/${data.downloadToken}?version=${encodeURIComponent(v.version)}`}
                              onClick={(e) => e.preventDefault()}
                              className="ml-auto"
                            >
                              <DownloadButton
                                token={data.downloadToken}
                                version={v.version}
                                label={`Download v${v.version}`}
                                size="md"
                              />
                            </a>
                          ) : null}
                        </div>
                        {v.checksum ? (
                          <p className="mt-3 break-all font-mono text-[11px] text-ghost">
                            SHA-256 {v.checksum}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </Section>
              ) : null}

              {/* Tutorial ↔ resource loop (PRD §24, §71) */}
              {data.tutorials.length > 0 ? (
                <Section title="Tutorials using this">
                  <div className="grid gap-x-8 sm:grid-cols-2">
                    {data.tutorials.map((t) => (
                      <Link
                        key={t.id}
                        to={`/tutorials/${t.slug}`}
                        className="group flex gap-4 border-b border-rule py-4 first:border-t sm:[&:nth-child(2)]:border-t"
                      >
                        <span className="well h-16 w-24 shrink-0">
                          {t.coverUrl ? <img src={t.coverUrl} alt="" loading="lazy" /> : null}
                          <span
                            className="absolute inset-0 grid place-items-center text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]"
                            aria-hidden
                          >
                            <Icon name="play" size={18} />
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-display text-[16px] leading-snug group-hover:text-blue">
                            {t.title}
                          </span>
                          <span className="mt-1 block font-mono text-[11.5px] text-ghost">
                            {skillLabel(t.skillLevel)}
                            {t.durationSeconds ? ` · ${formatDuration(t.durationSeconds)}` : ''}
                          </span>
                          {t.note ? (
                            <span className="mt-1 block line-clamp-2 text-[12.5px] text-soft">
                              {t.note}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    ))}
                  </div>
                </Section>
              ) : null}

              {data.tags.length > 0 ? (
                <Section title="Tags">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    {data.tags.map((t) => (
                      <Link
                        key={t.id}
                        to={`/resources?tag=${t.slug}`}
                        className="text-[13.5px] text-soft underline decoration-rule-strong underline-offset-4 transition-colors duration-fast hover:text-blue hover:decoration-blue"
                      >
                        {t.name}
                      </Link>
                    ))}
                  </div>
                </Section>
              ) : null}

              <p className="border-t border-rule pt-6 text-[13px] text-faint">
                Something wrong with this resource?{' '}
                <Link to={`/report?resource=${data.id}`} className="link">
                  Report a problem
                </Link>
              </p>
            </div>
          </div>

          {/* Desktop sticky sidebar (PRD §84) */}
          <aside className="hidden min-w-0 lg:block lg:border-l lg:border-rule lg:pl-10">
            <div className="sticky top-[calc(var(--bar)+1.5rem)]">
              <DownloadCard resource={data} currentVersion={currentVersion} />
            </div>
          </aside>
        </div>

        {data.related.length > 0 ? (
          <section className="mt-20">
            <h2 className="mb-7 border-b border-ink pb-3 text-[26px] md:text-[30px]">
              Related resources
            </h2>
            <div className="grid grid-cols-1 gap-x-8 gap-y-10 min-[560px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.related.map((r) => (
                <ResourceCard key={r.id} resource={r} />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <StickyDownloadBar
        token={data.downloadToken}
        title={data.title}
        sizeLabel={data.fileSizeLabel}
        visible={showSticky}
      />
      {/* Reserve space so the sticky bar never covers the footer. */}
      {showSticky ? <div className="h-20 md:hidden" aria-hidden /> : null}
    </>
  );
}

function DownloadCard({
  resource,
  currentVersion,
}: {
  resource: ResourceDetailType;
  currentVersion: ResourceDetailType['versions'][number] | undefined;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-5 flex items-baseline justify-between gap-3 border-b border-ink pb-3">
        <span className="font-display text-[26px] text-go">Free</span>
        {resource.downloadCount > 0 ? (
          <span className="flex items-center gap-1.5 font-mono text-[12px] text-faint">
            <Icon name="download" size={12} />
            {formatCount(resource.downloadCount)}
          </span>
        ) : null}
      </div>

      <DownloadButton token={resource.downloadToken} fullWidth />

      <p className="mt-3 text-center text-[12.5px] text-faint">No account required.</p>

      <div className="mt-5 flex gap-3">
        <SaveButton resourceId={resource.id} initialSaved={resource.saved} />
        <ShareMenu
          title={resource.title}
          resourcePath={`/resources/${resource.slug}`}
          downloadToken={resource.downloadToken}
        />
      </div>

      {/* Only rows that have an answer are shown; a blank row tells nobody anything. */}
      <dl className="mt-7 flex flex-col text-[13px]">
        {currentVersion ? <Spec label="Version" value={`v${currentVersion.version}`} mono /> : null}
        {resource.fileSizeLabel ? <Spec label="Size" value={resource.fileSizeLabel} mono /> : null}
        {resource.format ? <Spec label="Format" value={resource.format} /> : null}
        {resource.originalFilename ? (
          <Spec label="File" value={resource.originalFilename} truncate />
        ) : null}
        <Spec label="Updated" value={formatDate(resource.updatedAt)} />
        <Spec label="Category" value={resource.category.name} />
      </dl>
    </div>
  );
}

function Spec({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule py-2 first:border-t">
      <dt className="shrink-0 text-faint">{label}</dt>
      <dd
        className={cx(
          'text-right font-medium text-ink',
          mono && 'font-mono text-[12.5px]',
          truncate && 'min-w-0 truncate',
        )}
        title={truncate ? value : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

function FactPanel({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: 'check' | 'info';
  tone: 'go' | 'warn' | 'neutral';
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 border-t border-ink pt-3">
      <h2 className="eyebrow mb-3 flex items-center gap-1.5">
        <Icon
          name={icon}
          size={13}
          className={
            tone === 'go' ? 'text-go' : tone === 'warn' ? 'text-warn' : 'text-faint'
          }
        />
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Permission rows never rely on colour alone (PRD §56). */
function Permission({ allowed, label }: { allowed: boolean; label: string }) {
  return (
    <li className="flex items-center gap-1.5 text-[12.5px]">
      <Icon
        name={allowed ? 'check' : 'close'}
        size={12}
        className={allowed ? 'text-go' : 'text-faint'}
      />
      <span className={allowed ? 'text-soft' : 'text-faint line-through decoration-1'}>{label}</span>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h2 className="mb-4 border-b border-rule pb-2.5 text-[22px] md:text-[25px]">{title}</h2>
      {children}
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div className="page py-8 md:py-12">
      <Skeleton className="mb-7 h-4 w-40" />
      <div className="grid gap-10 lg:grid-cols-[1fr_320px] lg:gap-16">
        <div>
          <Skeleton className="mb-4 h-11 w-3/4" />
          <Skeleton className="mb-8 h-4 w-full max-w-xl" />
          <Skeleton className="aspect-video w-full" />
          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
        <Skeleton className="hidden h-80 lg:block" />
      </div>
    </div>
  );
}
