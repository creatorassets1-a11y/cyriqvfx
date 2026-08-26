import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { attachUser, requireAdmin } from './middleware/auth.js';
import { errorHandler, notFoundHandler, asyncHandler, limiters } from './middleware/index.js';
import { publicCache } from './middleware/cache.js';
import { prisma } from './db/prisma.js';

import { resourcesRouter } from './routes/resources.js';
import { categoriesRouter } from './routes/categories.js';
import { tutorialsRouter } from './routes/tutorials.js';
import { searchRouter } from './routes/search.js';
import { downloadRouter } from './routes/download.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { uploadsRouter } from './routes/uploads.js';
import { mediaRouter, localStorageRouter } from './routes/media.js';
import { seoRouter, resolvePageMeta } from './routes/seo.js';
import { changelogRouter, reportsRouter, requestsRouter } from './routes/community.js';
import { adminResourcesRouter } from './routes/admin/resources.js';
import { adminTaxonomyRouter } from './routes/admin/taxonomy.js';
import { adminTutorialsRouter } from './routes/admin/tutorials.js';
import { adminInsightsRouter } from './routes/admin/insights.js';
import { getSiteSettings, type SiteSettings } from './modules/settings.js';

export function createApp(): Express {
  const app = express();

  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Request id for correlating logs (PRD §90).
  app.use((req, res, next) => {
    const id = (req.get('x-request-id') || randomUUID()).slice(0, 64);
    res.setHeader('x-request-id', id);
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // The shell inlines a small theme/meta script and JSON-LD.
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          // No webfont host: the UI uses the platform's own faces.
          fontSrc: ["'self'", 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'blob:', 'https:'],
          connectSrc: ["'self'", ...env.corsOrigins, 'https:'],
          frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: env.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  // CORS applies to the API only. Static assets are same-origin and must never
  // be gated on it, since browsers send an Origin header even for same-origin module
  // scripts, so gating them would break the app it is meant to protect.
  app.use(
    '/api',
    cors({
      origin(origin, cb) {
        // No Origin header: same-origin navigations and server-to-server calls.
        if (!origin) return cb(null, true);
        // Refusing simply omits the CORS headers, which is what makes the
        // browser block the response. Throwing here would turn a policy
        // decision into a 500 for the caller.
        cb(null, env.corsOrigins.includes(origin));
      },
      credentials: true,
    }),
  );

  app.use(compression());
  app.use(cookieParser());

  // The local-storage endpoint receives raw file bodies; it must be mounted
  // before the JSON parser so uploads are not parsed as JSON.
  app.use('/api/_local-storage', localStorageRouter);

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(attachUser);

  app.get(
    '/api/health',
    asyncHandler(async (_req, res) => {
      // A health check that never touches the database is not a health check.
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, storage: env.STORAGE_DRIVER, time: new Date().toISOString() });
    }),
  );

  app.get(
    '/api/site',
    limiters.read,
    publicCache(60),
    asyncHandler(async (_req, res) => {
      res.json({ settings: await getSiteSettings() });
    }),
  );

  app.use('/api/resources', resourcesRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/tutorials', tutorialsRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/download', downloadRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/updates', changelogRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/requests', requestsRouter);

  app.use('/api/admin/uploads', uploadsRouter);
  app.use('/api/admin/resources', requireAdmin, adminResourcesRouter);
  app.use('/api/admin/taxonomy', requireAdmin, adminTaxonomyRouter);
  app.use('/api/admin/tutorials', requireAdmin, adminTutorialsRouter);
  app.use('/api/admin', requireAdmin, adminInsightsRouter);

  app.use('/', seoRouter);

  // Unknown API routes are a JSON 404, never the SPA shell.
  app.use('/api', notFoundHandler);

  mountFrontend(app);

  app.use(errorHandler);
  return app;
}

/**
 * Serves the built frontend and injects real per-page metadata into the shell
 * (PRD §29). Crawlers and link unfurlers get correct titles, descriptions,
 * OG/Twitter cards, canonicals and JSON-LD without adopting a heavier
 * framework than this product needs.
 */
