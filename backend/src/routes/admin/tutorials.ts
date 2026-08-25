import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, limiters, validate, validatedQuery } from '../../middleware/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { slugify } from '../../lib/crypto.js';
import { objectKeys, storage } from '../../lib/storage/index.js';
import { promoteUpload } from '../../modules/uploadAttach.js';
import { recordAudit } from '../../modules/audit.js';
import { fanOutNotification } from '../../modules/notifications.js';
import { tutorialCardSelect, tutorialDetailInclude, toTutorialCard, toTutorialDetail } from '../../modules/dto.js';

export const adminTutorialsRouter = Router();

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base) || 'tutorial';
  let candidate = root;
  for (let i = 2; i < 200; i++) {
    const found = await prisma.tutorial.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!found || found.id === excludeId) return candidate;
    candidate = `${root}-${i}`;
  }
  return `${root}-${Date.now()}`;
}

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNLISTED', 'ARCHIVED']).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});

adminTutorialsRouter.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<z.infer<typeof listQuery>>(req);
    const where: Prisma.TutorialWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [total, rows, counts] = await Promise.all([
      prisma.tutorial.count({ where }),
      prisma.tutorial.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
        select: tutorialCardSelect,
      }),
      prisma.tutorial.groupBy({ by: ['status'], _count: true }),
    ]);
    res.json({
      items: rows.map(toTutorialCard),
      total,
      page: q.page,
      perPage: q.perPage,
      totalPages: Math.max(1, Math.ceil(total / q.perPage)),
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    });
  }),
);

const tutorialBody = z.object({
  title: z.string().trim().min(1, 'A title is required.').max(140),
  slug: z.string().trim().max(90).optional(),
  summary: z.string().trim().min(1, 'Write a short summary.').max(300),
  body: z.string().max(40000).default(''),
  categoryId: z.string().cuid().nullable().optional(),
  skillLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).default('BEGINNER'),
  durationSeconds: z.number().int().min(0).max(60 * 60 * 12).nullable().optional(),
  videoUrl: z.string().url().max(500).nullable().optional(),
  transcript: z.string().max(100000).nullable().optional(),
  featured: z.boolean().default(false),
  seoTitle: z.string().trim().max(70).nullable().optional(),
  seoDescription: z.string().trim().max(200).nullable().optional(),
  softwareIds: z.array(z.string().cuid()).max(10).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  resourceIds: z.array(z.string().cuid()).max(30).default([]),
  steps: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(140),
        body: z.string().max(5000).default(''),
        timestampSeconds: z.number().int().min(0).max(60 * 60 * 12).nullable().optional(),
      }),
    )
    .max(40)
    .default([]),
});

async function writeRelations(tutorialId: string, body: Partial<z.infer<typeof tutorialBody>>) {
  const ops: Prisma.PrismaPromise<unknown>[] = [];

  if (body.softwareIds) {
    ops.push(
      prisma.tutorialSoftware.deleteMany({ where: { tutorialId } }),
      prisma.tutorialSoftware.createMany({
        data: body.softwareIds.map((softwareId) => ({ tutorialId, softwareId })),
      }),
    );
  }
  if (body.resourceIds) {
    ops.push(
      prisma.tutorialResource.deleteMany({ where: { tutorialId } }),
      prisma.tutorialResource.createMany({
        data: body.resourceIds.map((resourceId, position) => ({ tutorialId, resourceId, position })),
      }),
    );
  }
  if (body.steps) {
    ops.push(
      prisma.tutorialStep.deleteMany({ where: { tutorialId } }),
      prisma.tutorialStep.createMany({
        data: body.steps.map((s, position) => ({
          tutorialId,
          position,
          title: s.title,
          body: s.body,
          timestampSeconds: s.timestampSeconds ?? null,
        })),
      }),
    );
  }
  if (ops.length) await prisma.$transaction(ops);

  if (body.tags) {
    const tagIds: string[] = [];
    for (const name of [...new Set(body.tags.map((t) => t.trim()).filter(Boolean))]) {
      const slug = slugify(name);
      if (!slug) continue;
      const tag = await prisma.tag.upsert({ where: { slug }, create: { name, slug }, update: {}, select: { id: true } });
      tagIds.push(tag.id);
    }
    await prisma.$transaction([
      prisma.tutorialTag.deleteMany({ where: { tutorialId } }),
      prisma.tutorialTag.createMany({ data: tagIds.map((tagId) => ({ tutorialId, tagId })) }),
    ]);
  }
}

