import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler, limiters, validate } from '../middleware/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { storage, objectKeys, sanitizeFilename } from '../lib/storage/index.js';
import {
  validateUploadRequest,
  verifyFileSignature,
  inspectZipEntries,
  extensionOf,
  maxBytesFor,
  allowedExtensionsFor,
  formatBytes,
  type AssetPurpose,
} from '../lib/fileValidation.js';
import { env } from '../config/env.js';
import { sha256 } from '../lib/crypto.js';
import { recordAudit } from '../modules/audit.js';
import { privateNoStore } from '../middleware/cache.js';
import { logger } from '../lib/logger.js';

export const uploadsRouter = Router();
uploadsRouter.use(privateNoStore, requireAdmin);

/**
 * Admin upload workflow (PRD §35, §36, §38).
 *
 * The browser uploads directly to R2 with a short-lived signed URL, so large
 * files never pass through this process. Every session is tracked in Postgres
 * so an interrupted upload can be resumed or reconciled, and abandoned ones
 * are cleaned up by a background job.
 */

const PURPOSES = ['resource-file', 'thumbnail', 'preview', 'tutorial-media', 'site-asset'] as const;

const createSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(150),
  size: z.number().int().positive(),
  purpose: z.enum(PURPOSES),
  /** Optional SHA-256 the client computed, used for duplicate detection. */
  checksum: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});

uploadsRouter.get(
  '/constraints',
  asyncHandler(async (_req, res) => {
    res.json({
      purposes: Object.fromEntries(
        PURPOSES.map((p) => [
          p,
          {
            maxBytes: maxBytesFor(p as AssetPurpose),
            maxBytesLabel: formatBytes(maxBytesFor(p as AssetPurpose)),
            extensions: allowedExtensionsFor(p as AssetPurpose),
          },
        ]),
      ),
      multipartThreshold: env.MULTIPART_THRESHOLD_BYTES,
    });
  }),
);

uploadsRouter.post(
  '/',
  limiters.upload,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;

    // Server-side validation. The browser's word is never enough (PRD §36).
    validateUploadRequest({
      filename: body.filename,
      contentType: body.contentType,
      size: body.size,
      purpose: body.purpose,
    });

    // Duplicate detection warns, never silently overwrites (PRD §87).
    let duplicateOf: { resourceId: string; title: string; version: string } | null = null;
    if (body.checksum) {
      const existing = await prisma.resourceVersion.findFirst({
        where: { checksum: body.checksum.toLowerCase() },
        include: { resource: { select: { id: true, title: true } } },
      });
      if (existing) {
        duplicateOf = {
          resourceId: existing.resource.id,
          title: existing.resource.title,
          version: existing.version,
        };
      }
    }

    const session = await prisma.uploadSession.create({
      data: {
        // Keys are generated server-side; the original name is display-only.
        objectKey: 'pending',
        originalName: sanitizeFilename(body.filename),
        contentType: body.contentType,
        declaredSize: BigInt(body.size),
        purpose: body.purpose,
        checksum: body.checksum?.toLowerCase(),
        createdBy: req.user!.id,
        multipart: body.size >= env.MULTIPART_THRESHOLD_BYTES,
      },
    });

    const objectKey = objectKeys.staging(session.id);
    await prisma.uploadSession.update({ where: { id: session.id }, data: { objectKey } });

    if (session.multipart) {
      const init = await storage.createMultipartUpload({
        key: objectKey,
        contentType: body.contentType,
      });
      await prisma.uploadSession.update({
        where: { id: session.id },
        data: { uploadId: init.uploadId, status: 'UPLOADING' },
      });
      const partCount = Math.ceil(body.size / init.partSize);
      return res.status(201).json({
        uploadSessionId: session.id,
        mode: 'multipart',
        partSize: init.partSize,
        partCount,
        duplicateOf,
      });
    }

    const signed = await storage.signUpload({
      key: objectKey,
      contentType: body.contentType,
      contentLength: body.size,
    });
    await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'UPLOADING' } });

    res.status(201).json({
      uploadSessionId: session.id,
      mode: 'single',
      url: signed.url,
      headers: signed.headers,
      expiresAt: signed.expiresAt.toISOString(),
      duplicateOf,
    });
  }),
);

const partSchema = z.object({ partNumber: z.number().int().min(1).max(10000) });

uploadsRouter.post(
  '/:id/part',
  limiters.upload,
  validate(partSchema),
  asyncHandler(async (req, res) => {
    const { partNumber } = req.body as z.infer<typeof partSchema>;
    const session = await prisma.uploadSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.createdBy !== req.user!.id) throw notFound('That upload session does not exist.');
    if (!session.multipart || !session.uploadId) throw badRequest('That upload is not a multipart upload.');
    if (session.status === 'COMPLETED') throw conflict('That upload is already complete.');
    if (session.status === 'ABORTED') throw conflict('That upload was cancelled.');

    const signed = await storage.signUploadPart({
      key: session.objectKey,
      uploadId: session.uploadId,
      partNumber,
    });
    res.json({
      partNumber,
      url: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
    });
  }),
);

const completeSchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1).max(200) }))
    .optional(),
});

uploadsRouter.post(
  '/:id/complete',
  limiters.upload,
  validate(completeSchema),
  asyncHandler(async (req, res) => {
    const { parts } = req.body as z.infer<typeof completeSchema>;
    const session = await prisma.uploadSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.createdBy !== req.user!.id) throw notFound('That upload session does not exist.');
    if (session.status === 'COMPLETED') {
      return res.json({ uploadSessionId: session.id, status: 'COMPLETED', alreadyComplete: true });
    }

    if (session.multipart) {
      if (!session.uploadId) throw badRequest('That multipart upload was never started.');
      if (!parts?.length) throw badRequest('Multipart uploads must report their parts to finish.');
      await storage.completeMultipartUpload({
        key: session.objectKey,
        uploadId: session.uploadId,
        parts,
      });
    }

    // Confirm the object actually landed and matches what was declared.
    const head = await storage.head(session.objectKey);
    if (!head) {
      await prisma.uploadSession.update({
        where: { id: session.id },
        data: { status: 'FAILED' },
      });
      throw badRequest('That upload did not finish. Nothing was stored, so try again.');
    }

    const declared = Number(session.declaredSize);
    if (head.size !== declared) {
      await storage.delete(session.objectKey).catch(() => {});
      await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'FAILED' } });
      throw badRequest(
        `The uploaded file is ${formatBytes(head.size)} but ${formatBytes(declared)} was expected. The upload was incomplete, so nothing was saved.`,
      );
    }

    // Signature check against the bytes that actually landed (PRD §36).
    const bytes = await storage.getBytes(session.objectKey);
    let checksum: string | undefined;
    let archiveWarning: string | undefined;
    if (bytes) {
      try {
        verifyFileSignature(bytes.subarray(0, 64), session.originalName);
      } catch (err) {
        await storage.delete(session.objectKey).catch(() => {});
        await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'FAILED' } });
        await recordAudit({
          req,
          actorLabel: req.user!.email,
          action: 'upload.rejected',
          targetType: 'uploadSession',
          targetId: session.id,
          metadata: { filename: session.originalName, reason: 'signature_mismatch' },
        });
        throw err;
      }
      checksum = sha256(bytes);

      if (['.zip', '.zxp', '.ffx', '.mogrt', '.drfx'].includes(extensionOf(session.originalName))) {
        const { entries, suspicious } = inspectZipEntries(bytes);
        if (suspicious.length) {
          await storage.delete(session.objectKey).catch(() => {});
          await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'FAILED' } });
          await recordAudit({
            req,
            actorLabel: req.user!.email,
            action: 'upload.rejected',
            targetType: 'uploadSession',
            targetId: session.id,
            metadata: { filename: session.originalName, reason: 'unsafe_archive_paths', suspicious: suspicious.slice(0, 5) },
          });
          throw badRequest(
            `That archive contains unsafe paths (${suspicious.slice(0, 2).join(', ')}). It was not saved.`,
          );
        }
        if (entries.length === 0) archiveWarning = 'This archive appears to be empty.';
      }
    } else {
      logger.warn({ sessionId: session.id }, 'could not read uploaded bytes for verification');
    }

    const updated = await prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'COMPLETED', completedAt: new Date(), checksum: checksum ?? session.checksum },
    });

    res.json({
      uploadSessionId: updated.id,
      status: 'COMPLETED',
      size: head.size,
      sizeLabel: formatBytes(head.size),
      checksum: updated.checksum,
      originalName: updated.originalName,
      warning: archiveWarning,
    });
  }),
);

uploadsRouter.post(
  '/:id/abort',
  limiters.upload,
  asyncHandler(async (req, res) => {
    const session = await prisma.uploadSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.createdBy !== req.user!.id) throw notFound('That upload session does not exist.');

    if (session.multipart && session.uploadId) {
      await storage
        .abortMultipartUpload({ key: session.objectKey, uploadId: session.uploadId })
        .catch((err) => logger.warn({ err }, 'multipart abort failed'));
    }
    await storage.delete(session.objectKey).catch(() => {});
    await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'ABORTED' } });
    res.json({ ok: true });
  }),
);

uploadsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const session = await prisma.uploadSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.createdBy !== req.user!.id) throw notFound('That upload session does not exist.');
    res.json({
      id: session.id,
      status: session.status,
      originalName: session.originalName,
      size: Number(session.declaredSize),
      multipart: session.multipart,
      checksum: session.checksum,
      purpose: session.purpose,
    });
  }),
);
