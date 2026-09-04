import { useCopy } from '../lib/hooks';
import { Icon } from '../ui/Icon';
import { Menu, MenuButton, MenuHeading, MenuRule } from '../ui/Menu';
import { useToast } from '../ui/Toast';

/**
 * Sharing.
 *
 * Two links, and they are different things: the page, which is what someone
 * shares in a conversation, and the permanent download link, which downloads
 * the current version for whoever opens it, forever, without an account. The
 * device's own share sheet is used when it exists, because it is better than
 * anything this page could draw.
 */

export function ShareMenu({
  title,
  path,
  downloadToken,
}: {
  title: string;
  path: string;
  downloadToken?: string;
}) {
  const { toast } = useToast();
  const [, copy] = useCopy();

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const pageUrl = `${origin}${path}`;
  const downloadUrl = downloadToken ? `${origin}/download/${downloadToken}` : null;

  async function copyTo(url: string, what: string) {
    const ok = await copy(url);
    toast(ok ? `${what} copied.` : 'That could not be copied.', ok ? 'success' : 'error');
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <Menu
      label="Share"
      trigger={() => (
        <span className="flex h-10 items-center gap-2 rounded border border-line-strong px-3.5 text-[14px] font-semibold">
          <Icon name="share" size={15} />
          Share
        </span>
      )}
      width="w-64"
    >
      {({ close }) => (
        <>
          <MenuHeading>{title}</MenuHeading>
          {canShare ? (
            <MenuButton
              icon="share"
              onSelect={() => {
                close();
                navigator.share({ title, url: pageUrl }).catch(() => {});
              }}
            >
              Share…
            </MenuButton>
          ) : null}
          <MenuButton
            icon="link"
            onSelect={() => {
              close();
              void copyTo(pageUrl, 'Page link');
            }}
          >
            Copy page link
          </MenuButton>
          {downloadUrl ? (
            <>
              <MenuRule />
              <MenuButton
                icon="download"
                onSelect={() => {
                  close();
                  void copyTo(downloadUrl, 'Download link');
                }}
              >
                Copy download link
              </MenuButton>
              <MenuHeading>Downloads the current version, no account needed.</MenuHeading>
            </>
          ) : null}
        </>
      )}
    </Menu>
  );
}
