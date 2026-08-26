import { prisma } from '../db/prisma.js';
import { storage } from '../lib/storage/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Moves a completed upload out of staging and onto its final, deterministic
 * object key (PRD §37). Staging keys are never referenced by content rows, so
 * an abandoned upload can be cleaned up without touching live data.
 */
export async function promoteUpload(input: {
  uploadSessionId: string;
  adminId: string;
  targetKey: string;
  expectedPurpose?: string | string[];
}): Promise<{
  objectKey: string;
  originalName: string;
  contentType: string;
  size: number;
  checksum: string | null;
}> {
  const session = await prisma.uploadSession.findUnique({ where: { id: input.uploadSessionId } });
  if (!session || session.createdBy !== input.adminId) {
    throw notFound('That upload session does not exist.');
  }
  if (session.status !== 'COMPLETED') {
    throw badRequest('That upload has not finished yet.');
  }
  if (input.expectedPurpose) {
    const allowed = Array.isArray(input.expectedPurpose) ? input.expectedPurpose : [input.expectedPurpose];
    if (!allowed.includes(session.purpose)) {
      throw badRequest(`That upload was made for "${session.purpose}" and cannot be used here.`);
    }
  }

  const bytes = await storage.getBytes(session.objectKey);
  if (!bytes) throw badRequest('That uploaded file is no longer available. Upload it again.');

  await storage.putBytes({
    key: input.targetKey,
    body: bytes,
    contentType: session.contentType,
  });
  // Best-effort cleanup of the staging copy; the cleanup job catches leftovers.
  await storage.delete(session.objectKey).catch((err) =>
    logger.warn({ err, key: session.objectKey }, 'staging cleanup failed'),
  );

  return {
    objectKey: input.targetKey,
    originalName: session.originalName,
    contentType: session.contentType,
    size: bytes.length,
    checksum: session.checksum,
  };
}
