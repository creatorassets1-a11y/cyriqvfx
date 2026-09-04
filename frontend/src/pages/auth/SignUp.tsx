import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useTitle } from '../../lib/hooks';
import { Button, Field, Input, Note } from '../../ui/primitives';
import { AuthShell } from './AuthShell';

/**
 * Creating an account.
 *
 * The server owns the rules, so its messages are shown against the fields it
 * named rather than being duplicated (and eventually contradicted) here. The
 * only thing this form decides is that everything is filled in.
 */
export default function SignUp() {
  const { user, signUp } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useTitle('Create an account · Cyriq VFX');

  if (user) return <Navigate to={from ?? '/account'} replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);

    try {
      await signUp({ email, username, password, confirmPassword });
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
      title="Create a free account"
      subtitle="Keep your download history, save resources and hear when they are updated. Downloading itself never needs one."
      footer={
        <>
          Already have one?{' '}
          <Link to="/login" className="underlined">
            Sign in
          </Link>
          .
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Email" error={failure?.on('email')}>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Username"
          hint="Letters, numbers and underscores."
          error={failure?.on('username')}
        >
          {(props) => (
            <Input
              {...props}
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          )}
        </Field>

        <Field label="Password" hint="At least 10 characters." error={failure?.on('password')}>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>

        <Field label="Confirm password" error={failure?.on('confirmPassword')}>
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
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
