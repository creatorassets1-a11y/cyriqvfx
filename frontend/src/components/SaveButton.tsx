import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { Icon } from '../ui/Icon';
import { Button, cx } from '../ui/primitives';
import { useToast } from '../ui/Toast';

/**
 * Saving a resource for later.
 *
 * Saving is the one thing on a resource page that needs an account, so a guest
 * who presses it is sent to sign in with their way back remembered, rather
 * than being told no. The state flips immediately and rolls back if the
 * request fails, because a control that lies is worse than a slow one.
 */

export function SaveButton({
  resourceId,
  title,
  saved: initial,
  compact,
  onChange,
}: {
  resourceId: string;
  title: string;
  saved: boolean;
  /** Icon-only, for a corner of a card. It names the resource it saves. */
  compact?: boolean;
  onChange?: (saved: boolean) => void;
}) {
  const { user } = useSession();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!user) {
      navigate('/login', { state: { from: window.location.pathname } });
      return;
    }

    const next = !saved;
    setSaved(next);
    setBusy(true);

    try {
      if (next) await api.put(`/me/saved/${resourceId}`);
      else await api.delete(`/me/saved/${resourceId}`);
      onChange?.(next);
    } catch (err) {
      setSaved(!next);
      toast(err instanceof ApiError ? err.message : 'That could not be saved.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-label={saved ? `Remove ${title} from saved` : `Save ${title}`}
        aria-pressed={saved}
        className={cx(
          'flex h-8 w-8 items-center justify-center rounded-full border bg-ground/80 backdrop-blur transition-colors duration-fast ease-out',
          saved ? 'border-accent text-accent' : 'border-line-strong text-text-2 hover:text-text',
        )}
      >
        <Icon name="bookmark" size={15} />
      </button>
    );
  }

  return (
    <Button
      onClick={toggle}
      disabled={busy}
      aria-pressed={saved}
      icon="bookmark"
      className={cx(saved && 'border-accent text-accent')}
    >
      {saved ? 'Saved' : 'Save'}
    </Button>
  );
}
