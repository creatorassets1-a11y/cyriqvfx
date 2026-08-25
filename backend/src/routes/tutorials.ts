import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { asyncHandler, limiters, validate, validatedQuery } from '../middleware/index.js';
import { notFound } from '../lib/errors.js';
import { tutorialCardSelect, tutorialDetailInclude, toTutorialCard, toTutorialDetail } from '../modules/dto.js';
import { publicCache } from '../middleware/cache.js';

export const tutorialsRouter = Router();

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  software: z.string().trim().max(80).optional(),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  sort: z.enum(['newest', 'popular']).default('newest'),
  page: z.coerce.number().int().min(1).max(200).default(1),
  perPage: z.coerce.number().int().min(1).max(24).default(12),
});

tutorialsRouter.get(
  '/',
  limiters.read,
  validate(listQuery, 'query'),
  publicCache(120),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<z.infer<typeof listQuery>>(req);
    const where: Prisma.TutorialWhereInput = {
      status: 'PUBLISHED',
      ...(q.category ? { category: { slug: q.category } } : {}),
      ...(q.software ? { software: { some: { software: { slug: q.software } } } } : {}),
      ...(q.level ? { skillLevel: q.level } : {}),
      ...(q.q
        ? {
            OR: [
              { title: { contains: q.q, mode: 'insensitive' } },
              { summary: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows, facets] = await Promise.all([
      prisma.tutorial.count({ where }),
      prisma.tutorial.findMany({
        where,
        orderBy: q.sort === 'popular' ? [{ viewCount: 'desc' }] : [{ publishedAt: 'desc' }],
        select: tutorialCardSelect,
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      prisma.software.findMany({
        orderBy: { position: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          _count: { select: { tutorials: { where: { tutorial: { status: 'PUBLISHED' } } } } },
        },
      }),
    ]);

    res.json({
      items: rows.map(toTutorialCard),
      page: q.page,
      perPage: q.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.perPage)),
      hasMore: q.page * q.perPage < total,
      facets: {
        software: facets
          .filter((s) => s._count.tutorials > 0)
          .map((s) => ({ id: s.id, name: s.name, slug: s.slug, count: s._count.tutorials })),
      },
    });
  }),
);

tutorialsRouter.get(
  '/:slug',
  limiters.read,
  asyncHandler(async (req, res) => {
    const tutorial = await prisma.tutorial.findUnique({
      where: { slug: req.params.slug },
      include: tutorialDetailInclude,
    });

    if (!tutorial) throw notFound('That tutorial does not exist.');
    const visible = tutorial.status === 'PUBLISHED' || tutorial.status === 'UNLISTED';
    if (!visible && req.user?.role !== 'ADMIN') throw notFound('That tutorial does not exist.');

    if (tutorial.status === 'PUBLISHED') {
      await prisma.tutorial
        .update({ where: { id: tutorial.id }, data: { viewCount: { increment: 1 } } })
        .catch(() => {});
    }

    const related = await prisma.tutorial.findMany({
      where: {
        status: 'PUBLISHED',
        id: { not: tutorial.id },
        ...(tutorial.categoryId ? { categoryId: tutorial.categoryId } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: 3,
      select: tutorialCardSelect,
    });

    res.json({ ...toTutorialDetail(tutorial), related: related.map(toTutorialCard) });
  }),
);
