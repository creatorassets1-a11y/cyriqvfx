import { useState } from 'react';
import { api, ApiError, query } from '../../lib/api';
import { useDebounced, useLoad, useTitle } from '../../lib/hooks';
import { formatDate, formatExact } from '../../lib/format';
import { PageError } from '../../components/Chrome';
import { Confirm } from '../../ui/Dialog';
import { Button, Empty, Input, Marker, Note, Pagination, Skeleton, cx } from '../../ui/primitives';

/**
 * Accounts.
 *
 * There is very little to do here on purpose: an account exists so someone can
 * keep their history, so the only moderation this product needs is suspending
 * an account that is abusing the site, and deleting one on request.
 */

interface UserRow {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: 'USER' | 'ADMIN';
  status: string;
  verified: boolean;
  createdAt: string;
  suspendedReason: string | null;
  downloadCount: number;
  savedCount: number;
}

export default function UsersAdmin() {
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'SUSPENDED'>('ACTIVE');
  const [page, setPage] = useState(1);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<UserRow | null>(null);
  const search = useDebounced(term, 250);

  const { data, error, loading, reload } = useLoad<{
    items: UserRow[];
    total: number;
    page: number;
    totalPages: number;
  }>(`/admin/users${query({ q: search, status, page: page > 1 ? page : undefined })}`);

  useTitle('Users · Owner tools');

  async function suspend(user: UserRow, suspended: boolean) {
    setFailure(null);
    try {
      await api.post(`/admin/users/${user.id}/suspension`, { suspended });
      reload();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'That did not work.');
    }
  }

  async function remove() {
    if (!pending) return;
    setFailure(null);

    try {
      await api.delete(`/admin/users/${pending.id}`);
      setPending(null);
      reload();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.message : 'That account could not be deleted.');
      setPending(null);
    }
  }

  if (error) return <PageError onRetry={reload} />;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px]">Users</h1>
          <p className="mt-1.5 text-[13.5px] text-text-3">
            {data ? `${formatExact(data.total)} ${status.toLowerCase()}` : 'Loading…'}
          </p>
        </div>

        <div className="w-full sm:w-64">
          <label htmlFor="admin-user-search" className="sr-only">
            Search users
          </label>
          <Input
            id="admin-user-search"
            type="search"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
            placeholder="Search by name or email"
          />
        </div>
      </header>

      <div className="mb-5 flex items-center gap-5 border-y border-line py-3">
        {(['ACTIVE', 'SUSPENDED'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setStatus(option);
              setPage(1);
            }}
            className={cx(
              'text-[13px] transition-colors duration-fast ease-out',
              status === option ? 'text-accent' : 'text-text-3 hover:text-text',
            )}
          >
            {option === 'ACTIVE' ? 'Active' : 'Suspended'}
          </button>
        ))}
      </div>

      {failure ? (
        <div className="mb-5">
          <Note tone="critical">{failure}</Note>
        </div>
      ) : null}

      {loading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : data && data.items.length ? (
        <>
          <ul className="flex flex-col">
            {data.items.map((user) => (
              <li
                key={user.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-3 first:border-t"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-3 text-[14px] text-text">
                    {user.username}
                    {user.role === 'ADMIN' ? <Marker tone="accent">Owner</Marker> : null}
                    {user.verified ? null : <Marker tone="caution">Unconfirmed</Marker>}
                  </p>
                  <p className="font-mono text-[11.5px] text-text-4">{user.email}</p>
                </div>

                <p className="ml-auto flex items-center gap-4 font-mono text-[11.5px] text-text-4">
                  <span>{user.downloadCount} downloads</span>
                  <span>{user.savedCount} saved</span>
                  <span>joined {formatDate(user.createdAt)}</span>
                </p>

                {user.role === 'ADMIN' ? null : (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => suspend(user, user.status !== 'SUSPENDED')}
                    >
                      {user.status === 'SUSPENDED' ? 'Restore' : 'Suspend'}
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => setPending(user)}>
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </>
      ) : (
        <Empty icon="users" title="No accounts here" body="Nobody matches that filter." />
      )}

      <Confirm
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={remove}
        title={`Delete ${pending?.username ?? 'this account'}?`}
        body="Their history, saves and preferences go with it. Download counts stay accurate, because the events survive without a name attached."
        confirmLabel="Delete account"
      />
    </>
  );
}
