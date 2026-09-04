import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import type { Category, NotificationPreference } from '../../lib/types';
import { PageError } from '../../components/Chrome';
import { Button, Check, Note, Skeleton, Switch } from '../../ui/primitives';

/**
 * What you hear about.
 *
 * Every switch here is off-by-choice, not off-by-accident: the defaults are
 * the useful ones, and turning the top switch off silences everything without
 * losing the finer settings underneath it. Email stays locked until the
 * address is confirmed, because sending to an unconfirmed address is how a
 * site ends up mailing someone who never asked for it.
 */
export default function Preferences() {
  const { emailVerified } = useSession();
  const loaded = useLoad<{ preference: NotificationPreference }>('/me/preferences');
  const categories = useLoad<{ items: Category[] }>('/categories');

  const [draft, setDraft] = useState<NotificationPreference | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);

  useTitle('Preferences · Cyriq VFX');

  useEffect(() => {
    if (loaded.data) setDraft(loaded.data.preference);
  }, [loaded.data]);

  function edit(patch: Partial<NotificationPreference>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setSaved(false);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setFailure(null);

    try {
      const result = await api.patch<{ preference: NotificationPreference }>('/me/preferences', {
        enabled: draft.enabled,
        newResource: draft.newResource,
        resourceUpdates: draft.resourceUpdates,
        tutorials: draft.tutorials,
        announcements: draft.announcements,
        emailEnabled: draft.emailEnabled,
        categoryIds: draft.categoryIds,
      });
      setDraft(result.preference);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
    } finally {
      setSaving(false);
    }
  }

  if (loaded.error) return <PageError onRetry={loaded.reload} />;

  return (
    <>
      <header className="mb-7">
        <h1 className="text-[30px]">Preferences</h1>
        <p className="mt-1.5 text-[13.5px] text-text-3">
          Choose what is worth telling you about. Nothing is on that you did not agree to.
        </p>
      </header>

      {!draft ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="max-w-xl">
          <Switch
            label="Notify me at all"
            description="The master switch. Off means nothing at all, in the site or by email."
            checked={draft.enabled}
            onChange={(next) => edit({ enabled: next })}
          />

          <div className={draft.enabled ? undefined : 'opacity-50'}>
            <Switch
              label="New resources"
              description="When something new is published."
              checked={draft.newResource}
              disabled={!draft.enabled}
              onChange={(next) => edit({ newResource: next })}
            />
            <Switch
              label="Updates to what I have downloaded"
              description="When a resource you have taken gets a new version."
              checked={draft.resourceUpdates}
              disabled={!draft.enabled}
              onChange={(next) => edit({ resourceUpdates: next })}
            />
            <Switch
              label="New tutorials"
              checked={draft.tutorials}
              disabled={!draft.enabled}
              onChange={(next) => edit({ tutorials: next })}
            />
            <Switch
              label="Announcements"
              description="Occasional notes from the creator."
              checked={draft.announcements}
              disabled={!draft.enabled}
              onChange={(next) => edit({ announcements: next })}
            />
            <Switch
              label="Email me as well"
              description={
                emailVerified
                  ? 'Send the same notifications to your inbox.'
                  : 'Confirm your email address first.'
              }
              checked={draft.emailEnabled}
              disabled={!draft.enabled || !emailVerified}
              onChange={(next) => edit({ emailEnabled: next })}
            />
          </div>

          {!emailVerified ? (
            <p className="mt-4 text-[12.5px] text-text-3">
              Your email address is not confirmed yet.{' '}
              <Link to="/account/profile" className="underlined">
                Send a new confirmation
              </Link>
              .
            </p>
          ) : null}

          {categories.data ? (
            <section className="mt-10">
              <h2 className="kicker mb-3 border-b border-line pb-2">
                Only these categories, if you like
              </h2>
              <p className="mb-4 text-[12.5px] text-text-3">
                Leave them all unchecked to hear about everything.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {categories.data.items.map((category) => (
                  <Check
                    key={category.id}
                    checked={draft.categoryIds.includes(category.id)}
                    disabled={!draft.enabled}
                    onChange={(next) =>
                      edit({
                        categoryIds: next
                          ? [...draft.categoryIds, category.id]
                          : draft.categoryIds.filter((id) => id !== category.id),
                      })
                    }
                    label={category.name}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {failure ? (
            <div className="mt-6">
              <Note tone="critical">{failure.message}</Note>
            </div>
          ) : null}

          <div className="mt-8 flex items-center gap-4 border-t border-line pt-5">
            <Button variant="primary" onClick={save} loading={saving}>
              Save preferences
            </Button>
            {saved ? (
              <p role="status" className="text-[13px] text-positive">
                Preferences saved.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