function mountFrontend(app: Express): void {
  const distDir = path.resolve(process.cwd(), '../frontend/dist');
  const indexPath = path.join(distDir, 'index.html');

  if (!existsSync(indexPath)) {
    logger.warn({ distDir }, 'frontend build not found, serving the API only');
    return;
  }

  // Content-hashed assets can be cached forever; everything else revalidates.
  // The build emits `name-<hash>.ext` (Vite's base64url-ish hash), so this
  // matches on that separator and character set rather than a dotted hex hash.
  const HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|webp|avif|svg)$/;

  app.use(
    express.static(distDir, {
      index: false,
      setHeaders(res, filePath) {
        if (HASHED_ASSET.test(path.basename(filePath))) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=300');
        }
      },
    }),
  );

  // The shell is read once in production, where it cannot change while the
  // process runs. In development it is re-read when the file changes, so a
  // rebuild does not leave the server serving stale asset hashes.
  let cached = { mtimeMs: 0, html: '' };
  const readTemplate = (): string => {
    if (env.isProduction) {
      if (!cached.html) cached = { mtimeMs: 0, html: readFileSync(indexPath, 'utf8') };
      return cached.html;
    }
    const { mtimeMs } = statSync(indexPath);
    if (mtimeMs !== cached.mtimeMs) {
      cached = { mtimeMs, html: readFileSync(indexPath, 'utf8') };
    }
    return cached.html;
  };

  app.get(
    '*',
    asyncHandler(async (req, res) => {
      const [meta, settings] = await Promise.all([resolvePageMeta(req.path), getSiteSettings()]);
      const html = injectMeta(readTemplate(), meta, settings);
      res
        .status(meta.status ?? 200)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .setHeader('Cache-Control', req.user ? 'private, no-store' : 'public, max-age=0, s-maxage=60')
        .send(html);
    }),
  );
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function injectMeta(
  template: string,
  meta: ReturnType<typeof Object> & Awaited<ReturnType<typeof resolvePageMeta>>,
  settings: SiteSettings,
): string {
  const image = meta.image ?? `${env.PUBLIC_SITE_URL.replace(/\/$/, '')}/og-default.png`;
  const tags = [
    `<title>${escapeAttr(meta.title)}</title>`,
    `<meta name="description" content="${escapeAttr(meta.description)}" />`,
    `<link rel="canonical" href="${escapeAttr(meta.canonical)}" />`,
    meta.noindex ? '<meta name="robots" content="noindex,follow" />' : '<meta name="robots" content="index,follow" />',
    `<meta property="og:title" content="${escapeAttr(meta.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(meta.description)}" />`,
    `<meta property="og:type" content="${escapeAttr(meta.ogType)}" />`,
    `<meta property="og:url" content="${escapeAttr(meta.canonical)}" />`,
    `<meta property="og:image" content="${escapeAttr(image)}" />`,
    `<meta property="og:site_name" content="Cyriq VFX" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeAttr(image)}" />`,
    meta.jsonLd
      ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c')}</script>`
      : '',
  ]
    .filter(Boolean)
    .join('\n    ');

  // A crawler-visible summary so the page is never an empty div before JS runs.
  const noscript =
    meta.heading || meta.bodyText
      ? `<noscript><article><h1>${escapeAttr(meta.heading ?? meta.title)}</h1><p>${escapeAttr(
          (meta.bodyText ?? meta.description).slice(0, 600),
        )}</p></article></noscript>`
      : '';

  // The owner's copy travels in the shell, so the first render already has the
  // real headline rather than a built-in placeholder that a later fetch
  // replaces. That removes both the flash of default text and the layout shift
  // it caused whenever the two differed in length.
  const bootstrap = `<script type="application/json" id="site-settings">${JSON.stringify(
    settings,
  ).replace(/</g, '\\u003c')}</script>`;

  return template
    .replace(/<title>.*?<\/title>/s, '')
    .replace('<!--seo-->', tags)
    .replace('<!--bootstrap-->', bootstrap)
    .replace('<!--noscript-->', noscript);
}
