import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTitle } from '../../lib/hooks';
import { Button, TextField } from '../../components/ui';
import { AuthShell } from './AuthShell';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  useTitle('Create an account · Cyriq VFX');

  const [form, setForm] = useState({
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form);
      navigate('/account', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create a free account"
      subtitle="Keep your download history, save resources and get told when they are updated."
      footer={
        <>
          Already have one?{' '}
          <Link to="/login" className="link font-medium">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && !error.issues.length ? (
          <p role="alert" className="border-l-2 border-[color:var(--stop)] py-1 pl-4 text-[13px] text-stop">
            {error.message}
          </p>
        ) : null}

        <TextField
          label="Email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={form.email}
          onChange={set('email')}
          error={error?.fieldError('email')}
        />
        <TextField
          label="Username"
          required
          autoComplete="username"
          value={form.username}
          onChange={set('username')}
          hint="Letters, numbers and underscores."
          error={error?.fieldError('username')}
        />
        <TextField
          label="Password"
          type="password"
          required
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          hint="At least 10 characters."
          error={error?.fieldError('password')}
        />
        <TextField
          label="Confirm password"
          type="password"
          required
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={set('confirmPassword')}
          error={error?.fieldError('confirmPassword')}
        />

        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
