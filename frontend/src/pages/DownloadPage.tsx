import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { DownloadButton } from '../components/DownloadButton';
import { LinkButton, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';

interface Info {
  title: string;
  slug: string;
  shortDescription: string;
  version: string | null;
  filename: string | null;
  size: number | null;
  sizeLabel: string | null;
}

/**
 * The permanent public share URL (PRD §15, §30).
 *
 * Someone lands here from a social post. It shows what they are about to get,
 * then downloads it. No account, no gate.
 */
export default function DownloadPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useTitle(info ? `Download ${info.title} · Cyriq VFX` : 'Download · Cyriq VFX');

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    api
      .get<Info>(`/download/${token}/info`, controller.signal)
      .then(setInfo)
      .catch((err) => {
        if (err instanceof ApiError) setError(err);
      });
    return () => controller.abort();
  }, [token]);

  if (error) {
    const gone = error.status === 410;
    return (
      <div className="page py-20 md:py-28">
        <div className="max-w-xl">
          <p className="eyebrow flex items-center gap-2 text-[color:var(--warn)]">
            <Icon name={gone ? 'history' : 'alert'} size={14} />
            {gone ? 'Retired' : 'Invalid link'}
          </p>
          <h1 className="mt-3 text-[34px] leading-[1.05] md:text-[46px]">
            {gone ? 'This one has been retired' : 'That download link is not valid'}
          </h1>
          <p className="copy mt-5">{error.message}</p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <LinkButton to="/resources" variant="primary" iconRight="arrow-right">
              Browse resources
            </LinkButton>
            <Link to="/" className="link text-[14.5px]">
              Go home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!info || !token) {
    return (
      <div className="page py-20">
        <div className="max-w-md">
          <Skeleton className="mb-4 h-10 w-3/4" />
          <Skeleton className="mb-8 h-4 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="page py-20 md:py-28">
      <div className="max-w-lg">
        <p className="eyebrow flex items-center gap-2 text-blue">
          <Icon name="download" size={14} />
          Ready to download
        </p>

        <h1 className="mt-3 text-[34px] leading-[1.05] md:text-[44px]">{info.title}</h1>
        <p className="copy mt-4">{info.shortDescription}</p>

        <dl className="mt-7 flex flex-wrap gap-x-10 gap-y-2 border-y border-rule py-4 text-[13px]">
          {info.version ? (
            <div className="flex gap-2">
              <dt className="text-faint">Version</dt>
              <dd className="font-mono text-ink">v{info.version}</dd>
            </div>
          ) : null}
          {info.sizeLabel ? (
            <div className="flex gap-2">
              <dt className="text-faint">Size</dt>
              <dd className="font-mono text-ink">{info.sizeLabel}</dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-8 max-w-xs">
          <DownloadButton token={token} fullWidth />
        </div>

        <p className="mt-3 font-mono text-[12px] text-faint">Free / No account required</p>

        <Link to={`/resources/${info.slug}`} className="link mt-8 inline-block text-[14px]">
          See compatibility, license and install notes
        </Link>
      </div>
    </div>
  );
}
