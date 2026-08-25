import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import { storage } from '../lib/storage/index.js';
import { fanOutNotification } from '../modules/notifications.js';
import { env } from '../config/env.js';

/**
 * Background work (PRD §72, §73). Scheduled publishing and cleanup run in this
 * process on a timer, with no queue infrastructure until something actually needs
 * it (PRD §103). Every job is idempotent and never blocks an HTTP request.
 */

const MINUTE = 60_000;

/** Publishes anything whose scheduled time has arrived. */
export async function publishScheduled(): Promise<number> {
  const now = new Date();
  const due = await prisma.resource.findMany({
    where: { status: 'SCHEDULED', scheduledFor: { lte: now }, currentVersionId: { not: null } },
    select: { id: true, title: true, slug: true, shortDescription: true, categoryId: true, publishedAt: true },
    take: 50,
  });

  for (const r of due) {
    await prisma.resource.update({
      where: { id: r.id },
      data: { status: 'PUBLISHED', publishedAt: r.publishedAt ?? now, scheduledFor: null },
    });
    await fanOutNotification({
      type: 'NEW_RESOURCE',
      title: `New: ${r.title}`,
      body: r.shortDescription,
      link: `/resources/${r.slug}`,
      categoryId: r.categoryId,
    }).catch((err) => logger.error({ err }, 'scheduled publish notification failed'));
    logger.info({ resourceId: r.id }, 'published scheduled resource');
  }

  const dueTutorials = await prisma.tutorial.findMany({
    where: { status: 'SCHEDULED', scheduledFor: { lte: now } },
    select: { id: true, title: true, slug: true, summary: true, publishedAt: true },
    take: 50,
  });
  for (const t of dueTutorials) {
    await prisma.tutorial.update({
      where: { id: t.id },
      data: { status: 'PUBLISHED', publishedAt: t.publishedAt ?? now, scheduledFor: null },
    });
    await fanOutNotification({
      type: 'TUTORIAL_PUBLISHED',
      title: `New tutorial: ${t.title}`,
      body: t.summary,
      link: `/tutorials/${t.slug}`,
    }).catch((err) => logger.error({ err }, 'scheduled tutorial notification failed'));
  }

  // A scheduled resource with no file can never publish, so surface it rather
  // than letting it sit silently past its date.
  const stuck = await prisma.resource.count({
    where: { status: 'SCHEDULED', scheduledFor: { lte: now }, currentVersionId: null },
  });
  if (stuck > 0) {
    logger.warn({ count: stuck }, 'scheduled resources are past due but have no file attached');
  }

  return due.length + dueTutorials.length;
}

/** Removes abandoned uploads so failed attempts leave nothing behind (§38). */
export async function cleanupStaleUploads(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stale = await prisma.uploadSession.findMany({
    where: { status: { in: ['PENDING', 'UPLOADING', 'FAILED'] }, createdAt: { lt: cutoff } },
    take: 100,
  });

  for (const session of stale) {
    if (session.multipart && session.uploadId) {
      await storage
        .abortMultipartUpload({ key: session.objectKey, uploadId: session.uploadId })
        .catch(() => {});
    }
    await storage.delete(session.objectKey).catch(() => {});
    await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'ABORTED' } });
  }

  // Completed-but-never-attached uploads still sit in staging.
  const orphaned = await prisma.uploadSession.findMany({
    where: { status: 'COMPLETED', completedAt: { lt: cutoff }, objectKey: { startsWith: 'staging/' } },
    take: 100,
  });
  for (const session of orphaned) {
    await storage.delete(session.objectKey).catch(() => {});
    await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'ABORTED' } });
  }

  if (stale.length || orphaned.length) {
    logger.info({ aborted: stale.length, orphaned: orphaned.length }, 'cleaned up stale uploads');
  }
  return stale.length + orphaned.length;
}

/** Expired sessions and used tokens do not need to live forever. */
export async function pruneExpiredAuth(): Promise<number> {
  const [sessions, tokens] = await Promise.all([
    prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    prisma.emailToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
          { usedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        ],
      },
    }),
  ]);
  return sessions.count + tokens.count;
}

/** Trims view rows once they have been folded into the counters. */
export async function pruneOldAnalytics(): Promise<number> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const result = await prisma.resourceView.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}

interface JobDefinition {
  name: string;
  intervalMs: number;
  run: () => Promise<number>;
}

const JOBS: JobDefinition[] = [
  { name: 'publish-scheduled', intervalMs: MINUTE, run: publishScheduled },
  { name: 'cleanup-uploads', intervalMs: 60 * MINUTE, run: cleanupStaleUploads },
  { name: 'prune-auth', intervalMs: 6 * 60 * MINUTE, run: pruneExpiredAuth },
  { name: 'prune-analytics', intervalMs: 24 * 60 * MINUTE, run: pruneOldAnalytics },
];

const timers: NodeJS.Timeout[] = [];

export function startJobs(): void {
  if (!env.JOBS_ENABLED || env.isTest) return;

  for (const job of JOBS) {
    const tick = async () => {
      try {
        const count = await job.run();
        if (count > 0) logger.info({ job: job.name, count }, 'job completed');
      } catch (err) {
        // A failing job must never take the process down.
        logger.error({ err, job: job.name }, 'job failed');
      }
    };
    const timer = setInterval(tick, job.intervalMs);
    timer.unref();
    timers.push(timer);
  }
  logger.info({ jobs: JOBS.map((j) => j.name) }, 'background jobs started');
}

export function stopJobs(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}
