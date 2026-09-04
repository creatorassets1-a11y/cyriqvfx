import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import type { SiteSettings } from '../../lib/types';
import { PageError } from '../../components/Chrome';
import { Button, Check, Field, Input, Note, Skeleton, Textarea } from '../../ui/primitives';

/**
 * Site settings.
 *
 * Everything the site says about itself is edited here, which is what keeps
 * copy out of the code. The server also embeds these in the HTML shell, so a
 * change to the headline is on screen in the first paint of the next request
 * rather than arriving a moment later and pushing the page around.
 */
export default function SettingsAdmin() {
  const { data, error, loading, reload } = useLoad<{ settings: SiteSettings }>('/admin/settings');
  const [draft, setDraft] = useState<SiteSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);

  useTitle('Settings · Owner tools');

  useEffect(() => {
    if (data) setDraft(data.settings);
  }, [data]);

  function edit(patch: Partial<SiteSettings>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setSaved(false);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setFailure(null);

    try {
      const result = await api.put<{ settings: SiteSettings }>('/admin/settings', draft);
      setDraft(result.settings);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
    } finally {
      setSaving(false);
    }
  }

  if (error) return <PageError onRetry={reload} />;

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px]">Settings</h1>
          <p className="mt-1.5 text-[13.5px] text-text-3">
            The words the site says about itself. No deploy needed.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {saved ? (
            <p role="status" className="text-[13px] text-positive">
              Settings saved.
            </p>
          ) : null}
          <Button variant="primary" onClick={save} loading={saving}>
            Save settings
          </Button>
        </div>
      </header>

      {failure ? (
        <div className="mb-6">
          <Note tone="critical">{failure.message}</Note>
        </div>
      ) : null}

      {loading || !draft ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="flex max-w-2xl flex-col gap-12">
          <Group title="Identity">
            <Field label="Site name" error={failure?.on('siteName')}>
              {(props) => (
                <Input
                  {...props}
                  value={draft.siteName}
                  onChange={(event) => edit({ siteName: event.target.value })}
                />
              )}
            </Field>

            <Field label="Tagline" error={failure?.on('tagline')}>
              {(props) => (
                <Input
                  {...props}
                  value={draft.tagline}
                  onChange={(event) => edit({ tagline: event.target.value })}
                />
              )}
            </Field>

            <Field label="Creator name" error={failure?.on('creatorName')}>
              {(props) => (
                <Input
                  {...props}
                  value={draft.creatorName}
                  onChange={(event) => edit({ creatorName: event.target.value })}
                />
              )}
            </Field>

            <Field label="Contact email" error={failure?.on('contactEmail')}>
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  value={draft.contactEmail}
                  onChange={(event) => edit({ contactEmail: event.target.value })}
                />
              )}
            </Field>
          </Group>

          <Group title="Front page">
            <Field label="Headline" hint="The first thing anyone reads." error={failure?.on('heroTitle')}>
              {(props) => (
                <Input
                  {...props}
                  value={draft.heroTitle}
                  onChange={(event) => edit({ heroTitle: event.target.value })}
                />
              )}
            </Field>

            <Field label="Subheadline" error={failure?.on('heroSubtitle')}>
              {(props) => (
                <Textarea
                  {...props}
                  rows={2}
                  value={draft.heroSubtitle}
                  onChange={(event) => edit({ heroSubtitle: event.target.value })}
                />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Primary button" error={failure?.on('heroPrimaryCta')}>
                {(props) => (
                  <Input
                    {...props}
                    value={draft.heroPrimaryCta}
                    onChange={(event) => edit({ heroPrimaryCta: event.target.value })}
                  />
                )}
              </Field>

              <Field label="Secondary button" error={failure?.on('heroSecondaryCta')}>
                {(props) => (
                  <Input
                    {...props}
                    value={draft.heroSecondaryCta}
                    onChange={(event) => edit({ heroSecondaryCta: event.target.value })}
                  />
                )}
              </Field>
            </div>

            <Field label="Download message" hint="Shown next to every download button.">
              {(props) => (
                <Input
                  {...props}
                  value={draft.downloadMessage}
                  onChange={(event) => edit({ downloadMessage: event.target.value })}
                />
              )}
            </Field>
          </Group>

          <Group title="Announcement bar">
            <Check
              checked={draft.announcement.enabled}
              onChange={(enabled) => edit({ announcement: { ...draft.announcement, enabled } })}
              label="Show the announcement bar"
            />

            <Field label="Announcement text">
              {(props) => (
                <Input
                  {...props}
                  value={draft.announcement.text}
                  onChange={(event) =>
                    edit({ announcement: { ...draft.announcement, text: event.target.value } })
                  }
                />
              )}
            </Field>

            <Field label="Announcement link" optional>
              {(props) => (
                <Input
                  {...props}
                  value={draft.announcement.href}
                  onChange={(event) =>
                    edit({ announcement: { ...draft.announcement, href: event.target.value } })
                  }
                  placeholder="/resources/new-pack"
                />
              )}
            </Field>
          </Group>

          <Group title="About page">
            <Field label="About title" error={failure?.on('aboutTitle')}>
              {(props) => (
                <Input
                  {...props}
                  value={draft.aboutTitle}
                  onChange={(event) => edit({ aboutTitle: event.target.value })}
                />
              )}
            </Field>

            <Field label="About text" error={failure?.on('aboutBody')}>
              {(props) => (
                <Textarea
                  {...props}
                  rows={8}
                  value={draft.aboutBody}
                  onChange={(event) => edit({ aboutBody: event.target.value })}
                />
              )}
            </Field>

            <Field label="Footer note">
              {(props) => (
                <Input
                  {...props}
                  value={draft.footerNote}
                  onChange={(event) => edit({ footerNote: event.target.value })}
                />
              )}
            </Field>
          </Group>

          <Group title="Search engines">
            <Field label="Default page title" hint="Up to 70 characters." error={failure?.on('seo.defaultTitle')}>
              {(props) => (
                <Input
                  {...props}
                  value={draft.seo.defaultTitle}
                  onChange={(event) =>
                    edit({ seo: { ...draft.seo, defaultTitle: event.target.value } })
                  }
                />
              )}
            </Field>

            <Field label="Default description" hint="Up to 200 characters.">
              {(props) => (
                <Textarea
                  {...props}
                  rows={2}
                  value={draft.seo.defaultDescription}
                  onChange={(event) =>
                    edit({ seo: { ...draft.seo, defaultDescription: event.target.value } })
                  }
                />
              )}
            </Field>
          </Group>

          <Group title="Where else you are">
            {(['youtube', 'instagram', 'tiktok', 'x', 'discord'] as const).map((network) => (
              <Field
                key={network}
                label={network === 'x' ? 'X' : network.charAt(0).toUpperCase() + network.slice(1)}
                optional
              >
                {(props) => (
                  <Input
                    {...props}
                    value={draft.social[network]}
                    onChange={(event) =>
                      edit({ social: { ...draft.social, [network]: event.target.value } })
                    }
                    placeholder="https://…"
                  />
                )}
              </Field>
            ))}
          </Group>

          <div className="border-t border-line pt-6">
            <Button variant="primary" onClick={save} loading={saving}>
              Save settings
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="kicker mb-4 border-b border-line pb-2">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
