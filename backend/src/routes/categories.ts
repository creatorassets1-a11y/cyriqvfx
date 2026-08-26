import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { asyncHandler, limiters } from '../middleware/index.js';
import { notFound } from '../lib/errors.js';
import { resourceCardSelect, toCategory, toResourceCard } from '../modules/dto.js';
import { publicCache } from '../middleware/cache.js';

export const categoriesRouter = Router();

const publicWhere = { status: 'PUBLISHED' } as const;

categoriesRouter.get(
  '/',
  limiters.read,
  publicCache(300),
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      where: { status: 'ACTIVE', parentId: null },
      orderBy: { position: 'asc' },
      include: {
        _count: { select: { resources: { where: publicWhere } } },
        children: {
          where: { status: 'ACTIVE' },
          orderBy: { position: 'asc' },
          include: { _count: { select: { resources: { where: publicWhere } } } },
        },
      },
    });
    res.json({ items: categories.map(toCategory) });
  }),
);

/** Category landing page payload (PRD §45). */
categoriesRouter.get(
  '/:slug',
  limiters.read,
  publicCache(120),
  asyncHandler(async (req, res) => {
    const category = await prisma.category.findUnique({
      where: { slug: req.params.slug },
      include: {
        _count: { select: { resources: { where: publicWhere } } },
        children: {
          where: { status: 'ACTIVE' },
          orderBy: { position: 'asc' },
          include: { _count: { select: { resources: { where: publicWhere } } } },
        },
      },
    });

    if (!category || category.status === 'ARCHIVED') throw notFound('That category does not exist.');
    if (category.status === 'HIDDEN' && req.user?.role !== 'ADMIN') {
      throw notFound('That category does not exist.');
    }

    // Include child-category resources so a parent page is never emptier than
    // the sum of its parts.
    const childIds = category.children.map((c) => c.id);
    const scope = { OR: [{ categoryId: category.id }, { categoryId: { in: childIds } }] };

    const [featured, latest, popular, total] = await Promise.all([
      prisma.resource.findMany({
        where: { ...publicWhere, ...scope, featured: true },
        orderBy: { publishedAt: 'desc' },
        take: 3,
        select: resourceCardSelect,
      }),
      prisma.resource.findMany({
        where: { ...publicWhere, ...scope },
        orderBy: { publishedAt: 'desc' },
        take: 12,
        select: resourceCardSelect,
      }),
      prisma.resource.findMany({
        where: { ...publicWhere, ...scope },
        orderBy: { downloadCount: 'desc' },
        take: 6,
        select: resourceCardSelect,
      }),
      prisma.resource.count({ where: { ...publicWhere, ...scope } }),
    ]);

    res.json({
      category: toCategory(category),
      featured: featured.map(toResourceCard),
      latest: latest.map(toResourceCard),
      popular: popular.map(toResourceCard),
      total,
    });
  }),
);
