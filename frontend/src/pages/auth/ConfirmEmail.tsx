import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useTitle } from '../../lib/hooks';
import { Note, Spinner } from '../../ui/primitives';
import { AuthShell } from './AuthShell';

/**
 * Confirming an email address. The link is followed once, on arrival, and the
 * session is refreshed so anything gated on a confirmed address unlocks in
 * place rather than after a reload.
 */
export default function ConfirmEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { refresh } = useSession();

  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed');
  const [message, setMessage] = useState(
    token ? '' : 'That confirmation link is missing its token.',
  );

  useTitle('Confirm your email · Cyriq VFX');

  useEffect(() => {
    if (!token) return;
    let live = true;

    api
      .post<{ message: string }>('/auth/verify-email', { token })
      .then(async (result) => {
        if (!live) return;
        setMessage(result.message);
        setState('done');
        await refresh();
      })
      .catch((err: unknown) => {
        if (!live) return;
        setMessage(
          err instanceof ApiError ? err.message : 'That confirmation link could not be used.',
        );
        setState('failed');
      });

    return () => {
      live = false;
    };
  }, [token, refresh]);

  return (
    <AuthShell title="Confirm your email">
      {state === 'working' ? (
        <p className="flex items-center gap-2.5 text-[14px] text-text-2">
          <Spinner />
          Checking that link…
        </p>
      ) : state === 'done' ? (
        <>
          <Note tone="positive">{message}</Note>
          <Link to="/account/preferences" className="underlined mt-5 inline-block text-[13.5px]">
            Turn on email notifications
          </Link>
        </>
      ) : (
        <>
          <Note tone="critical">{message}</Note>
          <Link to="/account/profile" className="underlined mt-5 inline-block text-[13.5px]">
            Send a new confirmation
          </Link>
        </>
      )}
    </AuthShell>
  );
}
