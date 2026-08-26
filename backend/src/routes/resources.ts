import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { asyncHandler, limiters, validate, validatedQuery } from '../middleware/index.js';
import { notFound } from '../lib/errors.js';
import {
  resourceCardSelect,
  resourceDetailInclude,
  toResourceCard,
  toResourceDetail,
} from '../modules/dto.js';
import { publicCache } from '../middleware/cache.js';

export const resourcesRouter = Router();

const SORTS = ['newest', 'popular', 'updated', 'az'] as const;

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(80).optional(),
  subcategory: z.string().trim().max(80).optional(),
  software: z.string().trim().max(300).optional(),
  tag: z.string().trim().max(300).optional(),
  format: z.string().trim().max(80).optional(),
  license: z.string().trim().max(80).optional(),
  commercial: z.enum(['true', 'false']).optional(),
  flag: z.string().trim().max(60).optional(),
  sort: z.enum(SORTS).default('newest'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  perPage: z.coerce.number().int().min(1).max(48).default(24),
});

/** Only PUBLISHED resources are listable. UNLISTED is reachable by link only. */
const publicWhere: Prisma.ResourceWhereInput = { status: 'PUBLISHED' };

function csv(value?: string): string[] {
  return value ? value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) : [];
}

resourcesRouter.get(
  '/',
  limiters.read,
  validate(listQuery, 'query'),
  publicCache(60),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<z.infer<typeof listQuery>>(req);
    const softwareSlugs = csv(q.software);
    const tagSlugs = csv(q.tag);
    const formats = csv(q.format);

    const where: Prisma.ResourceWhereInput = {
      ...publicWhere,
      ...(q.category ? { category: { slug: q.category } } : {}),
      ...(q.subcategory ? { subcategory: { slug: q.subcategory } } : {}),
      ...(softwareSlugs.length
        ? { AND: softwareSlugs.map((slug) => ({ software: { some: { software: { slug } } } })) }
        : {}),
      ...(tagSlugs.length ? { tags: { some: { tag: { slug: { in: tagSlugs } } } } } : {}),
      ...(formats.length ? { format: { in: formats } } : {}),
      ...(q.license ? { license: { slug: q.license } } : {}),
      ...(q.commercial === 'true' ? { license: { commercialUse: true } } : {}),
      ...(q.flag ? { qualityFlags: { has: q.flag as never } } : {}),
      ...(q.q
        ? {
            OR: [
              { title: { contains: q.q, mode: 'insensitive' } },
              { shortDescription: { contains: q.q, mode: 'insensitive' } },
              { tags: { some: { tag: { name: { contains: q.q, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.ResourceOrderByWithRelationInput[] =
      q.sort === 'popular'
        ? [{ downloadCount: 'desc' }, { publishedAt: 'desc' }]
        : q.sort === 'updated'
          ? [{ updatedAt: 'desc' }]
          : q.sort === 'az'
            ? [{ title: 'asc' }]
            : [{ publishedAt: 'desc' }, { createdAt: 'desc' }];

    const [total, rows] = await Promise.all([
      prisma.resource.count({ where }),
      prisma.resource.findMany({
        where,
        orderBy,
        select: resourceCardSelect,
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
    ]);

    res.json({
      items: rows.map(toResourceCard),
      page: q.page,
      perPage: q.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.perPage)),
      hasMore: q.page * q.perPage < total,
    });
  }),
);

/** Facet counts so the filter UI can show what is actually available. */
resourcesRouter.get(
  '/facets',
  limiters.read,
  publicCache(300),
  asyncHandler(async (_req, res) => {
    const [categories, software, licenses, formats, tags] = await Promise.all([
      prisma.category.findMany({
        where: { status: 'ACTIVE', parentId: null },
        orderBy: { position: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          icon: true,
          _count: { select: { resources: { where: publicWhere } } },
        },
      }),
      prisma.software.findMany({
        orderBy: { position: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          _count: { select: { resources: { where: { resource: publicWhere } } } },
        },
      }),
      prisma.license.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          commercialUse: true,
          _count: { select: { resources: { where: publicWhere } } },
        },
      }),
      prisma.resource.groupBy({
        by: ['format'],
        where: { ...publicWhere, format: { not: null } },
        _count: { format: true },
        orderBy: { _count: { format: 'desc' } },
        take: 16,
      }),
      prisma.tag.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          _count: { select: { resources: { where: { resource: publicWhere } } } },
        },
      }),
    ]);

    res.json({
      categories: categories
        .filter((c) => c._count.resources > 0)
        .map((c) => ({ id: c.id, name: c.name, slug: c.slug, icon: c.icon, count: c._count.resources })),
      software: software
        .filter((s) => s._count.resources > 0)
        .map((s) => ({ id: s.id, name: s.name, slug: s.slug, count: s._count.resources })),
      licenses: licenses
        .filter((l) => l._count.resources > 0)
        .map((l) => ({
          id: l.id,
          name: l.name,
          slug: l.slug,
          commercialUse: l.commercialUse,
          count: l._count.resources,
        })),
      formats: formats
        .filter((f) => f.format)
        .map((f) => ({ value: f.format!, count: f._count.format })),
      tags: tags
        .filter((t) => t._count.resources > 0)
        .map((t) => ({ id: t.id, name: t.name, slug: t.slug, count: t._count.resources }))
        .slice(0, 40),
    });
  }),
);

/** Homepage payload in one round trip (PRD §9). */
resourcesRouter.get(
  '/home',
  limiters.read,
  publicCache(60),
  asyncHandler(async (_req, res) => {
    const [latest, featured, popular, recentlyUpdated, categories, tutorials, stats] =
      await Promise.all([
        prisma.resource.findMany({
          where: publicWhere,
          orderBy: [{ publishedAt: 'desc' }],
          take: 8,
          select: resourceCardSelect,
        }),
        prisma.resource.findFirst({
          where: { ...publicWhere, featured: true },
          orderBy: [{ publishedAt: 'desc' }],
          include: resourceDetailInclude,
        }),
        prisma.resource.findMany({
          where: publicWhere,
          orderBy: [{ downloadCount: 'desc' }],
          take: 6,
          select: resourceCardSelect,
        }),
        prisma.resource.findMany({
          where: {
            ...publicWhere,
            currentVersion: { isNot: null },
          },
          orderBy: [{ updatedAt: 'desc' }],
          take: 5,
          select: resourceCardSelect,
        }),
        prisma.category.findMany({
          where: { status: 'ACTIVE', parentId: null },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            name: true,
            slug: true,
            icon: true,
            description: true,
            _count: { select: { resources: { where: publicWhere } } },
          },
        }),
        prisma.tutorial.findMany({
          where: { status: 'PUBLISHED' },
          orderBy: [{ publishedAt: 'desc' }],
          take: 3,
          select: {
            id: true,
            title: true,
            slug: true,
            summary: true,
            coverKey: true,
            durationSeconds: true,
            skillLevel: true,
            publishedAt: true,
            _count: { select: { resources: true } },
          },
        }),
        prisma.resource.aggregate({ where: publicWhere, _count: true, _sum: { downloadCount: true } }),
      ]);

    res.json({
      latest: latest.map(toResourceCard),
      featured: featured ? toResourceDetail(featured) : null,
      popular: popular.map(toResourceCard),
      recentlyUpdated: recentlyUpdated.map(toResourceCard),
      categories: categories
        .filter((c) => c._count.resources > 0)
        .map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          icon: c.icon,
          description: c.description,
          resourceCount: c._count.resources,
        })),
      tutorials: tutorials.map((t) => ({
        id: t.id,
        title: t.title,
        slug: t.slug,
        summary: t.summary,
        coverUrl: t.coverKey ? `/api/media/${encodeURIComponent(t.coverKey)}` : null,
        durationSeconds: t.durationSeconds,
        skillLevel: t.skillLevel,
        publishedAt: t.publishedAt?.toISOString() ?? null,
        resourceCount: t._count.resources,
      })),
      // Real counts from real rows, never invented (PRD §109).
      stats: {
        resourceCount: stats._count,
        downloadCount: stats._sum.downloadCount ?? 0,
      },
    });
  }),
);

