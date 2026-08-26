import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler, limiters, validate, validatedQuery } from '../middleware/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { slugify } from '../lib/crypto.js';
import { publicCache, privateNoStore } from '../middleware/cache.js';
import { recordAudit } from '../modules/audit.js';
import { mediaUrl } from '../modules/dto.js';

export const changelogRouter = Router();
export const reportsRouter = Router();
export const requestsRouter = Router();

/** Updates / changelog (PRD §27). */
changelogRouter.get(
  '/',
  limiters.read,
  validate(z.object({ page: z.coerce.number().int().min(1).max(200).default(1) }), 'query'),
  publicCache(180),
  asyncHandler(async (req, res) => {
    const { page } = validatedQuery<{ page: number }>(req);
    const where = { status: 'PUBLISHED' as const };
    const [total, rows] = await Promise.all([
      prisma.changelogEntry.count({ where }),
      prisma.changelogEntry.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * 20,
        take: 20,
        include: {
          resources: {
            select: {
              resource: { select: { id: true, title: true, slug: true, thumbnailKey: true, status: true } },
            },
          },
          tutorials: {
            select: { tutorial: { select: { id: true, title: true, slug: true, status: true } } },
          },
        },
      }),
    ]);

    res.json({
      items: rows.map((e) => ({
        id: e.id,
        title: e.title,
        slug: e.slug,
        body: e.body,
        kind: e.kind,
        publishedAt: e.publishedAt?.toISOString() ?? null,
        resources: e.resources
          .filter((r) => r.resource.status === 'PUBLISHED')
          .map((r) => ({
            id: r.resource.id,
            title: r.resource.title,
            slug: r.resource.slug,
            thumbnailUrl: mediaUrl(r.resource.thumbnailKey),
          })),
        tutorials: e.tutorials
          .filter((t) => t.tutorial.status === 'PUBLISHED')
          .map((t) => ({ id: t.tutorial.id, title: t.tutorial.title, slug: t.tutorial.slug })),
      })),
      total,
      page,
      hasMore: page * 20 < total,
    });
  }),
);

/** Admin changelog management. */
const entryBody = z.object({
  title: z.string().trim().min(1, 'Give the update a title.').max(140),
  body: z.string().trim().min(1, 'Write the update.').max(20000),
  kind: z.enum(['RELEASE', 'UPDATE', 'SITE', 'ANNOUNCEMENT']).default('RELEASE'),
  status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT'),
  resourceIds: z.array(z.string().cuid()).max(20).default([]),
  tutorialIds: z.array(z.string().cuid()).max(20).default([]),
});

changelogRouter.get(
  '/admin/all',
  requireAdmin,
  privateNoStore,
  asyncHandler(async (_req, res) => {
    const items = await prisma.changelogEntry.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { resources: { select: { resourceId: true } }, tutorials: { select: { tutorialId: true } } },
    });
    res.json({
      items: items.map((e) => ({
        id: e.id,
        title: e.title,
        slug: e.slug,
        body: e.body,
        kind: e.kind,
        status: e.status,
        publishedAt: e.publishedAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
        resourceIds: e.resources.map((r) => r.resourceId),
        tutorialIds: e.tutorials.map((t) => t.tutorialId),
      })),
    });
  }),
);

changelogRouter.post(
  '/admin',
  requireAdmin,
  limiters.write,
  validate(entryBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof entryBody>;
    let slug = slugify(body.title) || 'update';
    for (let i = 2; await prisma.changelogEntry.findUnique({ where: { slug }, select: { id: true } }); i++) {
      slug = `${slugify(body.title)}-${i}`;
    }
    const entry = await prisma.changelogEntry.create({
      data: {
        title: body.title,
        slug,
        body: body.body,
        kind: body.kind,
        status: body.status,
        publishedAt: body.status === 'PUBLISHED' ? new Date() : null,
        resources: { create: body.resourceIds.map((resourceId) => ({ resourceId })) },
        tutorials: { create: body.tutorialIds.map((tutorialId) => ({ tutorialId })) },
      },
    });
    if (body.status === 'PUBLISHED') {
      await recordAudit({
        req,
        actorLabel: req.user!.email,
        action: 'changelog.published',
        targetType: 'changelog',
        targetId: entry.id,
        metadata: { title: entry.title },
      });
    }
    res.status(201).json({ entry });
  }),
);

