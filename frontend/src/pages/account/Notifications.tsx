import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type NotificationItem } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useFetch } from '../../lib/hooks';
import { Button, cx, EmptyState, LinkButton, Skeleton } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { formatRelative } from '../../lib/format';

const TYPE_ICON: Record<NotificationItem['type'], IconName> = {
  NEW_RESOURCE: 'sparkles',
  RESOURCE_UPDATED: 'refresh',
  TUTORIAL_PUBLISHED: 'play',
  ANNOUNCEMENT: 'info',
};

/** Notification centre (PRD §21). */
export default function Notifications() {
  const { setUnread } = useAuth();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ page: String(page), perPage: '20' });
  if (unreadOnly) query.set('unreadOnly', 'true');
  const { data, loading, reload } = useFetch<{
    items: NotificationItem[];
    unread: number;
    total: number;
    hasMore: boolean;
  }>(`/me/notifications?${query}`, [unreadOnly, page]);

  const markAll = async () => {
    await api.post('/me/notifications/read-all').catch(() => {});
    setUnread(0);
    reload();
  };

  const open = async (n: NotificationItem) => {
    if (n.read) return;
    await api.post(`/me/notifications/${n.id}/read`).catch(() => {});
    setUnread(Math.max(0, (data?.unread ?? 1) - 1));
  };

  if (loading && !data) return <Skeleton className="h-64 w-full" />;

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-ink pb-3">
        <h2 className="text-[26px] md:text-[30px]">Notifications</h2>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={unreadOnly ? 'primary' : 'quiet'}
            onClick={() => { setUnreadOnly((v) => !v); setPage(1); }}
            aria-pressed={unreadOnly}
          >
            Unread only
          </Button>
          {(data?.unread ?? 0) > 0 ? (
            <Button size="sm" icon="check" onClick={markAll}>Mark all read</Button>
          ) : null}
        </div>
      </div>

      {!data || data.items.length === 0 ? (
        <EmptyState
          icon="bell"
          title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}
          description={
            unreadOnly
              ? 'You are all caught up.'
              : 'You will hear about new resources, updates to things you downloaded, and new tutorials.'
          }
          action={
            <LinkButton to="/account/preferences">Choose what you hear about</LinkButton>
          }
        />
      ) : (
        <>
          <ul className="flex flex-col">
            {data.items.map((n) => (
              <li key={n.id} className="border-b border-rule first:border-t">
                <Link
                  to={n.link}
                  onClick={() => open(n)}
                  className={cx(
                    'flex gap-4 py-4 transition-colors duration-fast',
                    !n.read && 'border-l-2 border-blue pl-4',
                  )}
                >
                  <Icon
                    name={TYPE_ICON[n.type]}
                    size={17}
                    className={cx('mt-0.5 shrink-0', n.read ? 'text-ghost' : 'text-blue')}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium leading-snug text-ink">
                      {n.title}
                    </span>
                    <span className="mt-1 block text-[13.5px] leading-relaxed text-soft">
                      {n.body}
                    </span>
                    <span className="mt-2 block font-mono text-[11.5px] text-ghost">
                      {formatRelative(n.createdAt)}
                    </span>
                  </span>
                  {!n.read ? (
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue" aria-label="Unread" />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>

          {data.hasMore ? (
            <div className="mt-8 flex justify-center border-t border-rule pt-6">
              <Button onClick={() => setPage((p) => p + 1)} loading={loading}>Load more</Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
