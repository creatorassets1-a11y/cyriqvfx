import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../middleware/index.js';
import { env } from '../config/env.js';
import { getSiteSettings } from '../modules/settings.js';

export const seoRouter = Router();

const site = () => env.PUBLIC_SITE_URL.replace(/\/$/, '');

function urlEntry(loc: string, lastmod?: Date | null, changefreq = 'weekly', priority = '0.6') {
  return `  <url>
    <loc>${escapeXml(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!,
  );
}

/** Sitemap (PRD §29, §96). Unlisted and draft content is deliberately absent. */
seoRouter.get(
  '/sitemap.xml',
  asyncHandler(async (_req, res) => {
    const [resources, tutorials, categories, changelog] = await Promise.all([
      prisma.resource.findMany({
        where: { status: 'PUBLISHED' },
        select: { slug: true, updatedAt: true },
        orderBy: { publishedAt: 'desc' },
        take: 5000,
      }),
      prisma.tutorial.findMany({
        where: { status: 'PUBLISHED' },
        select: { slug: true, updatedAt: true },
        take: 2000,
      }),
      prisma.category.findMany({
        where: { status: 'ACTIVE' },
        select: { slug: true, updatedAt: true },
      }),
      prisma.changelogEntry.findFirst({
        where: { status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        select: { publishedAt: true },
      }),
    ]);

    const urls = [
      urlEntry(`${site()}/`, new Date(), 'daily', '1.0'),
      urlEntry(`${site()}/resources`, new Date(), 'daily', '0.9'),
      urlEntry(`${site()}/tutorials`, new Date(), 'weekly', '0.8'),
      urlEntry(`${site()}/categories`, new Date(), 'weekly', '0.7'),
      urlEntry(`${site()}/updates`, changelog?.publishedAt ?? null, 'weekly', '0.6'),
      urlEntry(`${site()}/about`, null, 'monthly', '0.4'),
      ...categories.map((c) => urlEntry(`${site()}/categories/${c.slug}`, c.updatedAt, 'weekly', '0.7')),
      ...resources.map((r) => urlEntry(`${site()}/resources/${r.slug}`, r.updatedAt, 'weekly', '0.8')),
      ...tutorials.map((t) => urlEntry(`${site()}/tutorials/${t.slug}`, t.updatedAt, 'monthly', '0.7')),
    ];

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600');
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
    );
  }),
);

seoRouter.get('/robots.txt', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  // Account and admin areas are private; download endpoints are per-visitor.
  res.send(
    `User-agent: *
Allow: /
Disallow: /admin
Disallow: /account
Disallow: /api/
Disallow: /download/
Disallow: /reset-password
Disallow: /verify-email

Sitemap: ${site()}/sitemap.xml
`,
  );
});

/**
 * Page metadata for the server-rendered shell (PRD §29, §31).
 * Returns title, description, canonical, OG/Twitter fields and JSON-LD for a
 * given public path, so shared links and crawlers see real content.
 */
export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  ogType: string;
  image?: string | null;
  jsonLd?: Record<string, unknown>;
  /** Crawler-visible summary rendered into the shell. */
  heading?: string;
  bodyText?: string;
  noindex?: boolean;
  status?: number;
}

export async function resolvePageMeta(pathname: string): Promise<PageMeta> {
  const settings = await getSiteSettings();
  const base = site();
  const clean = pathname.split('?')[0].replace(/\/$/, '') || '/';
  const canonical = `${base}${clean === '/' ? '/' : clean}`;

  const fallback: PageMeta = {
    title: settings.seo.defaultTitle,
    description: settings.seo.defaultDescription,
    canonical,
    ogType: 'website',
  };

  const resourceMatch = /^\/resources\/([\w-]+)$/.exec(clean);
  if (resourceMatch) {
    const r = await prisma.resource.findUnique({
      where: { slug: resourceMatch[1] },
      include: {
        category: { select: { name: true } },
        license: { select: { name: true, commercialUse: true } },
        currentVersion: { select: { version: true, fileSize: true } },
        software: { select: { software: { select: { name: true } } } },
      },
    });
    if (!r || (r.status !== 'PUBLISHED' && r.status !== 'UNLISTED')) {
      return { ...fallback, title: `Not found · ${settings.siteName}`, noindex: true, status: 404 };
    }
    const softwareNames = r.software.map((s) => s.software.name);
    const description =
      r.seoDescription ??
      `${r.shortDescription}${softwareNames.length ? ` Works with ${softwareNames.join(', ')}.` : ''} Free download, no account required.`;
    return {
      title: r.seoTitle ?? `${r.title} · Free ${r.category.name} for editors | ${settings.siteName}`,
      description: description.slice(0, 200),
      canonical: `${base}/resources/${r.slug}`,
      ogType: 'article',
      image: r.ogImageKey ?? r.thumbnailKey ? `${base}/api/media/${encodeURIComponent((r.ogImageKey ?? r.thumbnailKey)!)}` : null,
      noindex: r.status === 'UNLISTED',
      heading: r.title,
      bodyText: `${r.shortDescription} ${r.fullDescription}`.slice(0, 600),
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        name: r.title,
        description: r.shortDescription,
        url: `${base}/resources/${r.slug}`,
        datePublished: r.publishedAt?.toISOString(),
        dateModified: r.updatedAt.toISOString(),
        genre: r.category.name,
        creator: { '@type': 'Person', name: settings.creatorName },
        ...(r.currentVersion ? { version: r.currentVersion.version } : {}),
        ...(softwareNames.length ? { requirements: softwareNames.join(', ') } : {}),
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
        },
        ...(r.license
          ? { license: r.license.name, usageInfo: r.license.commercialUse ? 'Commercial use permitted' : 'Personal use' }
          : {}),
      },
    };
  }

  const tutorialMatch = /^\/tutorials\/([\w-]+)$/.exec(clean);
  if (tutorialMatch) {
    const t = await prisma.tutorial.findUnique({
      where: { slug: tutorialMatch[1] },
      include: { category: { select: { name: true } } },
    });
    if (!t || (t.status !== 'PUBLISHED' && t.status !== 'UNLISTED')) {
      return { ...fallback, title: `Not found · ${settings.siteName}`, noindex: true, status: 404 };
    }
    return {
      title: t.seoTitle ?? `${t.title} | ${settings.siteName}`,
      description: (t.seoDescription ?? t.summary).slice(0, 200),
      canonical: `${base}/tutorials/${t.slug}`,
      ogType: 'article',
      image: t.ogImageKey ?? t.coverKey ? `${base}/api/media/${encodeURIComponent((t.ogImageKey ?? t.coverKey)!)}` : null,
      noindex: t.status === 'UNLISTED',
      heading: t.title,
      bodyText: `${t.summary} ${t.body}`.slice(0, 600),
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': t.videoKey || t.videoUrl ? 'VideoObject' : 'Article',
        name: t.title,
        headline: t.title,
        description: t.summary,
        url: `${base}/tutorials/${t.slug}`,
        datePublished: t.publishedAt?.toISOString(),
        dateModified: t.updatedAt.toISOString(),
        author: { '@type': 'Person', name: settings.creatorName },
        ...(t.durationSeconds ? { duration: `PT${Math.round(t.durationSeconds / 60)}M` } : {}),
      },
    };
  }

  const categoryMatch = /^\/categories\/([\w-]+)$/.exec(clean);
  if (categoryMatch) {
    const c = await prisma.category.findUnique({
      where: { slug: categoryMatch[1] },
      include: { _count: { select: { resources: { where: { status: 'PUBLISHED' } } } } },
    });
    if (!c || c.status === 'ARCHIVED') {
      return { ...fallback, title: `Not found · ${settings.siteName}`, noindex: true, status: 404 };
    }
    return {
      title: c.seoTitle ?? `Free ${c.name} for video editors | ${settings.siteName}`,
      description: (
        c.seoDescription ??
        c.description ??
        `${c._count.resources} free ${c.name.toLowerCase()} resources for video editors. Direct downloads, clear licenses, no account required.`
      ).slice(0, 200),
      canonical: `${base}/categories/${c.slug}`,
      ogType: 'website',
      noindex: c.status === 'HIDDEN',
      heading: c.name,
      bodyText: c.description ?? '',
    };
  }

  const staticPages: Record<string, PageMeta> = {
    '/': {
      ...fallback,
      canonical: `${base}/`,
      heading: settings.heroTitle,
      bodyText: settings.heroSubtitle,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: settings.siteName,
        url: base,
        description: settings.seo.defaultDescription,
        potentialAction: {
          '@type': 'SearchAction',
          target: `${base}/resources?q={search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      },
    },
    '/resources': {
      ...fallback,
      title: `Browse free editing resources | ${settings.siteName}`,
      description:
        'Browse every free resource: scene packs, After Effects tools, LUTs, presets, overlays, templates and SFX. Filter by software, format and license.',
      canonical: `${base}/resources`,
      heading: 'Resources',
    },
    '/tutorials': {
      ...fallback,
      title: `Editing tutorials | ${settings.siteName}`,
      description:
        'Tutorials that show exactly how to use the resources in this library, covering After Effects, Premiere Pro and DaVinci Resolve workflows.',
      canonical: `${base}/tutorials`,
      heading: 'Tutorials',
    },
    '/categories': {
      ...fallback,
      title: `Categories | ${settings.siteName}`,
      description: 'Every category of free resource in the library.',
      canonical: `${base}/categories`,
      heading: 'Categories',
    },
    '/updates': {
      ...fallback,
      title: `Updates and releases | ${settings.siteName}`,
      description: 'New releases, resource updates and site changes.',
      canonical: `${base}/updates`,
      heading: 'Updates',
    },
    '/about': {
      ...fallback,
      title: `About | ${settings.siteName}`,
      description: settings.aboutBody.slice(0, 200),
      canonical: `${base}/about`,
      heading: settings.aboutTitle,
      bodyText: settings.aboutBody,
    },
  };

  if (staticPages[clean]) return staticPages[clean];

  // Private areas must never be indexed.
  if (/^\/(account|admin|login|register|reset-password|verify-email|download)/.test(clean)) {
    return { ...fallback, title: `${settings.siteName}`, noindex: true };
  }

  return { ...fallback, noindex: true, status: 404, title: `Not found · ${settings.siteName}` };
}
