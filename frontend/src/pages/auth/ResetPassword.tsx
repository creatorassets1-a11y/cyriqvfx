import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useTitle } from '../../lib/hooks';
import { Button, Field, Input, Note } from '../../ui/primitives';
import { AuthShell } from './AuthShell';

/** Setting a new password from an emailed link. */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useTitle('Set a new password · Cyriq VFX');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);

    try {
      await api.post('/auth/reset-password', { token, password, confirmPassword });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthShell title="That link is incomplete">
        <Note tone="critical">
          The reset link is missing its token. Ask for a new one and open it directly from the
          email.
        </Note>
        <Link to="/forgot-password" className="underlined mt-5 inline-block text-[13.5px]">
          Send a new link
        </Link>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Your password is changed">
        <Note tone="positive">Sign in with your new password.</Note>
        <Link to="/login" className="underlined mt-5 inline-block text-[13.5px]">
          Go to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="New password" hint="At least 10 characters." error={failure?.on('password')}>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>

        <Field label="Confirm new password" error={failure?.on('confirmPassword')}>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          )}
        </Field>

        {failure && failure.issues.length === 0 ? (
          <Note tone="critical">{failure.message}</Note>
        ) : null}

        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Change my password
        </Button>
      </form>
    </AuthShell>
  );
}
