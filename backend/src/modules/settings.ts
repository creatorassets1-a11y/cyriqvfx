import { z } from 'zod';
import { prisma } from '../db/prisma.js';

/**
 * Site settings (PRD §49). Validated server-side, cached briefly because the
 * public shell reads them on every page render.
 */
export const siteSettingsSchema = z.object({
  siteName: z.string().min(1).max(60),
  tagline: z.string().max(160),
  heroTitle: z.string().min(1).max(120),
  heroSubtitle: z.string().max(300),
  heroPrimaryCta: z.string().max(40),
  heroSecondaryCta: z.string().max(40),
  aboutTitle: z.string().max(120),
  aboutBody: z.string().max(2000),
  creatorName: z.string().max(80),
  contactEmail: z.string().email().or(z.literal('')),
  announcement: z.object({
    enabled: z.boolean(),
    text: z.string().max(200),
    href: z.string().max(300),
  }),
  social: z.object({
    youtube: z.string().max(300),
    instagram: z.string().max(300),
    tiktok: z.string().max(300),
    x: z.string().max(300),
    discord: z.string().max(300),
  }),
  seo: z.object({
    defaultTitle: z.string().max(70),
    defaultDescription: z.string().max(200),
  }),
  downloadMessage: z.string().max(300),
  footerNote: z.string().max(200),
});

export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export const DEFAULT_SETTINGS: SiteSettings = {
  siteName: 'Cyriq VFX',
  tagline: 'Free resources for video editors.',
  heroTitle: 'Free resources for video editors.',
  heroSubtitle:
    'Scene packs, After Effects tools, LUTs, presets, overlays, templates and SFX, with the tutorials that show you how to use them. No account needed to download.',
  heroPrimaryCta: 'Browse resources',
  heroSecondaryCta: 'Latest drops',
  aboutTitle: 'Made by an editor, for editors',
  aboutBody:
    'Everything here comes out of real edits. When a tool saves me time or a pack keeps showing up in my projects, I clean it up and put it here for free, with honest compatibility notes and a license you can actually read.',
  creatorName: 'Cyriq',
  contactEmail: '',
  announcement: { enabled: false, text: '', href: '' },
  social: { youtube: '', instagram: '', tiktok: '', x: '', discord: '' },
  seo: {
    defaultTitle: 'Cyriq VFX · Free resources for video editors',
    defaultDescription:
      'Free scene packs, After Effects tools, LUTs, presets, overlays and SFX for video editors. Direct downloads, clear licenses, no account required.',
  },
  downloadMessage: 'Free download. No account required.',
  footerNote: 'Built for editors who would rather be editing.',
};

const SETTINGS_KEY = 'site';
let cache: { value: SiteSettings; at: number } | null = null;
const TTL_MS = 30_000;

export async function getSiteSettings(): Promise<SiteSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const row = await prisma.siteSetting.findUnique({ where: { key: SETTINGS_KEY } });
  const parsed = siteSettingsSchema.safeParse(row?.value);
  // Merge so a settings row written before a new field exists still boots.
  const value = parsed.success
    ? parsed.data
    : { ...DEFAULT_SETTINGS, ...(typeof row?.value === 'object' ? row?.value : {}) };
  const safe = siteSettingsSchema.parse({ ...DEFAULT_SETTINGS, ...value });
  cache = { value: safe, at: Date.now() };
  return safe;
}

export async function saveSiteSettings(next: SiteSettings): Promise<SiteSettings> {
  const value = siteSettingsSchema.parse(next);
  await prisma.siteSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: value as never },
    update: { value: value as never },
  });
  cache = { value, at: Date.now() };
  return value;
}

export function invalidateSettingsCache(): void {
  cache = null;
}
