import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler, limiters, validate, validatedQuery } from '../middleware/index.js';
import { requireAuth, destroySession } from '../middleware/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { resourceCardSelect, toResourceCard } from '../modules/dto.js';
import { privateNoStore } from '../middleware/cache.js';
import { unreadCount } from '../modules/notifications.js';

export const meRouter = Router();
meRouter.use(privateNoStore);

/**
 * Identity probe. Every page load calls this, including a guest's, so it
 * answers 200 with a null user rather than 401, because "not signed in" is a normal
 * answer here, not a failure.
 */
meRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user) {
      return res.json({
        user: null,
        counts: { downloads: 0, saved: 0, unread: 0 },
        emailVerified: false,
        preference: null,
      });
    }
    const [downloads, saved, unread, preference] = await Promise.all([
      prisma.downloadEvent.count({ where: { userId: user.id } }),
      prisma.savedResource.count({ where: { userId: user.id } }),
      unreadCount(user.id),
      prisma.notificationPreference.findUnique({ where: { userId: user.id } }),
    ]);
    res.json({
      user,
      counts: { downloads, saved, unread },
      emailVerified: !!user.emailVerifiedAt,
      preference: preference ?? null,
    });
  }),
);

// Everything below this point requires a signed-in user.
meRouter.use(requireAuth);

/** Account overview (PRD §18). Deliberately small. No vanity widgets. */
meRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;

    const [totalDownloads, savedCount, recentRows, savedRows] = await Promise.all([
      prisma.downloadEvent.count({ where: { userId } }),
      prisma.savedResource.count({ where: { userId } }),
      prisma.downloadEvent.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        distinct: ['resourceId'],
        take: 5,
        include: {
          version: { select: { version: true } },
          resource: { select: resourceCardSelect },
        },
      }),
      prisma.savedResource.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 4,
        include: { resource: { select: resourceCardSelect } },
      }),
    ]);

    const recent = recentRows.map((d) => ({
      ...toResourceCard(d.resource),
      downloadedAt: d.createdAt.toISOString(),
      downloadedVersion: d.version?.version ?? null,
      currentVersion: d.resource.currentVersion?.version ?? null,
      updateAvailable:
        !!d.version?.version &&
        !!d.resource.currentVersion?.version &&
        d.version.version !== d.resource.currentVersion.version,
    }));

    res.json({
      counts: { downloads: totalDownloads, saved: savedCount },
      recentDownloads: recent,
      updatesAvailable: recent.filter((r) => r.updateAvailable),
      saved: savedRows.map((s) => toResourceCard(s.resource)),
    });
  }),
);

/** Download history (PRD §19). One row per resource, newest first. */
const historyQuery = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
});

meRouter.get(
  '/downloads',
  validate(historyQuery, 'query'),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const q = validatedQuery<z.infer<typeof historyQuery>>(req);

    const where = {
      userId,
      ...(q.q ? { resource: { title: { contains: q.q, mode: 'insensitive' as const } } } : {}),
    };

    // distinct on resourceId keeps history readable when a file is re-downloaded.
    const [rows, allDistinct] = await Promise.all([
      prisma.downloadEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        distinct: ['resourceId'],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
        include: {
          version: { select: { version: true } },
          resource: { select: resourceCardSelect },
        },
      }),
      prisma.downloadEvent.findMany({
        where,
        distinct: ['resourceId'],
        select: { resourceId: true },
      }),
    ]);

    const total = allDistinct.length;

    res.json({
      items: rows.map((d) => ({
        ...toResourceCard(d.resource),
        downloadedAt: d.createdAt.toISOString(),
        downloadedVersion: d.version?.version ?? null,
        currentVersion: d.resource.currentVersion?.version ?? null,
        updateAvailable:
          !!d.version?.version &&
          !!d.resource.currentVersion?.version &&
          d.version.version !== d.resource.currentVersion.version,
      })),
      page: q.page,
      perPage: q.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.perPage)),
      hasMore: q.page * q.perPage < total,
    });
  }),
);

/** Saved resources (PRD §20). */
meRouter.get(
  '/saved',
  validate(historyQuery, 'query'),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const q = validatedQuery<z.infer<typeof historyQuery>>(req);
    const where = {
      userId,
      ...(q.q ? { resource: { title: { contains: q.q, mode: 'insensitive' as const } } } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.savedResource.count({ where }),
      prisma.savedResource.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
        include: { resource: { select: resourceCardSelect } },
      }),
    ]);

    res.json({
      items: rows.map((s) => ({ ...toResourceCard(s.resource), savedAt: s.createdAt.toISOString() })),
      page: q.page,
      perPage: q.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.perPage)),
      hasMore: q.page * q.perPage < total,
    });
  }),
);

meRouter.put(
  '/saved/:resourceId',
  limiters.write,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { resourceId } = req.params;

    const resource = await prisma.resource.findUnique({
      where: { id: resourceId },
      select: { id: true, status: true },
    });
    if (!resource || resource.status === 'DRAFT' || resource.status === 'ARCHIVED') {
      throw notFound('That resource does not exist.');
    }

    const existing = await prisma.savedResource.findUnique({
      where: { userId_resourceId: { userId, resourceId } },
    });
    if (existing) return res.json({ saved: true });

    await prisma.$transaction([
      prisma.savedResource.create({ data: { userId, resourceId } }),
      prisma.resource.update({ where: { id: resourceId }, data: { saveCount: { increment: 1 } } }),
    ]);
    res.json({ saved: true });
  }),
);

