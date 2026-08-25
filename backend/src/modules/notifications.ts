import type { NotificationType } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import { sendEmail } from './email.js';

/**
 * Notification fan-out (PRD §21, §22).
 *
 * Every send respects the recipient's preferences, and update notices only go
 * to people who actually downloaded the resource. Nobody gets mail they did
 * not ask for.
 */

interface FanoutInput {
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  /** Restricts a NEW_RESOURCE fan-out to users watching this category. */
  categoryId?: string;
  /** Restricts RESOURCE_UPDATED to prior downloaders of this resource. */
  resourceId?: string;
}

function preferenceField(type: NotificationType) {
  switch (type) {
    case 'NEW_RESOURCE':
      return 'newResource' as const;
    case 'RESOURCE_UPDATED':
      return 'resourceUpdates' as const;
    case 'TUTORIAL_PUBLISHED':
      return 'tutorials' as const;
    case 'ANNOUNCEMENT':
      return 'announcements' as const;
  }
}

export async function fanOutNotification(input: FanoutInput): Promise<number> {
  const field = preferenceField(input.type);

  let candidateIds: string[] | undefined;
  if (input.type === 'RESOURCE_UPDATED' && input.resourceId) {
    // Only notify people who downloaded this resource before.
    const downloaders = await prisma.downloadEvent.findMany({
      where: { resourceId: input.resourceId, userId: { not: null } },
      select: { userId: true },
      distinct: ['userId'],
    });
    candidateIds = downloaders.map((d) => d.userId!).filter(Boolean);
    if (candidateIds.length === 0) return 0;
  }

  const prefs = await prisma.notificationPreference.findMany({
    where: {
      enabled: true,
      [field]: true,
      ...(candidateIds ? { userId: { in: candidateIds } } : {}),
      user: { status: 'ACTIVE' },
    },
    include: { user: { select: { id: true, email: true, displayName: true } } },
  });

  const recipients = prefs.filter((p) => {
    // An empty category list means "everything"; a non-empty one is a filter
    // that applies only to new-resource notices.
    if (input.type !== 'NEW_RESOURCE') return true;
    if (!input.categoryId || p.categoryIds.length === 0) return true;
    return p.categoryIds.includes(input.categoryId);
  });

  if (recipients.length === 0) return 0;

  await prisma.notification.createMany({
    data: recipients.map((p) => ({
      userId: p.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
    })),
  });

  const emailRecipients = recipients.filter((p) => p.emailEnabled && p.user.email);
  for (const r of emailRecipients) {
    sendEmail({
      to: r.user.email,
      subject: input.title,
      heading: input.title,
      body: input.body,
      ctaLabel: 'Open it',
      ctaPath: input.link,
    }).catch((err) => logger.error({ err }, 'notification email failed'));
  }

  logger.info(
    { type: input.type, recipients: recipients.length, emailed: emailRecipients.length },
    'notification fan-out',
  );
  return recipients.length;
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
