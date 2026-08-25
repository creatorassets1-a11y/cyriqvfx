import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type Category } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useFetch } from '../../lib/hooks';
import { Button, Block, Skeleton, Toggle, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';

interface Preference {
  enabled: boolean;
  newResource: boolean;
  resourceUpdates: boolean;
  tutorials: boolean;
  announcements: boolean;
  emailEnabled: boolean;
  categoryIds: string[];
}

/** Notification preferences (PRD §21). */
export default function Preferences() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data } = useFetch<{ preference: Preference }>('/me/preferences');
  const { data: categories } = useFetch<{ items: Category[] }>('/categories');

  const [pref, setPref] = useState<Preference | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.preference) setPref(data.preference);
  }, [data]);

  if (!pref) return <Skeleton className="h-64 w-full" />;

  const set = <K extends keyof Preference>(key: K, value: Preference[K]) => {
    setPref((p) => (p ? { ...p, [key]: value } : p));
    setDirty(true);
  };

  const toggleCategory = (id: string) => {
    setPref((p) => {
      if (!p) return p;
      const has = p.categoryIds.includes(id);
      return { ...p, categoryIds: has ? p.categoryIds.filter((c) => c !== id) : [...p.categoryIds, id] };
    });
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/me/preferences', pref);
      toast('Preferences saved.', 'success');
      setDirty(false);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not save.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <Block title="Notifications" description="Choose what is worth telling you about.">
        <div className="flex flex-col gap-5">
          <Toggle
            label="Notifications"
            description="Turn everything off with one switch."
            checked={pref.enabled}
            onChange={(v) => set('enabled', v)}
          />

          <div className="flex flex-col gap-4 border-t border-rule pt-5">
            <Toggle
              label="New resources"
              description="When something new is published."
              checked={pref.newResource}
              onChange={(v) => set('newResource', v)}
              disabled={!pref.enabled}
            />
            <Toggle
              label="Updates to your downloads"
              description="Only for resources you have actually downloaded."
              checked={pref.resourceUpdates}
              onChange={(v) => set('resourceUpdates', v)}
              disabled={!pref.enabled}
            />
            <Toggle
              label="New tutorials"
              checked={pref.tutorials}
              onChange={(v) => set('tutorials', v)}
              disabled={!pref.enabled}
            />
            <Toggle
              label="Announcements"
              description="Rare. Site news only."
              checked={pref.announcements}
              onChange={(v) => set('announcements', v)}
              disabled={!pref.enabled}
            />
          </div>

          <div className="border-t border-rule pt-5">
            <Toggle
              label="Email me as well"
              description={
                user?.emailVerifiedAt
                  ? 'Same notifications, delivered to your inbox.'
                  : 'Confirm your email address first.'
              }
              checked={pref.emailEnabled}
              onChange={(v) => set('emailEnabled', v)}
              disabled={!pref.enabled || !user?.emailVerifiedAt}
            />
            {!user?.emailVerifiedAt ? (
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-warn">
                <Icon name="info" size={12} />
                <Link to="/account/profile" className="hover:underline">Confirm your email</Link>
                to enable this.
              </p>
            ) : null}
          </div>
        </div>
      </Block>

      {categories && categories.items.length > 0 ? (
        <Block
          title="Categories you care about"
          description="Leave all unchecked to hear about everything."
        >
          <div className="flex flex-wrap gap-2">
            {categories.items.map((c) => {
              const active = pref.categoryIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCategory(c.id)}
                  aria-pressed={active}
                  disabled={!pref.enabled}
                  className={
                    'text-[14px] underline-offset-4 transition-colors duration-fast disabled:opacity-50 ' +
                    (active
                      ? 'text-blue underline decoration-blue'
                      : 'text-faint hover:text-ink hover:underline')
                  }
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </Block>
      ) : null}

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} loading={busy} disabled={!dirty}>
          Save preferences
        </Button>
        {dirty ? <span className="text-[13px] text-faint">Unsaved changes</span> : null}
      </div>
    </div>
  );
}
