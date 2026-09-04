import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useTitle } from '../../lib/hooks';
import { Button, Field, Input, Note } from '../../ui/primitives';
import { AuthShell } from './AuthShell';

/**
 * Asking for a reset link.
 *
 * The confirmation is the same whether or not that address has an account, so
 * this form cannot be used to find out who is registered here.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useTitle('Reset your password · Cyriq VFX');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);

    try {
      const result = await api.post<{ message: string }>('/auth/forgot-password', { email });
      setMessage(result.message);
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will send a link that lets you set a new one."
      footer={
        <>
          Remembered it?{' '}
          <Link to="/login" className="underlined">
            Sign in
          </Link>
          .
        </>
      }
    >
      {message ? (
        <Note tone="positive">{message}</Note>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="Email" error={failure?.on('email')}>
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>

          {failure && failure.issues.length === 0 ? (
            <Note tone="critical">{failure.message}</Note>
          ) : null}

          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Send the link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
