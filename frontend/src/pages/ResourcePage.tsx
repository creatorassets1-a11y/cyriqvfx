import { Link, useParams } from 'react-router-dom';
import { useLoad, useScrolledPast, useTitle } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { Resource } from '../lib/types';
import { formatCount, formatDate, formatDuration, flagLabel, skillLabel } from '../lib/format';
import { ResourcePreview } from '../components/Preview';
import { DownloadButton, StickyDownload } from '../components/DownloadButton';
import { SaveButton } from '../components/SaveButton';
import { ShareMenu } from '../components/ShareMenu';
import { CardGrid, ResourceCard } from '../components/ResourceCard';
import { PageError } from '../components/Chrome';
import { Icon } from '../ui/Icon';
import { Fact, Marker, Skeleton, cx } from '../ui/primitives';
import NotFound from './NotFound';

/**
 * A resource.
 *
 * The order of this page is the order of the questions someone actually asks:
 * what is it, what does it look like, does it work with my software, what am I
 * allowed to do with it, and then — only then — the details, the install
 * steps, the history and what else goes with it. Compatibility and license sit
 * above the fold on a phone, because those are the two answers that decide
 * whether the download is worth starting.
 */
export default function ResourcePage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useSession();
  const { data, error, loading, reload } = useLoad<Resource>(slug ? `/resources/${slug}` : null);
  const [ctaRef, ctaPassed] = useScrolledPast<HTMLDivElement>();

  useTitle(data ? `${data.title} · Cyriq VFX` : undefined);

  if (error?.status === 404) return <NotFound />;
  if (error) return <PageError onRetry={reload} />;
  if (loading || !data) return <DetailSkeleton />;

  const current = data.versions.find((version) => version.isCurrent) ?? data.versions[0];

  return (
    <>
      <div className="page py-8 md:py-12">
        <nav aria-label="Breadcrumb" className="mb-7 flex items-center gap-1.5 text-[12.5px] text-text-3">
          <Link to="/resources" className="hover:text-text">
            Resources
          </Link>
          <Icon name="chevron-right" size={13} />
          <Link to={`/categories/${data.category.slug}`} className="hover:text-text">
            {data.category.name}
          </Link>
        </nav>

        <div className="grid gap-12 lg:grid-cols-[1fr_320px] lg:gap-16">
          <div className="min-w-0">
            <header className="mb-7">
              {data.isNew || data.isUpdated || data.qualityFlags.length ? (
                <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
                  {data.isNew ? <Marker tone="accent">New</Marker> : null}
                  {data.isUpdated ? <Marker tone="positive">Updated</Marker> : null}
                  {data.qualityFlags.map((flag) => (
                    <Marker key={flag} tone={flag === 'EXPERIMENTAL' ? 'caution' : 'neutral'}>
                      {flagLabel(flag)}
                    </Marker>
                  ))}
                </div>
              ) : null}

              <h1 className="text-[34px] leading-[1.05] md:text-[46px]">{data.title}</h1>
              <p className="prose mt-4 text-[17px]">{data.shortDescription}</p>
            </header>

            <ResourcePreview resource={data} />

            <div className="mt-9 grid gap-9 sm:grid-cols-2 sm:gap-10">
              <section>
                <h2 className="kicker mb-3 border-b border-line pb-2">Works with</h2>
                {data.softwareCompatibility.length ? (
                  <ul className="flex flex-col gap-2">
                    {data.softwareCompatibility.map((software) => (
                      <li key={software.id} className="text-[13.5px]">
                        <span className="font-medium text-text">{software.name}</span>
                        {software.minVersion ? (
                          <span className="text-text-2"> {software.minVersion} and newer</span>
                        ) : null}
                        {software.note ? (
                          <span className="block text-[12.5px] text-text-3">{software.note}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13.5px] text-text-2">
                    Not tied to one piece of software. Check the requirements below.
                  </p>
                )}
              </section>

              <section>
                <h2 className="kicker mb-3 border-b border-line pb-2">License</h2>
                {data.license ? (
                  <>
                    <p className="text-[13.5px] font-medium text-text">{data.license.name}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-text-2">
                      {data.license.summary}
                    </p>
                    <ul className="mt-3 flex flex-col gap-1">
                      <Permission allowed={data.license.personalUse} label="Personal projects" />
                      <Permission
                        allowed={data.license.commercialUse}
                        label="Commercial and client work"
                      />
                      <Permission allowed={data.license.modification} label="Modify and remix" />
                      <Permission
                        allowed={data.license.redistribution}
                        label="Redistribute the file"
                      />
                      <Permission allowed={data.license.resale} label="Resell" />
                    </ul>
                    {data.license.attributionRequired ? (
                      <p className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-caution">
                        <Icon name="info" size={13} />
                        Credit the creator when you use it
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-[13.5px] text-text-2">
                    No license has been set for this resource yet.
                  </p>
                )}
              </section>
            </div>

            {/* On a phone the call to action belongs here, right after the
                two answers that decide whether anyone wants it. */}
            <div ref={ctaRef} className="mt-10 lg:hidden">
              <DownloadPanel resource={data} saved={data.saved} signedIn={!!user} />
            </div>

            <div className="mt-14 flex flex-col gap-12">
              {data.fullDescription ? (
                <Section title="About this resource">
                  <div className="prose whitespace-pre-line">{data.fullDescription}</div>
                </Section>
              ) : null}

              {data.requirements ? (
                <Section title="Requirements">
                  <p className="prose">{data.requirements}</p>
                </Section>
              ) : null}

              {data.installationGuide ? (
                <Section title="How to install it">
                  <div className="instructions border-l-2 border-accent-dim pl-5">
                    {data.installationGuide}
                  </div>
                </Section>
              ) : null}

              {data.versions.length ? (
                <Section title="Version history">
                  <ol className="flex flex-col">
                    {data.versions.map((version) => (
                      <li
                        key={version.id}
                        className={cx(
                          'border-b border-line py-5 first:border-t',
                          version.isCurrent && 'border-l-2 border-l-accent pl-5',
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <span className="font-mono text-[14px] font-semibold text-text">
                            v{version.version}
                          </span>
                          {version.isCurrent ? <Marker tone="accent">Current</Marker> : null}
                          <span className="ml-auto text-[12.5px] text-text-3">
                            {formatDate(version.publishedAt)}
                          </span>
                        </div>

                        {version.releaseNotes ? (
                          <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-text-2">
                            {version.releaseNotes}
                          </p>
                        ) : null}

                        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                          <Fact>{version.fileSizeLabel}</Fact>
                          {version.compatibility ? <Fact>{version.compatibility}</Fact> : null}
                          {!version.isCurrent ? (
                            <span className="ml-auto">
                              <DownloadButton
                                token={data.downloadToken}
                                version={version.version}
                                label={`Download v${version.version}`}
                                size="sm"
                              />
                            </span>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                </Section>
              ) : null}

              {data.tutorials.length ? (
                <Section title="Tutorials using this">
                  <ul className="flex flex-col">
                    {data.tutorials.map((tutorial) => (
                      <li key={tutorial.id} className="border-b border-line first:border-t">
                        <Link
                          to={`/tutorials/${tutorial.slug}`}
                          className="group flex items-center gap-4 py-4"
                        >
                          <div className="frame h-14 w-24 shrink-0 rounded border border-line">
                            {tutorial.coverUrl ? (
                              <img
                                src={tutorial.coverUrl}
                                alt=""
                                width={192}
                                height={112}
                                loading="lazy"
                                decoding="async"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14.5px] text-text-2 group-hover:text-accent">
                              {tutorial.title}
                            </p>
                            <p className="mt-0.5 flex items-center gap-3 font-mono text-[11.5px] text-text-4">
                              <span>{skillLabel(tutorial.skillLevel)}</span>
                              {tutorial.durationSeconds ? (
                                <span>{formatDuration(tutorial.durationSeconds)}</span>
                              ) : null}
                            </p>
                          </div>
                          <Icon name="chevron-right" size={16} className="shrink-0 text-text-4" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              {data.tags.length ? (
                <Section title="Tags">
                  <ul className="flex flex-wrap gap-x-4 gap-y-2">
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
                </Section>
              ) : null}
            </div>
          </div>

          {/* The desktop rail. It is the same panel the phone gets inline. */}
          <div className="hidden lg:block">
            <div className="sticky top-[calc(var(--masthead)+24px)]">
              <DownloadPanel resource={data} saved={data.saved} signedIn={!!user} />
            </div>
          </div>
        </div>
      </div>

      {data.related.length ? (
        <section className="page pb-20">
          <h2 className="mb-6 border-t border-line pt-4 text-[24px]">Goes well with this</h2>
          <CardGrid>
            {data.related.slice(0, 4).map((resource) => (
              <ResourceCard key={resource.id} resource={resource} />
            ))}
          </CardGrid>
        </section>
      ) : null}

      <StickyDownload
        token={data.downloadToken}
        title={data.title}
        sizeLabel={current?.fileSizeLabel ?? data.fileSizeLabel}
        visible={ctaPassed}
      />
    </>
  );
}

function DownloadPanel({
  resource,
  saved,
  signedIn,
}: {
  resource: Resource;
  saved: boolean;
  signedIn: boolean;
}) {
  const { settings } = useSession();
  const current = resource.versions.find((version) => version.isCurrent) ?? resource.versions[0];

  return (
    <div className="rounded-lg border border-line-strong bg-inset p-5">
      <p className="font-display text-[28px] leading-none">Free</p>
      <p className="mt-2 text-[13px] leading-relaxed text-text-3">
        {settings?.downloadMessage ?? 'Free download. No account required.'}
      </p>

      <div className="mt-5">
        <DownloadButton token={resource.downloadToken} block />
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <SaveButton
          resourceId={resource.id}
          title={resource.title}
          saved={saved}
          key={signedIn ? 'in' : 'out'}
        />
        <ShareMenu
          title={resource.title}
          path={`/resources/${resource.slug}`}
          downloadToken={resource.downloadToken}
        />
      </div>

      <dl className="mt-6 flex flex-col gap-2.5 border-t border-line pt-4 text-[12.5px]">
        {current ? <Detail label="Version" value={`v${current.version}`} /> : null}
        {current?.fileSizeLabel ? <Detail label="Size" value={current.fileSizeLabel} /> : null}
        {resource.format ? <Detail label="Format" value={resource.format} /> : null}
        {resource.originalFilename ? (
          <Detail label="File" value={resource.originalFilename} />
        ) : null}
        <Detail label="Downloads" value={formatCount(resource.downloadCount)} />
        {resource.publishedAt ? (
          <Detail label="Published" value={formatDate(resource.publishedAt)} />
        ) : null}
      </dl>

      <p className="mt-5 border-t border-line pt-4 text-[12px] leading-relaxed text-text-4">
        Something wrong with this file?{' '}
        <Link to={`/report?resource=${resource.slug}`} className="underlined">
          Report it
        </Link>
        .
      </p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-text-4">{label}</dt>
      <dd className="truncate font-mono text-text-2">{value}</dd>
    </div>
  );
}

function Permission({ allowed, label }: { allowed: boolean; label: string }) {
  return (
    <li
      className={cx(
        'flex items-center gap-1.5 text-[12.5px]',
        allowed ? 'text-text-2' : 'text-text-4',
      )}
    >
      <Icon
        name={allowed ? 'check' : 'close'}
        size={12}
        className={allowed ? 'text-positive' : 'text-text-4'}
      />
      {label}
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-5 border-t border-line pt-4 text-[24px]">{title}</h2>
      {children}
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div className="page py-12">
      <div className="grid gap-12 lg:grid-cols-[1fr_320px]">
        <div>
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-8 aspect-video w-full rounded-lg" />
          <Skeleton className="mt-8 h-40 w-full" />
        </div>
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    </div>
  );
}
