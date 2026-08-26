import { useEffect, useState } from 'react';
import { api, ApiError, type SiteSettings } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useFetch } from '../../lib/hooks';
import { Button, Block, Skeleton, TextArea, TextField, Toggle, useToast } from '../../components/ui';

/** Site settings (PRD §49). Everything the owner can change without code. */
export default function SettingsAdmin() {
  const { toast } = useToast();
  const { refresh } = useAuth();
  const { data } = useFetch<{ settings: SiteSettings }>('/admin/settings');
  const [form, setForm] = useState<SiteSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.settings) setForm(data.settings);
  }, [data]);

  if (!form) return <Skeleton className="h-96" />;

  const set = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/admin/settings', form);
      toast('Settings saved.', 'success');
      setDirty(false);
      // The public shell reads these, so refresh what the app is holding.
      await refresh();
      window.location.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save that.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[30px] leading-tight md:text-[34px]">Settings</h1>
        <div className="flex items-center gap-3">
          {dirty ? <span className="text-[13px] text-faint">Unsaved changes</span> : null}
          <Button variant="primary" onClick={save} loading={busy} disabled={!dirty}>Save settings</Button>
        </div>
      </header>

      <Block title="Site">
        <div className="flex flex-col gap-4">
          <TextField label="Site name" value={form.siteName} onChange={(e) => set('siteName', e.target.value)} />
          <TextField label="Tagline" value={form.tagline} onChange={(e) => set('tagline', e.target.value)} />
          <TextField label="Creator name" value={form.creatorName} onChange={(e) => set('creatorName', e.target.value)} />
          <TextField label="Contact email" type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} hint="Shown in the footer and on the About page. Leave blank to hide." />
        </div>
      </Block>

      <Block title="Homepage hero">
        <div className="flex flex-col gap-4">
          <TextField label="Headline" value={form.heroTitle} onChange={(e) => set('heroTitle', e.target.value)} />
          <TextArea label="Supporting text" rows={3} value={form.heroSubtitle} onChange={(e) => set('heroSubtitle', e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Primary button" value={form.heroPrimaryCta} onChange={(e) => set('heroPrimaryCta', e.target.value)} />
            <TextField label="Secondary button" value={form.heroSecondaryCta} onChange={(e) => set('heroSecondaryCta', e.target.value)} />
          </div>
        </div>
      </Block>

      <Block title="About">
        <div className="flex flex-col gap-4">
          <TextField label="About heading" value={form.aboutTitle} onChange={(e) => set('aboutTitle', e.target.value)} />
          <TextArea label="About text" rows={5} value={form.aboutBody} onChange={(e) => set('aboutBody', e.target.value)} />
        </div>
      </Block>

      <Block title="Announcement banner" description="A thin bar above the header. Use it sparingly.">
        <div className="flex flex-col gap-4">
          <Toggle
            label="Show the banner"
            checked={form.announcement.enabled}
            onChange={(v) => set('announcement', { ...form.announcement, enabled: v })}
          />
          <TextField
            label="Banner text"
            value={form.announcement.text}
            onChange={(e) => set('announcement', { ...form.announcement, text: e.target.value })}
            disabled={!form.announcement.enabled}
          />
          <TextField
            label="Banner link"
            value={form.announcement.href}
            onChange={(e) => set('announcement', { ...form.announcement, href: e.target.value })}
            placeholder="/resources/new-pack"
            disabled={!form.announcement.enabled}
          />
        </div>
      </Block>

      <Block title="Social links" description="Only filled-in links are shown.">
        <div className="grid gap-4 sm:grid-cols-2">
          {(['youtube', 'instagram', 'tiktok', 'x', 'discord'] as const).map((key) => (
            <TextField
              key={key}
              label={key === 'x' ? 'X' : key.charAt(0).toUpperCase() + key.slice(1)}
              value={form.social[key]}
              onChange={(e) => set('social', { ...form.social, [key]: e.target.value })}
              placeholder="https://"
            />
          ))}
        </div>
      </Block>

      <Block title="SEO defaults" description="Used on pages without their own metadata.">
        <div className="flex flex-col gap-4">
          <TextField label="Default title" value={form.seo.defaultTitle} onChange={(e) => set('seo', { ...form.seo, defaultTitle: e.target.value })} />
          <TextArea label="Default description" rows={2} value={form.seo.defaultDescription} onChange={(e) => set('seo', { ...form.seo, defaultDescription: e.target.value })} />
        </div>
      </Block>

      <Block title="Copy">
        <div className="flex flex-col gap-4">
          <TextField label="Download message" value={form.downloadMessage} onChange={(e) => set('downloadMessage', e.target.value)} />
          <TextField label="Footer note" value={form.footerNote} onChange={(e) => set('footerNote', e.target.value)} />
        </div>
      </Block>
    </div>
  );
}
