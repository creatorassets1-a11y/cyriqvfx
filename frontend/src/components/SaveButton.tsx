import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, cx, useToast } from './ui';
import { Icon } from './Icon';

/**
 * Save / unsave (PRD §20). Optimistic, because the request is tiny and the
 * failure path simply puts the state back and says so.
 */
export function SaveButton({
  resourceId,
  initialSaved = false,
  compact,
  onChange,
}: {
  resourceId: string;
  initialSaved?: boolean;
  compact?: boolean;
  onChange?: (saved: boolean) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);

  const toggle = useCallback(async () => {
    if (!user) {
      toast('Sign in to save resources.', 'info', {
        label: 'Sign in',
        onClick: () => navigate('/login'),
      });
      return;
    }
    if (busy) return;

    const next = !saved;
    setSaved(next);
    setBusy(true);
    onChange?.(next);

    try {
      if (next) await api.put(`/me/saved/${resourceId}`);
      else await api.del(`/me/saved/${resourceId}`);
    } catch (err) {
      setSaved(!next);
      onChange?.(!next);
      toast(
        err instanceof ApiError ? err.message : 'That did not save. Try again.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }, [user, busy, saved, resourceId, toast, navigate, onChange]);

  if (compact) {
    return (
      // Sitting on top of a still, so it is a glyph with a shadow rather than
      // a control with a box around it.
      <button
        type="button"
        aria-label={saved ? 'Remove from saved' : 'Save this resource'}
        title={saved ? 'Remove from saved' : 'Save this resource'}
        aria-pressed={saved}
        onClick={(e) => {
          // The entry is a stretched link; this must not navigate.
          e.preventDefault();
          e.stopPropagation();
          void toggle();
        }}
        className={cx(
          'grid h-8 w-8 place-items-center drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]',
          'transition-transform duration-fast ease-spring active:scale-90',
          saved ? 'text-blue-light' : 'text-white hover:text-blue-light',
        )}
      >
        <Icon name={saved ? 'bookmark-filled' : 'bookmark'} size={17} />
      </button>
    );
  }

  return (
    <Button
      variant="secondary"
      icon={saved ? 'bookmark-filled' : 'bookmark'}
      onClick={toggle}
      aria-pressed={saved}
      className={saved ? 'border-blue text-blue' : undefined}
    >
      {saved ? 'Saved' : 'Save'}
    </Button>
  );
}
