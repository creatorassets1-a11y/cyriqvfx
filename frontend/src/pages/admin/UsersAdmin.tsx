import { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useDebounced, useFetch } from '../../lib/hooks';
import { Marker, Button, ConfirmDialog, EmptyState, Skeleton, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { formatDate } from '../../lib/format';

interface UserRow {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
  verified: boolean;
  createdAt: string;
  suspendedReason: string | null;
  downloadCount: number;
  savedCount: number;
}

/** User management (PRD §46). No passwords or tokens are ever shown. */
export default function UsersAdmin() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'SUSPENDED'>('ACTIVE');
  const debounced = useDebounced(search, 300);
  const [confirm, setConfirm] = useState<{ user: UserRow; action: 'suspend' | 'unsuspend' | 'delete' } | null>(null);
  const [busy, setBusy] = useState(false);

  const query = new URLSearchParams({ status });
  if (debounced) query.set('q', debounced);
  const { data, loading, reload } = useFetch<{ items: UserRow[]; total: number }>(
    `/admin/users?${query}`,
    [debounced, status],
  );

  const act = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.action === 'delete') {
        await api.del(`/admin/users/${confirm.user.id}`);
        toast('User deleted.', 'success');
      } else {
        await api.post(`/admin/users/${confirm.user.id}/suspension`, {
          suspended: confirm.action === 'suspend',
        });
        toast(confirm.action === 'suspend' ? 'User suspended.' : 'User restored.', 'success');
      }
      setConfirm(null);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[30px] leading-tight md:text-[34px]">Users</h1>

      <div className="flex flex-wrap items-center gap-2">
        {(['ACTIVE', 'SUSPENDED'] as const).map((s) => (
          <Button key={s} size="sm" variant={status === s ? 'primary' : 'quiet'} onClick={() => setStatus(s)}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </Button>
        ))}
        <div className="relative ml-auto min-w-0 flex-1 sm:max-w-xs">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <label htmlFor="user-search" className="sr-only">Search users</label>
          <input
            id="user-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full min-w-0 border-0 border-b border-rule-strong bg-transparent px-0 py-1.5 text-[14px] text-ink rounded-none transition-colors duration-fast hover:border-ink focus:border-blue focus:outline-none focus:ring-0 placeholder:text-ghost focus:border-blue focus:outline-none"
          />
        </div>
      </div>

      {loading && !data ? (
        <Skeleton className="h-80" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon="users" title="No users here" description={debounced ? 'Nothing matched that search.' : 'Registered users appear here.'} />
      ) : (
        <div className="border-t border-rule">
          <ul>
            {data.items.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 border-b border-rule py-3.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sunk text-[13px] font-bold uppercase text-blue">
                  {u.displayName[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                    {u.displayName}
                    <span className="text-[12.5px] text-faint">@{u.username}</span>
                    {u.role === 'ADMIN' ? <Marker tone="blue">Owner</Marker> : null}
                    {!u.verified ? <Marker tone="warn">Unconfirmed</Marker> : null}
                    {u.status === 'SUSPENDED' ? <Marker tone="stop">Suspended</Marker> : null}
                  </p>
                  <p className="truncate text-[12px] text-faint">
                    {u.email} · joined {formatDate(u.createdAt)} · {u.downloadCount} downloads · {u.savedCount} saved
                  </p>
                </div>
                {u.role !== 'ADMIN' ? (
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      onClick={() => setConfirm({ user: u, action: u.status === 'SUSPENDED' ? 'unsuspend' : 'suspend' })}
                    >
                      {u.status === 'SUSPENDED' ? 'Restore' : 'Suspend'}
                    </Button>
                    <Button size="sm" variant="quiet" icon="trash" onClick={() => setConfirm({ user: u, action: 'delete' })}>
                      Delete
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={act}
        title={
          confirm?.action === 'delete' ? `Delete ${confirm.user.displayName}?`
          : confirm?.action === 'suspend' ? `Suspend ${confirm?.user.displayName}?`
          : `Restore ${confirm?.user.displayName}?`
        }
        description={
          confirm?.action === 'delete'
            ? 'Their account, saved items and notifications are removed. Download counts stay accurate. This cannot be undone.'
            : confirm?.action === 'suspend'
              ? 'They are signed out immediately and cannot sign back in until restored.'
              : 'They will be able to sign in again.'
        }
        confirmLabel={confirm?.action === 'delete' ? 'Delete' : confirm?.action === 'suspend' ? 'Suspend' : 'Restore'}
        destructive={confirm?.action !== 'unsuspend'}
        loading={busy}
      />
    </div>
  );
}
