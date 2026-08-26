import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { asyncHandler, limiters } from '../middleware/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { storage, localStorageDriver } from '../lib/storage/index.js';
import { env } from '../config/env.js';

export const mediaRouter = Router();

/**
 * Public media (thumbnails, previews, covers).
 *
 * With R2 + a CDN configured, `storage.publicUrl()` points straight at the edge
 * and this route is never hit. It exists so media works with no CDN in front,
 * and it only serves keys that a public row actually references, so a key from
 * the URL can never reach an arbitrary object.
 */

const MEDIA_PREFIXES = ['resources/', 'tutorials/', 'site/'];

async function keyIsPubliclyReferenced(key: string): Promise<boolean> {
  if (!MEDIA_PREFIXES.some((p) => key.startsWith(p))) return false;
  // Version files are downloads, not media, so they never stream from here.
  if (key.includes('/versions/')) return false;

  const [resource, tutorial] = await Promise.all([
    prisma.resource.findFirst({
      where: {
        status: { in: ['PUBLISHED', 'UNLISTED'] },
        OR: [
          { thumbnailKey: key },
          { previewKey: key },
          { previewPosterKey: key },
          { previewBeforeKey: key },
          { previewAfterKey: key },
          { ogImageKey: key },
          { galleryItems: { some: { objectKey: key } } },
        ],
      },
      select: { id: true },
    }),
    prisma.tutorial.findFirst({
      where: {
        status: { in: ['PUBLISHED', 'UNLISTED'] },
        OR: [{ coverKey: key }, { videoKey: key }, { ogImageKey: key }],
      },
      select: { id: true },
    }),
  ]);
  return !!resource || !!tutorial;
}

mediaRouter.get(
  '/:key(*)',
  limiters.read,
  asyncHandler(async (req, res) => {
    const key = decodeURIComponent(req.params.key);
    if (!(await keyIsPubliclyReferenced(key))) throw notFound('That media does not exist.');

    const bytes = await storage.getBytes(key);
    if (!bytes) throw notFound('That media does not exist.');

    const contentType =
      (await localStorageDriver?.contentTypeOf(key)) ??
      (await storage.head(key))?.contentType ??
      'application/octet-stream';

    // Media is immutable per key; keys change when the file is replaced.
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=31536000, immutable');
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Range support so video previews scrub without downloading the whole file.
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : bytes.length - 1;
        if (start >= bytes.length || end >= bytes.length || start > end) {
          res.setHeader('Content-Range', `bytes */${bytes.length}`);
          return res.status(416).end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', String(end - start + 1));
        return res.end(bytes.subarray(start, end + 1));
      }
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(bytes.length));
    res.end(bytes);
  }),
);

/**
 * Signed-URL endpoint for the local storage driver only. It exists so the
 * upload/download code paths that presign against R2 in production are
 * exercised identically in development and tests.
 */
export const localStorageRouter = Router();

/**
 * Answer CORS preflights the way R2 does when its bucket CORS is configured.
 * A signed PUT carries Content-Type, which is enough to make the browser
 * preflight whenever the upload is cross-origin.
 */
localStorageRouter.options('/', (req, res) => {
  const origin = req.get('origin');
  if (origin && env.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'PUT, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  res.status(204).end();
});

localStorageRouter.all(
  '/',
  asyncHandler(async (req, res) => {
    if (!localStorageDriver) throw notFound('Not available.');

    // The browser must be able to read the ETag to finish a multipart upload.
    const origin = req.get('origin');
    if (origin && env.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Expose-Headers', 'ETag');
    }
    const params = new URLSearchParams(req.url.split('?')[1] ?? '');
    const verified = localStorageDriver.verify(params);
    if (!verified) throw badRequest('That link is invalid or has expired.');

    if (req.method === 'PUT' && verified.op === 'put') {
      const body = await readBody(req);
      const declared = Number(params.get('len') ?? 0);
      if (declared && body.length !== declared) {
        throw badRequest('Uploaded body length did not match the signed length.');
      }
      await localStorageDriver.putBytes({
        key: verified.key,
        body,
        contentType: params.get('ct') ?? 'application/octet-stream',
      });
      res.setHeader('ETag', `"${body.length}"`);
      return res.status(200).end();
    }

    if (req.method === 'PUT' && verified.op === 'part') {
      const body = await readBody(req);
      const etag = await localStorageDriver.writePart(
        verified.uploadId!,
        Number(verified.partNumber),
        body,
      );
      res.setHeader('ETag', `"${etag}"`);
      return res.status(200).end();
    }

    if (req.method === 'GET' && verified.op === 'get') {
      const bytes = await localStorageDriver.getBytes(verified.key);
      if (!bytes) throw notFound('That file is no longer available.');
      const filename = params.get('fn');
      if (filename) {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      }
      res.setHeader('Content-Type', params.get('ct') ?? 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');

      const range = req.headers.range;
      const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : bytes.length - 1;
        if (start >= bytes.length || start > end) {
          res.setHeader('Content-Range', `bytes */${bytes.length}`);
          return res.status(416).end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
        res.setHeader('Content-Length', String(end - start + 1));
        return res.end(bytes.subarray(start, end + 1));
      }
      res.setHeader('Content-Length', String(bytes.length));
      return res.end(bytes);
    }

    throw badRequest('Unsupported storage operation.');
  }),
);

function readBody(req: import('express').Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > env.MAX_UPLOAD_BYTES) {
        reject(badRequest('That upload is larger than the configured limit.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
