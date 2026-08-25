import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTitle } from '../../lib/hooks';
import { Button, TextField } from '../../components/ui';
import { AuthShell } from './AuthShell';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  useTitle('Sign in · Cyriq VFX');

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? '/account';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identifier, password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in for your download history, saved resources and update alerts."
      footer={
        <>
          No account yet?{' '}
          <Link to="/register" className="link font-medium">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* A failed sign-in is announced, not just coloured red. */}
        {error && !error.issues.length ? (
          <p role="alert" className="border-l-2 border-[color:var(--stop)] py-1 pl-4 text-[13px] text-stop">
            {error.message}
          </p>
        ) : null}

        <TextField
          label="Email or username"
          required
          autoComplete="username"
          autoFocus
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          error={error?.fieldError('identifier')}
        />

        <div>
          <TextField
            label="Password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error?.fieldError('password')}
          />
          <div className="mt-2 text-right">
            <Link to="/forgot-password" className="text-[13px] text-blue hover:underline">
              Forgot your password?
            </Link>
          </div>
        </div>

        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
