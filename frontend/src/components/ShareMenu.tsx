import { useCallback, useState } from 'react';
import { useCopy, useDismissable } from '../lib/hooks';
import { Button, cx, useToast } from './ui';
import { Icon } from './Icon';

/**
 * Sharing (PRD §30). Two distinct actions, because they mean different things:
 * the resource link is the page, the download link is the permanent, public,
 * shareable file URL the owner asked for.
 */
export function ShareMenu({
  title,
  resourcePath,
  downloadToken,
}: {
  title: string;
  resourcePath: string;
  downloadToken?: string;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [, copy] = useCopy();
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const resourceUrl = `${origin}${resourcePath}`;
  const downloadUrl = downloadToken ? `${origin}/download/${downloadToken}` : null;

  const copyTo = useCallback(
    async (url: string, what: string) => {
      const ok = await copy(url);
      toast(ok ? `${what} copied` : 'Could not copy. Select the link and copy it manually.', ok ? 'success' : 'error');
      setOpen(false);
    },
    [copy, toast],
  );

  const nativeShare = useCallback(async () => {
    try {
      await navigator.share({ title, url: resourceUrl });
      setOpen(false);
    } catch (err) {
      // A cancelled share is not a failure worth reporting.
      if ((err as Error)?.name !== 'AbortError') {
        void copyTo(resourceUrl, 'Link');
      }
    }
  }, [title, resourceUrl, copyTo]);

  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  return (
    <div className="relative" ref={ref}>
      <Button
        icon="share"
        onClick={() => (canNativeShare ? void nativeShare() : setOpen((o) => !o))}
        aria-expanded={canNativeShare ? undefined : open}
        aria-haspopup={canNativeShare ? undefined : 'menu'}
      >
        Share
      </Button>

      {open ? (
        <div
          role="menu"
          className={cx(
            'absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded',
            'bg-lift shadow-high ring-1 ring-rule animate-pop-in',
          )}
        >
          <MenuItem icon="link" onClick={() => copyTo(resourceUrl, 'Resource link')}>
            Copy resource link
          </MenuItem>
          {downloadUrl ? (
            <MenuItem icon="download" onClick={() => copyTo(downloadUrl, 'Download link')}>
              Copy download link
            </MenuItem>
          ) : null}
          <div className="border-t border-rule">
            <MenuItem
              icon="external"
              onClick={() => {
                window.open(
                  `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(resourceUrl)}`,
                  '_blank',
                  'noopener,noreferrer',
                );
                setOpen(false);
              }}
            >
              Share on X
            </MenuItem>
            <MenuItem
              icon="external"
              onClick={() => {
                window.open(
                  `https://reddit.com/submit?url=${encodeURIComponent(resourceUrl)}&title=${encodeURIComponent(title)}`,
                  '_blank',
                  'noopener,noreferrer',
                );
                setOpen(false);
              }}
            >
              Share on Reddit
            </MenuItem>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
}: {
  icon: 'link' | 'download' | 'external';
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13.5px] text-soft transition-colors duration-fast hover:bg-sunk hover:text-ink"
    >
      <Icon name={icon} size={15} />
      {children}
    </button>
  );
}
