import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import type { Session, User } from '../../lib/types';
import { formatRelative } from '../../lib/format';
import { Confirm } from '../../ui/Dialog';
import { Button, Field, Input, Marker, Note } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';

/**
 * The account itself: the name, the password, the devices signed in, and the
 * way out. Deleting is real deletion, and the page says exactly what survives
 * it before anyone confirms.
 */
export default function Profile() {
  const { user, emailVerified, refresh, signOut } = useSession();
  const { toast } = useToast();
  const navigate = useNavigate();

  useTitle('Profile · Cyriq VFX');

  return (
    <div className="max-w-xl">
      <header className="mb-8">
        <h1 className="text-[30px]">Profile</h1>
        <p className="mt-1.5 text-[13.5px] text-text-3">
          {user?.email}
          {emailVerified ? null : ' · not confirmed'}
        </p>
      </header>

      {emailVerified ? null : <ConfirmEmailPrompt />}

      <DisplayNameForm current={user?.displayName ?? ''} onSaved={refresh} />

      <PasswordForm />

      <SessionList />

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[20px]">Delete this account</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-text-2">
          Your saved resources, history, notifications and preferences are deleted with it. Anything
          you have already downloaded is yours to keep, and the site stays free to use without an
          account.
        </p>
        <div className="mt-4">
          <DeleteAccount
            onDeleted={async () => {
              await signOut();
              toast('Your account has been deleted.', 'success');
              navigate('/');
            }}
          />
        </div>
      </section>
    </div>
  );
}

function ConfirmEmailPrompt() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  return (
    <div className="mb-8">
      <Note tone="caution">
        Your email address is not confirmed, so email notifications and password resets are off.
      </Note>
      <Button
        size="sm"
        className="mt-3"
        loading={busy}
        disabled={sent}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await api.post<{ message: string }>('/auth/resend-verification');
            toast(result.message, 'success');
            setSent(true);
          } catch (err) {
            toast(err instanceof ApiError ? err.message : 'That could not be sent.', 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        {sent ? 'Confirmation sent' : 'Send a confirmation email'}
      </Button>
    </div>
  );
}

function DisplayNameForm({ current, onSaved }: { current: string; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);

  useEffect(() => setDisplayName(current), [current]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);

    try {
      await api.patch<{ user: User }>('/me/profile', { displayName });
      setSaved(true);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-line pt-6">
      <h2 className="mb-4 text-[20px]">Display name</h2>

      <Field label="Display name" error={failure?.on('displayName')}>
        {(props) => (
          <Input
            {...props}
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setSaved(false);
            }}
          />
        )}
      </Field>

      <div className="mt-4 flex items-center gap-4">
        <Button type="submit" loading={busy}>
          Save name
        </Button>
        {saved ? (
          <p role="status" className="text-[13px] text-positive">
            Name updated.
          </p>
        ) : null}
      </div>
    </form>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);

    try {
      await api.post('/me/change-password', { currentPassword, password, confirmPassword });
      setCurrentPassword('');
      setPassword('');
      setConfirmPassword('');
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-12 border-t border-line pt-6">
      <h2 className="mb-4 text-[20px]">Change password</h2>

      <div className="flex flex-col gap-4">
        <Field label="Current password" error={failure?.on('currentPassword')}>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          )}
        </Field>

        <Field label="New password" hint="At least 10 characters." error={failure?.on('password')}>
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
      </div>

      {failure && failure.issues.length === 0 ? (
        <div className="mt-4">
          <Note tone="critical">{failure.message}</Note>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-4">
        <Button type="submit" loading={busy}>
          Change password
        </Button>
        {done ? (
          <p role="status" className="text-[13px] text-positive">
            Password changed.
          </p>
        ) : null}
      </div>
    </form>
  );
}

function SessionList() {
  const { data, reload } = useLoad<{ items: Session[] }>('/me/sessions');
  const { toast } = useToast();

  async function end(session: Session) {
    try {
      await api.delete(`/me/sessions/${session.id}`);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That could not be ended.', 'error');
    }
  }

  return (
    <section className="mt-12 border-t border-line pt-6">
      <h2 className="mb-4 text-[20px]">Where you are signed in</h2>

      <ul className="flex flex-col">
        {(data?.items ?? []).map((session) => (
          <li
            key={session.id}
            className="flex items-center gap-4 border-b border-line py-3 first:border-t"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] text-text-2">
                {session.userAgent ?? 'Unknown device'}
              </p>
              <p className="font-mono text-[11.5px] text-text-4">
                last used {formatRelative(session.lastUsedAt)}
              </p>
            </div>
            {session.current ? (
              <Marker tone="accent">This device</Marker>
            ) : (
              <Button size="sm" onClick={() => end(session)}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);

  async function remove() {
    setBusy(true);
    setFailure(null);

    try {
      await api.post('/me/delete', { password, confirm: 'DELETE' });
      setOpen(false);
      onDeleted();
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Field label="Your password" hint="Confirms it is really you." error={failure?.on('password')}>
        {(props) => (
          <Input
            {...props}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="max-w-xs"
          />
        )}
      </Field>

      {failure && failure.issues.length === 0 ? (
        <div className="mt-3">
          <Note tone="critical">{failure.message}</Note>
        </div>
      ) : null}

      <Button variant="danger" className="mt-4" disabled={!password} onClick={() => setOpen(true)}>
        Delete my account
      </Button>

      <Confirm
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={remove}
        busy={busy}
        title="Delete your account?"
        body="This removes your history, saved resources, notifications and preferences. It cannot be undone."
        confirmLabel="Delete my account"
      />
    </>
  );
}
