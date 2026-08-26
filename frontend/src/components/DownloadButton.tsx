import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type DownloadGrant } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, useToast, cx } from './ui';
import { Icon } from './Icon';

/**
 * Download flow (PRD §15, §16).
 *
 * Guests download without any account. The button moves through
 * idle → preparing → downloading → done, and only after the file has started
 * does a non-blocking suggestion appear. Nothing ever interrupts the download.
 */

type Phase = 'idle' | 'preparing' | 'started' | 'error';

interface Props {
  token: string;
  /** Download a specific historical version instead of the current one. */
  version?: string;
  label?: string;
  size?: 'md' | 'lg';
  fullWidth?: boolean;
  className?: string;
  onDownloaded?: () => void;
}

export function DownloadButton({
  token,
  version,
  label = 'Download free',
  size = 'lg',
  fullWidth,
  className,
  onDownloaded,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>('idle');
  const [grant, setGrant] = useState<DownloadGrant | null>(null);
  const [showNudge, setShowNudge] = useState(false);
  const inFlight = useRef(false);

  const start = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase('preparing');

    try {
      const query = version ? `?version=${encodeURIComponent(version)}` : '';
      const result = await api.get<DownloadGrant>(`/download/${token}${query}`);
      setGrant(result);

      // Hand the signed URL to the browser. It streams straight from storage, so
      // the API process is not in the file's path.
      const anchor = document.createElement('a');
      anchor.href = result.url;
      anchor.download = result.filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      setPhase('started');
      onDownloaded?.();

      // The suggestion appears after the file is already on its way.
      if (result.suggestAccount && !user) {
        setTimeout(() => setShowNudge(true), 1200);
      }
      setTimeout(() => setPhase('idle'), 4000);
    } catch (err) {
      setPhase('error');
      const message =
        err instanceof ApiError
          ? err.message
          : 'That download could not be prepared. Try again in a moment.';
      toast(message, 'error');
      setTimeout(() => setPhase('idle'), 3000);
    } finally {
      inFlight.current = false;
    }
  }, [token, version, user, toast, onDownloaded]);

  const content =
    phase === 'preparing'
      ? 'Preparing…'
      : phase === 'started'
        ? 'Download started'
        : phase === 'error'
          ? 'Try again'
          : label;

  return (
    <div className={cx('flex flex-col gap-2', fullWidth && 'w-full', className)}>
      <Button
        variant={phase === 'error' ? 'danger' : 'primary'}
        size={size}
        fullWidth={fullWidth}
        onClick={start}
        loading={phase === 'preparing'}
        icon={phase === 'started' ? 'check' : phase === 'error' ? 'refresh' : 'download'}
      >
        {content}
      </Button>

      {phase === 'started' && grant ? (
        <p className="text-[12.5px] text-go" role="status">
          {grant.filename} / {grant.sizeLabel}
          {grant.version ? ` / v${grant.version}` : ''}
        </p>
      ) : null}

      {showNudge ? (
        <div className="flex items-start gap-2.5 border-l-2 border-blue py-1 pl-4 animate-rise-in">
          <p className="flex-1 text-[13px] leading-relaxed text-soft">
            Want your download history and update alerts?{' '}
            <Link to="/register" className="link font-medium">
              Create a free account
            </Link>
            .
          </p>
          <button
            onClick={() => setShowNudge(false)}
            aria-label="Dismiss"
            className="shrink-0 text-faint hover:text-ink"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact sticky download bar for mobile (PRD §84). It only appears once the
 * primary CTA has scrolled away, and sits above the safe area.
 */
export function StickyDownloadBar({
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
      className={cx(
        'fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-paper/95 backdrop-blur md:hidden',
        'px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        'transition-transform duration-normal ease-out',
        visible ? 'translate-y-0' : 'translate-y-full',
      )}
      aria-hidden={!visible}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{title}</p>
          <p className="text-[12px] text-faint">
            Free{sizeLabel ? ` / ${sizeLabel}` : ''}
          </p>
        </div>
        <DownloadButton token={token} label="Download" size="md" className="shrink-0" />
      </div>
    </div>
  );
}
