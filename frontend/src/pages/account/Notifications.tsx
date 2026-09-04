import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import type { Notification, Paged } from '../../lib/types';
import { formatRelative } from '../../lib/format';
import { PageError } from '../../components/Chrome';
import { Button, ButtonLink, Empty, Marker, cx } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';

/**
 * Notifications.
 *
 * Only what the owner published and what changed in something already taken.
 * Opening one marks it read; there is no other state to manage here.
 */

const KIND: Record<Notification['type'], { label: string; tone: 'accent' | 'positive' | 'neutral' }> =
  {
    NEW_RESOURCE: { label: 'New', tone: 'accent' },
    RESOURCE_UPDATED: { label: 'Updated', tone: 'positive' },
    TUTORIAL_PUBLISHED: { label: 'Tutorial', tone: 'neutral' },
    ANNOUNCEMENT: { label: 'Announcement', tone: 'neutral' },
  };

export default function Notifications() {
  const { setUnread } = useSession();
  const { toast } = useToast();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { data, error, loading, reload, set } = useLoad<Paged<Notification> & { unread: number }>(
    `/me/notifications${unreadOnly ? '?unreadOnly=true' : ''}`,
  );

  useTitle('Notifications · Cyriq VFX');

  async function markOne(item: Notification) {
    if (item.read || !data) return;
    set({
      ...data,
      items: data.items.map((row) => (row.id === item.id ? { ...row, read: true } : row)),
    });
    const result = await api
      .post<{ unread: number }>(`/me/notifications/${item.id}/read`)
      .catch(() => null);
    if (result) setUnread(result.unread);
  }

  async function markAll() {
    try {
      await api.post('/me/notifications/read-all');
      setUnread(0);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work.', 'error');
    }
  }

  if (error) return <PageError onRetry={reload} />;

  return (
    <>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px]">Notifications</h1>
          <p className="mt-1.5 text-[13.5px] text-text-3">
            New resources, updates to what you have taken, and anything the owner announces.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setUnreadOnly((value) => !value)}>
            {unreadOnly ? 'Show all' : 'Unread only'}
          </Button>
          <Button size="sm" onClick={markAll}>
            Mark all read
          </Button>
        </div>
      </header>

      {loading && !data ? null : data && data.items.length ? (
        <ul className="flex flex-col">
          {data.items.map((item) => (
            <li
              key={item.id}
              className={cx(
                'border-b border-line first:border-t',
                !item.read && 'border-l-2 border-l-accent pl-4',
              )}
            >
              <Link to={item.link} onClick={() => markOne(item)} className="group block py-4">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <Marker tone={KIND[item.type]?.tone ?? 'neutral'}>
                    {KIND[item.type]?.label ?? 'Update'}
                  </Marker>
                  <span className="ml-auto font-mono text-[11.5px] text-text-4">
                    {formatRelative(item.createdAt)}
                  </span>
                </div>
                <p className="mt-1.5 text-[15px] text-text group-hover:text-accent">{item.title}</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-text-2">{item.body}</p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          icon="bell"
          title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}
          body="You will hear when something you have downloaded is updated, or when something new lands in a category you follow."
          action={
            <ButtonLink to="/account/preferences">Choose what you hear about</ButtonLink>
          }
        />
      )}
    </>
  );
}