changelogRouter.patch(
  '/admin/:id',
  requireAdmin,
  limiters.write,
  validate(entryBody.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof entryBody>>;
    const existing = await prisma.changelogEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('That update does not exist.');

    const entry = await prisma.changelogEntry.update({
      where: { id: existing.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.status !== undefined
          ? {
              status: body.status,
              publishedAt:
                body.status === 'PUBLISHED' && !existing.publishedAt ? new Date() : existing.publishedAt,
            }
          : {}),
      },
    });
    if (body.resourceIds) {
      await prisma.$transaction([
        prisma.changelogResource.deleteMany({ where: { entryId: entry.id } }),
        prisma.changelogResource.createMany({
          data: body.resourceIds.map((resourceId) => ({ entryId: entry.id, resourceId })),
        }),
      ]);
    }
    if (body.tutorialIds) {
      await prisma.$transaction([
        prisma.changelogTutorial.deleteMany({ where: { entryId: entry.id } }),
        prisma.changelogTutorial.createMany({
          data: body.tutorialIds.map((tutorialId) => ({ entryId: entry.id, tutorialId })),
        }),
      ]);
    }
    res.json({ entry });
  }),
);

changelogRouter.delete(
  '/admin/:id',
  requireAdmin,
  limiters.write,
  asyncHandler(async (req, res) => {
    await prisma.changelogEntry.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);

/** Reports (PRD §47). Guests may report too, so this is not auth-gated. */
const reportBody = z.object({
  resourceId: z.string().cuid().nullable().optional(),
  reason: z.enum([
    'BROKEN_RESOURCE',
    'BROKEN_DOWNLOAD',
    'INCORRECT_COMPATIBILITY',
    'LICENSING',
    'MALICIOUS_FILE',
    'COPYRIGHT',
    'OTHER',
  ]),
  details: z.string().trim().min(10, 'Tell us a little more so it can be fixed.').max(2000),
  contactEmail: z.string().email().or(z.literal('')).optional(),
});

reportsRouter.post(
  '/',
  limiters.report,
  privateNoStore,
  validate(reportBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reportBody>;
    if (body.resourceId) {
      const exists = await prisma.resource.findUnique({
        where: { id: body.resourceId },
        select: { id: true },
      });
      if (!exists) throw badRequest('That resource does not exist.');
    }
    await prisma.report.create({
      data: {
        resourceId: body.resourceId ?? null,
        userId: req.user?.id ?? null,
        reason: body.reason,
        details: body.details,
        contactEmail: body.contactEmail || null,
      },
    });
    res.status(201).json({ ok: true, message: 'Thanks, this has been sent to the owner.' });
  }),
);

/** Resource requests (PRD §26). */
requestsRouter.get(
  '/',
  limiters.read,
  publicCache(60),
  asyncHandler(async (req, res) => {
    const items = await prisma.resourceRequest.findMany({
      where: { status: { not: 'DECLINED' } },
      orderBy: [{ voteCount: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      include: {
        votes: req.user ? { where: { userId: req.user.id }, select: { userId: true } } : false,
      },
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
        createdAt: r.createdAt.toISOString(),
        voted: Array.isArray(r.votes) ? r.votes.length > 0 : false,
      })),
    });
  }),
);

requestsRouter.post(
  '/',
  requireAuth,
  limiters.write,
  privateNoStore,
  validate(
    z.object({
      title: z.string().trim().min(4, 'Give it a clear title.').max(140),
      description: z.string().trim().min(10, 'Add a little detail.').max(1500),
      categoryId: z.string().cuid().nullable().optional(),
      software: z.string().trim().max(60).nullable().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const body = req.body as { title: string; description: string; categoryId?: string | null; software?: string | null };
    const request = await prisma.resourceRequest.create({
      data: {
        title: body.title,
        description: body.description,
        categoryId: body.categoryId ?? null,
        software: body.software ?? null,
        userId: req.user!.id,
        voteCount: 1,
        votes: { create: { userId: req.user!.id } },
      },
    });
    res.status(201).json({ id: request.id });
  }),
);

requestsRouter.post(
  '/:id/vote',
  requireAuth,
  limiters.write,
  privateNoStore,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const requestId = req.params.id;
    const existing = await prisma.resourceRequestVote.findUnique({
      where: { requestId_userId: { requestId, userId } },
    });

    if (existing) {
      await prisma.$transaction([
        prisma.resourceRequestVote.delete({ where: { requestId_userId: { requestId, userId } } }),
        prisma.resourceRequest.update({
          where: { id: requestId },
          data: { voteCount: { decrement: 1 } },
        }),
      ]);
      return res.json({ voted: false });
    }

    const request = await prisma.resourceRequest.findUnique({ where: { id: requestId }, select: { id: true } });
    if (!request) throw notFound('That request does not exist.');

    await prisma.$transaction([
      prisma.resourceRequestVote.create({ data: { requestId, userId } }),
      prisma.resourceRequest.update({ where: { id: requestId }, data: { voteCount: { increment: 1 } } }),
    ]);
    res.json({ voted: true });
  }),
);
