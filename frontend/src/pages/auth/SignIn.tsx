import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useTitle } from '../../lib/hooks';
import { Button, Field, Input, Note } from '../../ui/primitives';
import { AuthShell } from './AuthShell';

/**
 * Signing in.
 *
 * The failure message is deliberately the same whether the account exists or
 * the password is wrong, because a login form that distinguishes them tells a
 * stranger which email addresses have accounts here.
 */
export default function SignIn() {
  const { user, signIn } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useTitle('Sign in · Cyriq VFX');

  if (user) return <Navigate to={from ?? '/account'} replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);

    try {
      await signIn(identifier, password);
      navigate(from ?? '/account', { replace: true });
    } catch (err) {
      setFailure(
        err instanceof ApiError ? err : new ApiError(0, 'error', 'That did not work. Try again.'),
      );
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in for your download history, saved resources and update alerts."
      footer={
        <>
          No account yet?{' '}
          <Link to="/register" className="underlined">
            Create one
          </Link>
          .
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Email or username" error={failure?.on('identifier')}>
          {(props) => (
            <Input
              {...props}
              autoComplete="username"
              autoFocus
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          )}
        </Field>

        <Field label="Password" error={failure?.on('password')}>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>

        {failure && failure.issues.length === 0 ? (
          <Note tone="critical">{failure.message}</Note>
        ) : null}

        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Sign in
        </Button>

        <Link to="/forgot-password" className="self-start text-[13px] text-text-3 hover:text-text">
          Forgotten your password?
        </Link>
      </form>
    </AuthShell>
  );
}
