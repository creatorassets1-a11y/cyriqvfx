import { Link, useParams } from 'react-router-dom';
import { useLoad, useTitle } from '../lib/hooks';
import type { DownloadInfo } from '../lib/types';
import { DownloadButton } from '../components/DownloadButton';
import { PageError } from '../components/Chrome';
import { Brand } from '../components/Brand';
import { useSession } from '../lib/session';
import { Fact, Skeleton } from '../ui/primitives';
import NotFound from './NotFound';

/**
 * A permanent share link.
 *
 * This is what the owner posts under a video: it always downloads the current
 * version, it never expires, and it works for someone who has never been here
 * before. The page exists so that link has a destination that explains what is
 * about to be downloaded rather than dropping a file on a stranger.
 */
export default function ShareLink() {
  const { token } = useParams<{ token: string }>();
  const { settings } = useSession();
  const { data, error, loading, reload } = useLoad<DownloadInfo>(
    token ? `/download/${token}/info` : null,
  );

  useTitle(data ? `Download ${data.title} · Cyriq VFX` : undefined);

  if (error?.status === 404) return <NotFound />;
  if (error?.status === 410) {
    return (
      <div className="page flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="text-[30px]">That resource has been retired</h1>
        <p className="prose mt-3 text-center">
          It is no longer available for download. The rest of the library still is.
        </p>
        <Link to="/resources" className="underlined mt-6">
          Browse the library
        </Link>
      </div>
    );
  }
  if (error) return <PageError onRetry={reload} />;

  return (
    <div className="page flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <Brand name={settings?.siteName ?? 'Cyriq VFX'} className="mb-8" />

        {loading || !data ? (
          <>
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="mt-4 h-4 w-full" />
            <Skeleton className="mt-8 h-12 w-full rounded" />
          </>
        ) : (
          <>
            <p className="kicker">Ready to download</p>
            <h1 className="mt-3 text-[32px] leading-tight">{data.title}</h1>
            <p className="prose mt-3">{data.shortDescription}</p>

            <p className="mt-5 text-[13.5px] font-semibold text-positive">
              Free / No account required
            </p>

            <div className="mt-6">
              <DownloadButton token={token!} block />
            </div>

            <dl className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4">
              {data.version ? <Fact>v{data.version}</Fact> : null}
              {data.sizeLabel ? <Fact>{data.sizeLabel}</Fact> : null}
              {data.filename ? <Fact icon="file">{data.filename}</Fact> : null}
            </dl>

            <p className="mt-6 text-[13px] text-text-3">
              Want the install steps, the license and the version history?{' '}
              <Link to={`/resources/${data.slug}`} className="underlined">
                Open the resource page
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
}
