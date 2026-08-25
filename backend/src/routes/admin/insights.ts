import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, limiters, validate, validatedQuery } from '../../middleware/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { recordAudit } from '../../modules/audit.js';
import { fanOutNotification } from '../../modules/notifications.js';
import { getSiteSettings, saveSiteSettings, siteSettingsSchema } from '../../modules/settings.js';
import { mediaUrl } from '../../modules/dto.js';

export const adminInsightsRouter = Router();

/**
 * Dashboard, analytics, users, reports, settings and the audit log.
 * Every number here is computed from real rows. Nothing is invented (§40, §109).
 */

const rangeQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

adminInsightsRouter.get(
  '/dashboard',
  validate(rangeQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { days } = validatedQuery<z.infer<typeof rangeQuery>>(req);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [
      resourceCount,
      publishedCount,
      totalDownloads,
      periodDownloads,
      uniqueDownloaders,
      userCount,
      newUsers,
      tutorialCount,
      openReports,
      openRequests,
      failedUploads,
      missingFiles,
    ] = await Promise.all([
      prisma.resource.count(),
      prisma.resource.count({ where: { status: 'PUBLISHED' } }),
      prisma.downloadEvent.count(),
      prisma.downloadEvent.count({ where: { createdAt: { gte: since } } }),
      prisma.downloadEvent.findMany({
        where: { createdAt: { gte: since } },
        distinct: ['sessionKey'],
        select: { sessionKey: true },
      }),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { createdAt: { gte: since } } }),
      prisma.tutorial.count({ where: { status: 'PUBLISHED' } }),
      prisma.report.count({ where: { status: 'OPEN' } }),
      prisma.resourceRequest.count({ where: { status: 'RECEIVED' } }),
      prisma.uploadSession.count({ where: { status: 'FAILED', createdAt: { gte: since } } }),
      // Published resources with no downloadable file: a real problem to fix.
      prisma.resource.count({ where: { status: 'PUBLISHED', currentVersionId: null } }),
    ]);

    // Daily download trend, zero-filled so the chart has no gaps.
    const trendRows = await prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "DownloadEvent"
      WHERE "createdAt" >= ${since}
      GROUP BY 1 ORDER BY 1 ASC
    `;
    const trendMap = new Map(
      trendRows.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.count)]),
    );
    const trend: Array<{ date: string; count: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      trend.push({ date: d, count: trendMap.get(d) ?? 0 });
    }

    const [topResources, topCategories, recentDownloads, recentSignups, recentActivity] =
      await Promise.all([
        prisma.resource.findMany({
          where: { status: 'PUBLISHED' },
          orderBy: { downloadCount: 'desc' },
          take: 8,
          select: {
            id: true,
            title: true,
            slug: true,
            downloadCount: true,
            viewCount: true,
            thumbnailKey: true,
          },
        }),
        prisma.category.findMany({
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            name: true,
            slug: true,
            resources: { where: { status: 'PUBLISHED' }, select: { downloadCount: true } },
          },
        }),
        prisma.downloadEvent.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            createdAt: true,
            deviceClass: true,
            user: { select: { username: true } },
            resource: { select: { title: true, slug: true } },
            version: { select: { version: true } },
          },
        }),
        prisma.user.findMany({
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: { id: true, username: true, displayName: true, createdAt: true, emailVerifiedAt: true },
        }),
        prisma.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: { id: true, action: true, actorLabel: true, targetType: true, metadata: true, createdAt: true },
        }),
      ]);

    res.json({
      metrics: {
        resourceCount,
        publishedCount,
        totalDownloads,
        periodDownloads,
        uniqueDownloaders: uniqueDownloaders.length,
        userCount,
        newUsers,
        tutorialCount,
        openReports,
        openRequests,
      },
      // Things that need the owner's attention, not decoration.
      attention: {
        failedUploads,
        publishedWithoutFile: missingFiles,
        openReports,
      },
      trend,
      topResources: topResources.map((r) => ({
        ...r,
        thumbnailUrl: mediaUrl(r.thumbnailKey),
        // A high-view/low-download ratio flags a weak preview or unclear license.
        conversion: r.viewCount > 0 ? Math.round((r.downloadCount / r.viewCount) * 100) : null,
      })),
      topCategories: topCategories
        .map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          downloads: c.resources.reduce((sum, r) => sum + r.downloadCount, 0),
          resourceCount: c.resources.length,
        }))
        .filter((c) => c.resourceCount > 0)
        .sort((a, b) => b.downloads - a.downloads)
        .slice(0, 6),
      recentDownloads: recentDownloads.map((d) => ({
        id: d.id,
        at: d.createdAt.toISOString(),
        who: d.user?.username ?? 'Guest',
        device: d.deviceClass,
        resource: d.resource,
        version: d.version?.version ?? null,
      })),
      recentSignups: recentSignups.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        createdAt: u.createdAt.toISOString(),
        verified: !!u.emailVerifiedAt,
      })),
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        action: a.action,
        actor: a.actorLabel,
        targetType: a.targetType,
        metadata: a.metadata,
        at: a.createdAt.toISOString(),
      })),
    });
  }),
);

/** "What do people want" (PRD §66). */
adminInsightsRouter.get(
  '/analytics',
  validate(rangeQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { days } = validatedQuery<z.infer<typeof rangeQuery>>(req);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [topSearches, emptySearches, mostViewed, mostSaved, needsAttention, deviceSplit, conversion] =
      await Promise.all([
        prisma.searchQuery.groupBy({
          by: ['query'],
          where: { createdAt: { gte: since } },
          _count: { query: true },
          orderBy: { _count: { query: 'desc' } },
          take: 12,
        }),
        prisma.searchQuery.groupBy({
          by: ['query'],
          where: { createdAt: { gte: since }, resultCount: 0 },
          _count: { query: true },
          orderBy: { _count: { query: 'desc' } },
          take: 12,
        }),
        prisma.resource.findMany({
          where: { status: 'PUBLISHED' },
          orderBy: { viewCount: 'desc' },
          take: 8,
          select: { id: true, title: true, slug: true, viewCount: true, downloadCount: true },
        }),
        prisma.resource.findMany({
          where: { status: 'PUBLISHED', saveCount: { gt: 0 } },
          orderBy: { saveCount: 'desc' },
          take: 8,
          select: { id: true, title: true, slug: true, saveCount: true },
        }),
        // High views, low downloads: the signal the PRD calls out (§66).
        prisma.resource.findMany({
          where: { status: 'PUBLISHED', viewCount: { gte: 10 } },
          select: { id: true, title: true, slug: true, viewCount: true, downloadCount: true },
          take: 100,
        }),
        prisma.downloadEvent.groupBy({
          by: ['deviceClass'],
          where: { createdAt: { gte: since } },
          _count: { deviceClass: true },
        }),
        // Did people who downloaded go on to make an account?
        prisma.downloadEvent.findMany({
          where: { createdAt: { gte: since } },
          select: { userId: true },
          distinct: ['sessionKey'],
        }),
      ]);

    const lowConversion = needsAttention
      .map((r) => ({
        ...r,
        rate: r.viewCount > 0 ? r.downloadCount / r.viewCount : 0,
      }))
      .filter((r) => r.rate < 0.15)
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, 8)
      .map((r) => ({ ...r, ratePercent: Math.round(r.rate * 100) }));

    res.json({
      topSearches: topSearches.map((s) => ({ query: s.query, count: s._count.query })),
      emptySearches: emptySearches.map((s) => ({ query: s.query, count: s._count.query })),
      mostViewed,
      mostSaved,
      lowConversion,
      deviceSplit: deviceSplit.map((d) => ({ device: d.deviceClass ?? 'unknown', count: d._count.deviceClass })),
      signedInDownloadShare: conversion.length
        ? Math.round((conversion.filter((c) => c.userId).length / conversion.length) * 100)
        : 0,
    });
  }),
);

/** Users (PRD §46). Passwords and tokens are never exposed. */
const usersQuery = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});

adminInsightsRouter.get(
  '/users',
  validate(usersQuery, 'query'),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<z.infer<typeof usersQuery>>(req);
    const where = {
      status: q.status ?? ('ACTIVE' as const),
      ...(q.q
        ? {
            OR: [
              { username: { contains: q.q, mode: 'insensitive' as const } },
              { email: { contains: q.q, mode: 'insensitive' as const } },
              { displayName: { contains: q.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          role: true,
          status: true,
          emailVerifiedAt: true,
          createdAt: true,
          suspendedReason: true,
          _count: { select: { downloads: true, saved: true } },
        },
      }),
    ]);
    res.json({
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        status: u.status,
        verified: !!u.emailVerifiedAt,
        createdAt: u.createdAt.toISOString(),
        suspendedReason: u.suspendedReason,
        downloadCount: u._count.downloads,
        savedCount: u._count.saved,
      })),
      total,
      page: q.page,
      perPage: q.perPage,
      totalPages: Math.max(1, Math.ceil(total / q.perPage)),
    });
  }),
);

const suspendSchema = z.object({
  suspended: z.boolean(),
  reason: z.string().trim().max(200).optional(),
});

adminInsightsRouter.post(
  '/users/:id/suspension',
  limiters.write,
  validate(suspendSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof suspendSchema>;
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw notFound('That user does not exist.');
    if (user.role === 'ADMIN') throw badRequest('You cannot suspend an owner account.');

    await prisma.user.update({
      where: { id: user.id },
      data: {
        status: body.suspended ? 'SUSPENDED' : 'ACTIVE',
        suspendedAt: body.suspended ? new Date() : null,
        suspendedReason: body.suspended ? (body.reason ?? null) : null,
      },
    });
    // Suspension takes effect immediately.
    if (body.suspended) await prisma.session.deleteMany({ where: { userId: user.id } });

    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: body.suspended ? 'user.suspended' : 'user.unsuspended',
      targetType: 'user',
      targetId: user.id,
      metadata: { username: user.username, reason: body.reason },
    });
    res.json({ ok: true });
  }),
);

adminInsightsRouter.delete(
  '/users/:id',
  limiters.write,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw notFound('That user does not exist.');
    if (user.role === 'ADMIN') throw badRequest('You cannot delete an owner account.');
    await prisma.user.delete({ where: { id: user.id } });
    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'user.deleted',
      targetType: 'user',
      targetId: user.id,
      metadata: { username: user.username },
    });
    res.json({ ok: true });
  }),
);

/** Reports inbox (PRD §47). */
const reportsQuery = z.object({
  status: z.enum(['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED']).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
});

adminInsightsRouter.get(
  '/reports',
  validate(reportsQuery, 'query'),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<z.infer<typeof reportsQuery>>(req);
    const where = q.status ? { status: q.status } : {};
    const [total, rows] = await Promise.all([
      prisma.report.count({ where }),
      prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * 25,
        take: 25,
        include: {
          resource: { select: { id: true, title: true, slug: true } },
          user: { select: { id: true, username: true } },
        },
      }),
    ]);
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        adminNote: r.adminNote,
        contactEmail: r.contactEmail,
        createdAt: r.createdAt.toISOString(),
        resource: r.resource,
        reportedBy: r.user?.username ?? 'Guest',
      })),
      total,
      page: q.page,
    });
  }),
);

adminInsightsRouter.patch(
  '/reports/:id',
  limiters.write,
  validate(
    z.object({
      status: z.enum(['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED']),
      adminNote: z.string().max(1000).nullable().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { status: 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED'; adminNote?: string | null };
    const report = await prisma.report.findUnique({ where: { id: req.params.id } });
    if (!report) throw notFound('That report does not exist.');
    await prisma.report.update({
      where: { id: report.id },
      data: { status: body.status, adminNote: body.adminNote ?? report.adminNote },
    });
    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'report.updated',
      targetType: 'report',
      targetId: report.id,
      metadata: { status: body.status },
    });
    res.json({ ok: true });
  }),
);

/** Requests (PRD §26). */
adminInsightsRouter.get(
  '/requests',
  asyncHandler(async (_req, res) => {
    const items = await prisma.resourceRequest.findMany({
      orderBy: [{ status: 'asc' }, { voteCount: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: { user: { select: { username: true } } },
    });
    res.json({
      items: items.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        software: r.software,
        status: r.status,
        adminNote: r.adminNote,
        voteCount: r.voteCount,
        requestedBy: r.user?.username ?? 'Guest',
        createdAt: r.createdAt.toISOString(),
      })),
    });
  }),
);

adminInsightsRouter.patch(
  '/requests/:id',
  limiters.write,
  validate(
    z.object({
      status: z.enum(['RECEIVED', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED']),
      adminNote: z.string().max(1000).nullable().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { status: 'RECEIVED' | 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED'; adminNote?: string | null };
    const request = await prisma.resourceRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw notFound('That request does not exist.');
    await prisma.resourceRequest.update({
      where: { id: request.id },
      data: { status: body.status, adminNote: body.adminNote ?? request.adminNote },
    });
    res.json({ ok: true });
  }),
);

/** Announcements (PRD §21). */
adminInsightsRouter.post(
  '/notifications',
  limiters.write,
  validate(
    z.object({
      title: z.string().trim().min(1, 'Give it a title.').max(120),
      body: z.string().trim().min(1, 'Write the message.').max(500),
      link: z.string().trim().max(300).default('/'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { title: string; body: string; link: string };
    const sent = await fanOutNotification({
      type: 'ANNOUNCEMENT',
      title: body.title,
      body: body.body,
      link: body.link || '/',
    });
    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'notification.sent',
      metadata: { title: body.title, recipients: sent },
    });
    res.json({ ok: true, recipients: sent });
  }),
);

/** Site settings (PRD §49). */
adminInsightsRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json({ settings: await getSiteSettings() });
  }),
);

adminInsightsRouter.put(
  '/settings',
  limiters.write,
  validate(siteSettingsSchema),
  asyncHandler(async (req, res) => {
    const settings = await saveSiteSettings(req.body as never);
    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'settings.changed',
      metadata: { siteName: settings.siteName },
    });
    res.json({ settings });
  }),
);

/** Audit log (PRD §48). */
adminInsightsRouter.get(
  '/audit',
  validate(
    z.object({
      action: z.string().trim().max(60).optional(),
      page: z.coerce.number().int().min(1).max(500).default(1),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<{ action?: string; page: number }>(req);
    const where = q.action ? { action: q.action } : {};
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * 50,
        take: 50,
      }),
    ]);
    res.json({
      items: rows.map((a) => ({
        id: a.id,
        action: a.action,
        actor: a.actorLabel,
        targetType: a.targetType,
        targetId: a.targetId,
        metadata: a.metadata,
        createdAt: a.createdAt.toISOString(),
      })),
      total,
      page: q.page,
      totalPages: Math.max(1, Math.ceil(total / 50)),
    });
  }),
);
