import { Link } from 'react-router-dom';
import { useLoad, useTitle } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import type { AccountOverview } from '../../lib/types';
import { formatRelative } from '../../lib/format';
import { CardGrid, CardGridSkeleton, ResourceCard } from '../../components/ResourceCard';
import { PageError } from '../../components/Chrome';
import { ButtonLink, Empty, Note, SectionHead } from '../../ui/primitives';

/**
 * The first screen after signing in: what has been taken, what is saved, and
 * — the reason the account is worth having — what has been updated since.
 */
export default function Overview() {
  const { user } = useSession();
  const { data, error, loading, reload } = useLoad<AccountOverview>('/me/overview');

  useTitle('My library · Cyriq VFX');

  if (error) return <PageError onRetry={reload} />;

  const empty = data && data.counts.downloads === 0 && data.counts.saved === 0;

  return (
    <>
      <header className="mb-9">
        <h1 className="text-[32px] md:text-[38px]">My library</h1>
        <p className="mt-2 text-[14px] text-text-3">
          Signed in as {user?.displayName ?? user?.username}.
        </p>
      </header>

      {loading && !data ? (
        <CardGridSkeleton count={4} />
      ) : empty ? (
        <Empty
          icon="download"
          title="Your library is empty so far"
          body="Anything you download or save shows up here, with a note when a new version lands."
          action={<ButtonLink to="/resources" variant="primary">Find something to download</ButtonLink>}
        />
      ) : (
        <>
          {data?.updatesAvailable.length ? (
            <section className="mb-12">
              <SectionHead
                kicker="Since you downloaded them"
                title="New versions are available"
              />
              <ul className="flex flex-col">
                {data.updatesAvailable.map((item) => (
                  <li key={item.id} className="border-b border-line py-4 first:border-t">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <Link
                        to={`/resources/${item.slug}`}
                        className="text-[15px] text-text-2 hover:text-accent"
                      >
                        {item.title}
                      </Link>
                      <span className="font-mono text-[12px] text-text-4">
                        you have v{item.downloadedVersion} / now v{item.currentVersion}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <Note tone="accent">
                  Downloading again always gets the current version — the link never changes.
                </Note>
              </div>
            </section>
          ) : null}

          {data?.recentDownloads.length ? (
            <section className="mb-12">
              <SectionHead
                title="Recent downloads"
                action={
                  <Link to="/account/downloads" className="underlined text-[13.5px]">
                    All {data.counts.downloads}
                  </Link>
                }
              />
              <CardGrid>
                {data.recentDownloads.slice(0, 4).map((item) => (
                  <ResourceCard
                    key={`${item.id}-${item.downloadedAt}`}
                    resource={item}
                    footnote={
                      <p className="mt-1.5 font-mono text-[12px] text-text-4">
                        {formatRelative(item.downloadedAt)}
                        {item.downloadedVersion ? ` / v${item.downloadedVersion}` : ''}
                      </p>
                    }
                  />
                ))}
              </CardGrid>
            </section>
          ) : null}

          {data?.saved.length ? (
            <section>
              <SectionHead
                title="Saved"
                action={
                  <Link to="/account/saved" className="underlined text-[13.5px]">
                    All {data.counts.saved}
                  </Link>
                }
              />
              <CardGrid>
                {data.saved.slice(0, 4).map((item) => (
                  <ResourceCard key={item.id} resource={item} />
                ))}
              </CardGrid>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