meRouter.delete(
  '/saved/:resourceId',
  limiters.write,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { resourceId } = req.params;
    const existing = await prisma.savedResource.findUnique({
      where: { userId_resourceId: { userId, resourceId } },
    });
    if (!existing) return res.json({ saved: false });

    await prisma.$transaction([
      prisma.savedResource.delete({ where: { userId_resourceId: { userId, resourceId } } }),
      prisma.resource.update({
        where: { id: resourceId },
        data: { saveCount: { decrement: 1 } },
      }),
    ]);
    res.json({ saved: false });
  }),
);

/** Notifications (PRD §21). */
const notificationsQuery = z.object({
  unreadOnly: z.enum(['true', 'false']).default('false'),
  page: z.coerce.number().int().min(1).max(100).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
});

meRouter.get(
  '/notifications',
  validate(notificationsQuery, 'query'),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const q = validatedQuery<z.infer<typeof notificationsQuery>>(req);
    const where = { userId, ...(q.unreadOnly === 'true' ? { readAt: null } : {}) };

    const [total, unread, rows] = await Promise.all([
      prisma.notification.count({ where }),
      unreadCount(userId),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
    ]);

    res.json({
      items: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        read: !!n.readAt,
        createdAt: n.createdAt.toISOString(),
      })),
      unread,
      total,
      page: q.page,
      hasMore: q.page * q.perPage < total,
    });
  }),
);

meRouter.post(
  '/notifications/:id/read',
  limiters.write,
  asyncHandler(async (req, res) => {
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      const exists = await prisma.notification.findFirst({
        where: { id: req.params.id, userId: req.user!.id },
        select: { id: true },
      });
      if (!exists) throw notFound('That notification does not exist.');
    }
    res.json({ ok: true, unread: await unreadCount(req.user!.id) });
  }),
);

meRouter.post(
  '/notifications/read-all',
  limiters.write,
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ ok: true, unread: 0 });
  }),
);

/** Preferences (PRD §21). */
const preferencesSchema = z.object({
  enabled: z.boolean(),
  newResource: z.boolean(),
  resourceUpdates: z.boolean(),
  tutorials: z.boolean(),
  announcements: z.boolean(),
  emailEnabled: z.boolean(),
  categoryIds: z.array(z.string().cuid()).max(40),
});

meRouter.get(
  '/preferences',
  asyncHandler(async (req, res) => {
    const pref = await prisma.notificationPreference.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id },
      update: {},
    });
    res.json({ preference: pref });
  }),
);

meRouter.patch(
  '/preferences',
  limiters.write,
  validate(preferencesSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof preferencesSchema>;

    if (body.emailEnabled && !req.user!.emailVerifiedAt) {
      throw badRequest('Confirm your email address before turning on email notifications.');
    }
    if (body.categoryIds.length) {
      const count = await prisma.category.count({ where: { id: { in: body.categoryIds } } });
      if (count !== body.categoryIds.length) throw badRequest('One of those categories no longer exists.');
    }

    const pref = await prisma.notificationPreference.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id, ...body },
      update: body,
    });
    res.json({ preference: pref });
  }),
);

/** Profile (PRD §17). */
const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter a display name.').max(50),
});

meRouter.patch(
  '/profile',
  limiters.write,
  validate(profileSchema),
  asyncHandler(async (req, res) => {
    const { displayName } = req.body as z.infer<typeof profileSchema>;
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { displayName },
    });
    const { passwordHash: _ph, ...safe } = user;
    res.json({ user: safe });
  }),
);

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    password: z.string().min(10, 'Use at least 10 characters.').max(200),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Those passwords do not match.',
    path: ['confirmPassword'],
  });

meRouter.post(
  '/change-password',
  limiters.auth,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof changePasswordSchema>;
    const full = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(full.passwordHash, body.currentPassword))) {
      throw badRequest('That current password is not right.', [
        { field: 'currentPassword', message: 'That current password is not right.' },
      ]);
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: full.id },
        data: { passwordHash: await hashPassword(body.password) },
      }),
      // Keep the current session, drop every other one.
      prisma.session.deleteMany({ where: { userId: full.id, id: { not: req.sessionId } } }),
    ]);
    res.json({ ok: true, message: 'Password updated. Other sessions have been signed out.' });
  }),
);

/** Active sessions, so a user can revoke a device (PRD §17). */
meRouter.get(
  '/sessions',
  asyncHandler(async (req, res) => {
    const sessions = await prisma.session.findMany({
      where: { userId: req.user!.id, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, createdAt: true, lastUsedAt: true, userAgent: true },
    });
    res.json({
      items: sessions.map((s) => ({
        id: s.id,
        current: s.id === req.sessionId,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        userAgent: s.userAgent,
      })),
    });
  }),
);

meRouter.delete(
  '/sessions/:id',
  limiters.write,
  asyncHandler(async (req, res) => {
    await prisma.session.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
    res.json({ ok: true });
  }),
);

/** Account deletion (PRD §17, §63). */
const deleteSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm.'),
  confirm: z.literal('DELETE', { errorMap: () => ({ message: 'Type DELETE to confirm.' }) }),
});

meRouter.post(
  '/delete',
  limiters.auth,
  validate(deleteSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof deleteSchema>;
    const full = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(full.passwordHash, body.password))) {
      throw badRequest('That password is not right.');
    }
    // Cascades remove sessions, saves, notifications and preferences. Download
    // events survive with a null user so aggregate counts stay honest.
    await prisma.user.delete({ where: { id: full.id } });
    await destroySession(req, res);
    res.json({ ok: true, message: 'Your account has been deleted.' });
  }),
);
