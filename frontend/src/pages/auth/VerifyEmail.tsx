import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTitle } from '../../lib/hooks';
import { Icon } from '../../components/Icon';
import { AuthShell } from './AuthShell';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('');
  useTitle('Confirm your email · Cyriq VFX');

  const token = params.get('token');

  useEffect(() => {
    if (!token) {
      setState('failed');
      setMessage('This confirmation link is missing its token.');
      return;
    }
    api
      .post('/auth/verify-email', { token })
      .then(async () => {
        setState('done');
        await refresh();
      })
      .catch((err) => {
        setState('failed');
        setMessage(
          err instanceof ApiError ? err.message : 'That confirmation link could not be used.',
        );
      });
  }, [token, refresh]);

  return (
    <AuthShell title={state === 'done' ? 'Email confirmed' : 'Confirming your email'}>
      <div className="flex flex-col items-start gap-3">
        {state === 'working' ? (
          <>
            <Icon name="spinner" size={22} className="text-blue" />
            <p className="text-[14px] text-soft">One moment.</p>
          </>
        ) : state === 'done' ? (
          <>
            <Icon name="check" size={22} className="text-go" />
            <p className="text-[14px] leading-relaxed text-soft">
              Your email is confirmed. Email notifications can now be turned on in preferences.
            </p>
            <Link to="/account/preferences" className="link text-[14px]">
              Open preferences
            </Link>
          </>
        ) : (
          <>
            <Icon name="alert" size={22} className="text-stop" />
            <p className="text-[14px] leading-relaxed text-soft">{message}</p>
            <Link to="/account" className="link text-[14px]">
              Go to your account
            </Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}