adminTutorialsRouter.post(
  '/',
  limiters.write,
  validate(tutorialBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof tutorialBody>;
    const tutorial = await prisma.tutorial.create({
      data: {
        title: body.title,
        slug: await uniqueSlug(body.slug || body.title),
        summary: body.summary,
        body: body.body,
        categoryId: body.categoryId ?? null,
        skillLevel: body.skillLevel,
        durationSeconds: body.durationSeconds ?? null,
        videoUrl: body.videoUrl ?? null,
        transcript: body.transcript ?? null,
        featured: body.featured,
        seoTitle: body.seoTitle ?? null,
        seoDescription: body.seoDescription ?? null,
        status: 'DRAFT',
      },
    });
    await writeRelations(tutorial.id, body);
    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'tutorial.created',
      targetType: 'tutorial',
      targetId: tutorial.id,
      metadata: { title: tutorial.title },
    });
    const full = await prisma.tutorial.findUniqueOrThrow({
      where: { id: tutorial.id },
      include: tutorialDetailInclude,
    });
    res.status(201).json({ tutorial: toTutorialDetail(full) });
  }),
);

adminTutorialsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const tutorial = await prisma.tutorial.findUnique({
      where: { id: req.params.id },
      include: tutorialDetailInclude,
    });
    if (!tutorial) throw notFound('That tutorial does not exist.');
    res.json({
      tutorial: {
        ...toTutorialDetail(tutorial),
        resourceIds: tutorial.resources.map((r) => r.resource.id),
        softwareIds: tutorial.software.map((s) => s.software.id),
        tagNames: tutorial.tags.map((t) => t.tag.name),
        scheduledFor: tutorial.scheduledFor?.toISOString() ?? null,
      },
    });
  }),
);

adminTutorialsRouter.patch(
  '/:id',
  limiters.write,
  validate(tutorialBody.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof tutorialBody>>;
    const existing = await prisma.tutorial.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('That tutorial does not exist.');

    await prisma.tutorial.update({
      where: { id: existing.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.slug && body.slug !== existing.slug
          ? { slug: await uniqueSlug(body.slug, existing.id) }
          : {}),
        ...(body.summary !== undefined ? { summary: body.summary } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.skillLevel !== undefined ? { skillLevel: body.skillLevel } : {}),
        ...(body.durationSeconds !== undefined ? { durationSeconds: body.durationSeconds } : {}),
        ...(body.videoUrl !== undefined ? { videoUrl: body.videoUrl } : {}),
        ...(body.transcript !== undefined ? { transcript: body.transcript } : {}),
        ...(body.featured !== undefined ? { featured: body.featured } : {}),
        ...(body.seoTitle !== undefined ? { seoTitle: body.seoTitle } : {}),
        ...(body.seoDescription !== undefined ? { seoDescription: body.seoDescription } : {}),
      },
    });
    await writeRelations(existing.id, body);
    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'tutorial.updated',
      targetType: 'tutorial',
      targetId: existing.id,
      metadata: { title: body.title ?? existing.title },
    });
    const full = await prisma.tutorial.findUniqueOrThrow({
      where: { id: existing.id },
      include: tutorialDetailInclude,
    });
    res.json({ tutorial: toTutorialDetail(full) });
  }),
);

const mediaSchema = z.object({
  uploadSessionId: z.string().cuid(),
  slot: z.enum(['cover', 'video', 'ogImage']),
});

