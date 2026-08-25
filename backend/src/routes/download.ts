import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler, limiters, validate, validatedQuery } from '../middleware/index.js';
import { gone, notFound } from '../lib/errors.js';
import { storage } from '../lib/storage/index.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { formatBytes } from '../lib/fileValidation.js';
import { privateNoStore } from '../middleware/cache.js';

export const downloadRouter = Router();

/**
 * Public, shareable download endpoint (PRD §15, §16, §30).
 *
 * The token in the URL is a stable public identifier. It is permanent and
 * safe to post publicly. It reveals nothing about the storage layout. The
 * short-lived R2 URL we hand back is a bearer grant, never logged and never
 * used as the canonical share URL. Guests are never asked to sign up.
 */

const query = z.object({
  /** Optional: download a specific historical version. */
  version: z.string().trim().max(40).optional(),
});

function deviceClassOf(userAgent: string | undefined): string {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'tablet';
  if (/mobi|android|iphone/.test(ua)) return 'mobile';
  if (/bot|crawler|spider/.test(ua)) return 'bot';
  return 'desktop';
}

downloadRouter.get(
  '/:token',
  limiters.download,
  validate(query, 'query'),
  privateNoStore,
  asyncHandler(async (req, res) => {
    const { version: versionLabel } = validatedQuery<z.infer<typeof query>>(req);

    const resource = await prisma.resource.findUnique({
      where: { publicDownloadToken: req.params.token },
      include: { currentVersion: true, versions: { where: { retired: false } } },
    });

    if (!resource) throw notFound('That download link is not valid.');

    // Published and unlisted resources download; drafts/archives do not.
    if (resource.status === 'ARCHIVED') {
      throw gone('That resource has been retired and is no longer available.');
    }
    if (resource.status !== 'PUBLISHED' && resource.status !== 'UNLISTED') {
      if (req.user?.role !== 'ADMIN') throw notFound('That download link is not valid.');
    }

    const target = versionLabel
      ? resource.versions.find((v) => v.version === versionLabel)
      : resource.currentVersion;

    if (!target) {
      throw notFound(
        versionLabel
          ? `Version ${versionLabel} is not available for download.`
          : 'This resource does not have a downloadable file yet.',
      );
    }

    // Verify the object really exists before promising a download.
    const head = await storage.head(target.objectKey);
    if (!head) {
      logger.error(
        { resourceId: resource.id, versionId: target.id },
        'stored object missing for published version',
      );
      throw gone('That file is temporarily unavailable. We have been notified.');
    }

    const signed = await storage.signDownload({
      key: target.objectKey,
      downloadFilename: target.originalName,
      contentType: target.contentType,
      expiresInSeconds: env.DOWNLOAD_URL_TTL_SECONDS,
    });

    // De-duplicate: repeated clicks within the window are one meaningful
    // download (PRD §39), but the user still gets their file.
    const DEDUPE_WINDOW_MS = 30 * 60 * 1000;
    const recent = await prisma.downloadEvent.findFirst({
      where: {
        resourceId: resource.id,
        sessionKey: req.visitorKey,
        createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
      },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.downloadEvent.create({
        data: {
          resourceId: resource.id,
          versionId: target.id,
          userId: req.user?.id ?? null,
          sessionKey: req.visitorKey,
          status: 'ISSUED',
          deviceClass: deviceClassOf(req.get('user-agent')),
          referrer: req.get('referer')?.slice(0, 200) ?? null,
          country: (req.get('cf-ipcountry') ?? undefined)?.slice(0, 2),
        },
      });
      if (!recent) {
        await tx.resource.update({
          where: { id: resource.id },
          data: { downloadCount: { increment: 1 } },
        });
      }
    });

    res.json({
      url: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
      filename: target.originalName,
      size: Number(target.fileSize),
      sizeLabel: formatBytes(Number(target.fileSize)),
      version: target.version,
      checksum: target.checksum,
      resource: { title: resource.title, slug: resource.slug },
      /** Guests see a non-blocking nudge after the file starts (PRD §16). */
      suggestAccount: !req.user,
    });
  }),
);

/** Metadata for a share link without recording a download. */
downloadRouter.get(
  '/:token/info',
  limiters.read,
  privateNoStore,
  asyncHandler(async (req, res) => {
    const resource = await prisma.resource.findUnique({
      where: { publicDownloadToken: req.params.token },
      select: {
        title: true,
        slug: true,
        shortDescription: true,
        status: true,
        currentVersion: { select: { version: true, fileSize: true, originalName: true } },
      },
    });
    if (!resource) throw notFound('That download link is not valid.');
    if (resource.status === 'ARCHIVED') throw gone('That resource has been retired.');
    res.json({
      title: resource.title,
      slug: resource.slug,
      shortDescription: resource.shortDescription,
      version: resource.currentVersion?.version ?? null,
      filename: resource.currentVersion?.originalName ?? null,
      size: resource.currentVersion ? Number(resource.currentVersion.fileSize) : null,
      sizeLabel: resource.currentVersion
        ? formatBytes(Number(resource.currentVersion.fileSize))
        : null,
    });
  }),
);
