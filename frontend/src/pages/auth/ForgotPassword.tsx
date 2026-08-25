import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useTitle } from '../../lib/hooks';
import { Button, TextField } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { AuthShell } from './AuthShell';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  useTitle('Reset your password · Cyriq VFX');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError) setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your inbox">
        <div className="flex flex-col items-start gap-3">
          <Icon name="check" size={22} className="text-go" />
          <p className="text-[14px] leading-relaxed text-soft">
            If that email has an account, a reset link is on its way. It expires in an hour.
          </p>
          <Link to="/login" className="link text-[14px]">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we will send you a link."
      footer={
        <Link to="/login" className="link font-medium">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error?.fieldError('email')}
        />
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
          Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}
