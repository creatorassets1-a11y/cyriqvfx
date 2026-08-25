import type { Request } from 'express';
import { prisma } from '../db/prisma.js';
import { hashIp } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

/** Admin actions worth recording (PRD §48). */
export type AuditAction =
  | 'admin.login'
  | 'admin.login_failed'
  | 'resource.created'
  | 'resource.updated'
  | 'resource.published'
  | 'resource.unpublished'
  | 'resource.archived'
  | 'resource.deleted'
  | 'resource.duplicated'
  | 'resource.featured'
  | 'version.created'
  | 'version.file_replaced'
  | 'version.retired'
  | 'version.made_current'
  | 'category.created'
  | 'category.updated'
  | 'category.deleted'
  | 'category.reordered'
  | 'tutorial.created'
  | 'tutorial.updated'
  | 'tutorial.published'
  | 'tutorial.deleted'
  | 'user.suspended'
  | 'user.unsuspended'
  | 'user.deleted'
  | 'notification.sent'
  | 'settings.changed'
  | 'license.created'
  | 'license.updated'
  | 'report.updated'
  | 'changelog.published'
  | 'upload.rejected';

export async function recordAudit(input: {
  req?: Request;
  actorId?: string | null;
  actorLabel: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? input.req?.user?.id ?? null,
        actorLabel: input.actorLabel,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        // Metadata is written by our own call sites and never contains secrets.
        metadata: (input.metadata ?? {}) as never,
        ipHash: hashIp(input.req?.ip),
      },
    });
  } catch (err) {
    // An audit write must never break the action it describes.
    logger.error({ err, action: input.action }, 'failed to write audit log');
  }
}
