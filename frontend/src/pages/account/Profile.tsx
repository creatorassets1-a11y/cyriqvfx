import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useFetch } from '../../lib/hooks';
import { Button, Dialog, Block, TextField, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { formatRelative } from '../../lib/format';

interface SessionRow {
  id: string;
  current: boolean;
  createdAt: string;
  lastUsedAt: string;
  userAgent: string | null;
}

/** Profile, password, sessions and account deletion (PRD §17, §63). */
export default function Profile() {
  const { user, refresh, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [savingName, setSavingName] = useState(false);

  const [passwords, setPasswords] = useState({ currentPassword: '', password: '', confirmPassword: '' });
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<ApiError | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const { data: sessions, reload: reloadSessions } = useFetch<{ items: SessionRow[] }>('/me/sessions');

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingName(true);
    try {
      await api.patch('/me/profile', { displayName });
      await refresh();
      toast('Profile updated.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not save.', 'error');
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPassword(true);
    setPasswordError(null);
    try {
      await api.post('/me/change-password', passwords);
      toast('Password updated. Other devices have been signed out.', 'success');
      setPasswords({ currentPassword: '', password: '', confirmPassword: '' });
      reloadSessions();
    } catch (err) {
      if (err instanceof ApiError) {
        setPasswordError(err);
        toast(err.message, 'error');
      }
    } finally {
      setSavingPassword(false);
    }
  };

  const resendVerification = async () => {
    try {
      const res = await api.post<{ message: string }>('/auth/resend-verification');
      toast(res.message, 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not send that.', 'error');
    }
  };

  const revoke = async (id: string) => {
    await api.del(`/me/sessions/${id}`).catch(() => {});
    reloadSessions();
    toast('That device has been signed out.', 'success');
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await api.post('/me/delete', { password: deletePassword, confirm: 'DELETE' });
      await logout();
      navigate('/');
      toast('Your account has been deleted.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <Block title="Profile">
        <form onSubmit={saveName} className="flex flex-col gap-4">
          <TextField
            label="Display name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">Email</span>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[14px] text-soft">{user?.email}</span>
              {user?.emailVerifiedAt ? (
                <span className="inline-flex items-center gap-1 text-[12.5px] text-go">
                  <Icon name="check" size={12} /> Confirmed
                </span>
              ) : (
                <Button size="sm" onClick={resendVerification} type="button">
                  Resend confirmation
                </Button>
              )}
            </div>
          </div>
          <div>
            <Button type="submit" variant="primary" loading={savingName}>Save profile</Button>
          </div>
        </form>
      </Block>

      <Block title="Password" description="Changing it signs out your other devices.">
        <form onSubmit={savePassword} className="flex flex-col gap-4">
          <TextField
            label="Current password"
            type="password"
            required
            autoComplete="current-password"
            value={passwords.currentPassword}
            onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))}
            error={passwordError?.fieldError('currentPassword')}
          />
          <TextField
            label="New password"
            type="password"
            required
            autoComplete="new-password"
            hint="At least 10 characters."
            value={passwords.password}
            onChange={(e) => setPasswords((p) => ({ ...p, password: e.target.value }))}
            error={passwordError?.fieldError('password')}
          />
          <TextField
            label="Confirm new password"
            type="password"
            required
            autoComplete="new-password"
            value={passwords.confirmPassword}
            onChange={(e) => setPasswords((p) => ({ ...p, confirmPassword: e.target.value }))}
            error={passwordError?.fieldError('confirmPassword')}
          />
          <div>
            <Button type="submit" variant="primary" loading={savingPassword}>Change password</Button>
          </div>
        </form>
      </Block>

      {sessions && sessions.items.length > 0 ? (
        <Block title="Signed-in devices">
          <ul className="flex flex-col divide-y divide-[color:var(--rule)]">
            {sessions.items.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <Icon name="shield" size={16} className="shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px]">
                    {s.userAgent ?? 'Unknown device'}
                    {s.current ? <span className="ml-2 text-[12px] text-go">This device</span> : null}
                  </p>
                  <p className="text-[12px] text-faint">Last used {formatRelative(s.lastUsedAt)}</p>
                </div>
                {!s.current ? (
                  <Button size="sm" onClick={() => revoke(s.id)}>Sign out</Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <Block title="Delete account" description="This removes your history, saved items and preferences. It cannot be undone.">
        <Button variant="danger" icon="trash" onClick={() => setDeleteOpen(true)}>
          Delete my account
        </Button>
      </Block>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete your account?"
        description="Your download history, saved resources and preferences will be permanently removed. This cannot be undone."
        footer={
          <>
            <Button onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={deleteAccount}
              loading={deleting}
              disabled={!deletePassword}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <TextField
          label="Confirm with your password"
          type="password"
          autoComplete="current-password"
          value={deletePassword}
          onChange={(e) => setDeletePassword(e.target.value)}
          data-autofocus
        />
      </Dialog>
    </div>
  );
}
