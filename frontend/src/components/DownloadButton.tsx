import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { DownloadGrant } from '../lib/types';
import { useSession } from '../lib/session';
import { Icon } from '../ui/Icon';
import { Button, cx } from '../ui/primitives';
import { useToast } from '../ui/Toast';

/**
 * Getting the file.
 *
 * A guest downloads with no account, no interstitial and no wait: one click
 * exchanges the public token for a short-lived signed URL and hands it
 * straight to the browser, so the file streams from storage rather than
 * through the API. Only once the download is already moving does a suggestion
 * to make an account appear, and it can be dismissed and never blocks.
 */

type Phase = 'idle' | 'preparing' | 'started' | 'failed';

export function DownloadButton({
  token,
  version,
  label = 'Download free',
  size = 'lg',
  block,
  className,
  onDownloaded,
}: {
  token: string;
  /** Ask for a specific historical version instead of the current one. */
  version?: string;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  className?: string;
  onDownloaded?: () => void;
}) {
  const { user } = useSession();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>('idle');
  const [grant, setGrant] = useState<DownloadGrant | null>(null);
  const [suggest, setSuggest] = useState(false);
  const running = useRef(false);

  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setPhase('preparing');

    try {
      const path = `/download/${token}${version ? `?version=${encodeURIComponent(version)}` : ''}`;
      const result = await api.get<DownloadGrant>(path);
      setGrant(result);

      const anchor = document.createElement('a');
      anchor.href = result.url;
      anchor.download = result.filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      setPhase('started');
      onDownloaded?.();

      if (result.suggestAccount && !user) {
        // After the file is on its way, never before it.
        setTimeout(() => setSuggest(true), 900);
      }
      setTimeout(() => setPhase('idle'), 4000);
    } catch (err) {
      setPhase('failed');
      toast(
        err instanceof ApiError
          ? err.message
          : 'That download could not be prepared. Try again in a moment.',
        'error',
      );
      setTimeout(() => setPhase('idle'), 3000);
    } finally {
      running.current = false;
    }
  }, [token, version, user, toast, onDownloaded]);

  return (
    <div className={cx('flex flex-col gap-2.5', block && 'w-full', className)}>
      <Button
        variant={phase === 'failed' ? 'danger' : 'primary'}
        size={size}
        block={block}
        loading={phase === 'preparing'}
        icon={phase === 'started' ? 'check' : phase === 'failed' ? 'refresh' : 'download'}
        onClick={start}
      >
        {phase === 'preparing'
          ? 'Preparing…'
          : phase === 'started'
            ? 'Download started'
            : phase === 'failed'
              ? 'Try again'
              : label}
      </Button>

      {phase === 'started' && grant ? (
        <p className="font-mono text-[12px] text-positive" role="status">
          {grant.filename} / {grant.sizeLabel}
          {grant.version ? ` / v${grant.version}` : ''}
        </p>
      ) : null}

      {suggest ? (
        <div className="flex items-start gap-2.5 border-l-2 border-accent py-1 pl-4 animate-rise">
          <p className="flex-1 text-[13px] leading-relaxed text-text-2">
            Want your download history and a note when this is updated?{' '}
            <Link to="/register" className="underlined font-medium">
              Create a free account
            </Link>
            .
          </p>
          <button
            type="button"
            onClick={() => setSuggest(false)}
            aria-label="Dismiss"
            className="shrink-0 text-text-4 hover:text-text"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The phone's download bar. It slides in only once the real call to action has
 * scrolled off, so it is never competing with the button it stands in for.
 */
export function StickyDownload({
  token,
  title,
  sizeLabel,
  visible,
}: {
  token: string;
  title: string;
  sizeLabel: string | null;
  visible: boolean;
}) {
  return (
    <div
      aria-hidden={!visible}
      className={cx(
        'fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ground/95 px-4 py-3 backdrop-blur md:hidden',
        'pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-normal ease-out',
        visible ? 'translate-y-0' : 'translate-y-full',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{title}</p>
          <p className="text-[12px] text-text-3">Free{sizeLabel ? ` / ${sizeLabel}` : ''}</p>
        </div>
        <DownloadButton token={token} label="Download" size="md" className="shrink-0" />
      </div>
    </div>
  );
}
