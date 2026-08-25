import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useTitle } from '../../lib/hooks';
import { Button, TextField, useToast } from '../../components/ui';
import { AuthShell } from './AuthShell';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  useTitle('Choose a new password · Cyriq VFX');

  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password, confirmPassword });
      toast('Password changed. Sign in with it now.', 'success');
      navigate('/login', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title="That link is incomplete">
        <p className="text-[14px] leading-relaxed text-soft">
          This reset link is missing its token. Request a new one.
        </p>
        <div className="mt-4">
          <Link to="/forgot-password" className="link text-[14px]">
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="This signs out every other device.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && !error.issues.length ? (
          <p role="alert" className="border-l-2 border-[color:var(--stop)] py-1 pl-4 text-[13px] text-stop">
            {error.message}
          </p>
        ) : null}
        <TextField
          label="New password"
          type="password"
          required
          autoFocus
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="At least 10 characters."
          error={error?.fieldError('password')}
        />
        <TextField
          label="Confirm new password"
          type="password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={error?.fieldError('confirmPassword')}
        />
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
          Change password
        </Button>
      </form>
    </AuthShell>
  );
}