adminTutorialsRouter.post(
  '/:id/media',
  limiters.upload,
  validate(mediaSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof mediaSchema>;
    const tutorial = await prisma.tutorial.findUnique({ where: { id: req.params.id } });
    if (!tutorial) throw notFound('That tutorial does not exist.');

    const targetKey =
      body.slot === 'cover'
        ? objectKeys.tutorialCover(tutorial.id)
        : body.slot === 'ogImage'
          ? objectKeys.tutorialMedia(tutorial.id, 'og-image')
          : objectKeys.tutorialMedia(tutorial.id, 'video');

    const promoted = await promoteUpload({
      uploadSessionId: body.uploadSessionId,
      adminId: req.user!.id,
      targetKey,
      expectedPurpose: ['tutorial-media', 'thumbnail', 'preview'],
    });

    const field = body.slot === 'cover' ? 'coverKey' : body.slot === 'ogImage' ? 'ogImageKey' : 'videoKey';
    await prisma.tutorial.update({
      where: { id: tutorial.id },
      data: { [field]: promoted.objectKey },
    });
    res.json({ ok: true, slot: body.slot });
  }),
);

const statusSchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'SCHEDULED', 'UNLISTED', 'ARCHIVED']),
  scheduledFor: z.string().datetime().nullable().optional(),
  notify: z.boolean().default(false),
});

adminTutorialsRouter.post(
  '/:id/status',
  limiters.write,
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof statusSchema>;
    const tutorial = await prisma.tutorial.findUnique({ where: { id: req.params.id } });
    if (!tutorial) throw notFound('That tutorial does not exist.');

    if (body.status === 'PUBLISHED' && !tutorial.videoKey && !tutorial.videoUrl && !tutorial.body.trim()) {
      throw badRequest('Add a video or written steps before publishing this tutorial.');
    }
    if (body.status === 'SCHEDULED') {
      if (!body.scheduledFor) throw badRequest('Choose a date and time to publish.');
      if (new Date(body.scheduledFor) <= new Date()) throw badRequest('Choose a time in the future.');
    }

    const wasPublic = tutorial.status === 'PUBLISHED';
    const updated = await prisma.tutorial.update({
      where: { id: tutorial.id },
      data: {
        status: body.status,
        scheduledFor: body.status === 'SCHEDULED' ? new Date(body.scheduledFor!) : null,
        publishedAt:
          body.status === 'PUBLISHED' && !tutorial.publishedAt ? new Date() : tutorial.publishedAt,
      },
    });

    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: body.status === 'PUBLISHED' ? 'tutorial.published' : 'tutorial.updated',
      targetType: 'tutorial',
      targetId: tutorial.id,
      metadata: { title: tutorial.title, status: body.status },
    });

    if (body.notify && body.status === 'PUBLISHED' && !wasPublic) {
      await fanOutNotification({
        type: 'TUTORIAL_PUBLISHED',
        title: `New tutorial: ${tutorial.title}`,
        body: tutorial.summary,
        link: `/tutorials/${tutorial.slug}`,
      });
    }

    res.json({ status: updated.status, publishedAt: updated.publishedAt?.toISOString() ?? null });
  }),
);

adminTutorialsRouter.delete(
  '/:id',
  limiters.write,
  asyncHandler(async (req, res) => {
    const tutorial = await prisma.tutorial.findUnique({ where: { id: req.params.id } });
    if (!tutorial) throw notFound('That tutorial does not exist.');
    const keys = [tutorial.coverKey, tutorial.videoKey, tutorial.ogImageKey].filter(
      (k): k is string => !!k,
    );
    await prisma.tutorial.delete({ where: { id: tutorial.id } });
    for (const key of keys) await storage.delete(key).catch(() => {});
    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'tutorial.deleted',
      targetType: 'tutorial',
      targetId: tutorial.id,
      metadata: { title: tutorial.title },
    });
    res.json({ ok: true });
  }),
);