resourcesRouter.get(
  '/:slug',
  limiters.read,
  asyncHandler(async (req, res) => {
    const resource = await prisma.resource.findUnique({
      where: { slug: req.params.slug },
      include: resourceDetailInclude,
    });

    if (!resource) throw notFound('That resource does not exist.');

    const viewerIsAdmin = req.user?.role === 'ADMIN';
    const publiclyVisible = resource.status === 'PUBLISHED' || resource.status === 'UNLISTED';
    if (!publiclyVisible && !viewerIsAdmin) {
      // Drafts and archived items are indistinguishable from missing to the public.
      throw notFound('That resource does not exist.');
    }

    // Count a view at most once per visitor per resource per day.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const seen = await prisma.resourceView.findFirst({
      where: { resourceId: resource.id, sessionKey: req.visitorKey, createdAt: { gte: since } },
      select: { id: true },
    });
    if (!seen && resource.status === 'PUBLISHED') {
      await prisma.$transaction([
        prisma.resourceView.create({
          data: { resourceId: resource.id, sessionKey: req.visitorKey },
        }),
        prisma.resource.update({
          where: { id: resource.id },
          data: { viewCount: { increment: 1 } },
        }),
      ]);
    }

    const saved = req.user
      ? !!(await prisma.savedResource.findUnique({
          where: { userId_resourceId: { userId: req.user.id, resourceId: resource.id } },
          select: { resourceId: true },
        }))
      : false;

    res.json({ ...toResourceDetail(resource), saved });
  }),
);
