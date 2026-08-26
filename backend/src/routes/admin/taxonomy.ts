import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, limiters, validate } from '../../middleware/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { slugify } from '../../lib/crypto.js';
import { recordAudit } from '../../modules/audit.js';
import { toCategory } from '../../modules/dto.js';

export const adminTaxonomyRouter = Router();

/** Categories (PRD §45), software and licenses (PRD §32). */

adminTaxonomyRouter.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      where: { parentId: null },
      orderBy: { position: 'asc' },
      include: {
        _count: { select: { resources: true } },
        children: {
          orderBy: { position: 'asc' },
          include: { _count: { select: { resources: true } } },
        },
      },
    });
    res.json({ items: categories.map(toCategory) });
  }),
);

const categoryBody = z.object({
  name: z.string().trim().min(1, 'Give the category a name.').max(60),
  slug: z.string().trim().max(70).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  icon: z.string().trim().max(40).nullable().optional(),
  parentId: z.string().cuid().nullable().optional(),
  status: z.enum(['ACTIVE', 'HIDDEN', 'ARCHIVED']).default('ACTIVE'),
  seoTitle: z.string().trim().max(70).nullable().optional(),
  seoDescription: z.string().trim().max(200).nullable().optional(),
});

async function uniqueCategorySlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base) || 'category';
  let candidate = root;
  for (let i = 2; i < 200; i++) {
    const found = await prisma.category.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!found || found.id === excludeId) return candidate;
    candidate = `${root}-${i}`;
  }
  return `${root}-${Date.now()}`;
}

adminTaxonomyRouter.post(
  '/categories',
  limiters.write,
  validate(categoryBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof categoryBody>;
    if (body.parentId) {
      const parent = await prisma.category.findUnique({
        where: { id: body.parentId },
        select: { parentId: true },
      });
      if (!parent) throw badRequest('That parent category does not exist.');
      // One level of nesting keeps navigation understandable.
      if (parent.parentId) throw badRequest('Subcategories cannot have their own subcategories.');
    }
    const last = await prisma.category.findFirst({
      where: { parentId: body.parentId ?? null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const category = await prisma.category.create({
      data: {
        name: body.name,
        slug: await uniqueCategorySlug(body.slug || body.name),
        description: body.description ?? null,
        icon: body.icon ?? null,
        parentId: body.parentId ?? null,
        status: body.status,
        seoTitle: body.seoTitle ?? null,
        seoDescription: body.seoDescription ?? null,
        position: (last?.position ?? -1) + 1,
      },
    });
    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'category.created',
      targetType: 'category',
      targetId: category.id,
      metadata: { name: category.name },
    });
    res.status(201).json({ category });
  }),
);

adminTaxonomyRouter.patch(
  '/categories/:id',
  limiters.write,
  validate(categoryBody.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof categoryBody>>;
    const existing = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('That category does not exist.');
    if (body.parentId === existing.id) throw badRequest('A category cannot be its own parent.');

    const category = await prisma.category.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.slug && body.slug !== existing.slug
          ? { slug: await uniqueCategorySlug(body.slug, existing.id) }
          : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.seoTitle !== undefined ? { seoTitle: body.seoTitle } : {}),
        ...(body.seoDescription !== undefined ? { seoDescription: body.seoDescription } : {}),
      },
    });
    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'category.updated',
      targetType: 'category',
      targetId: category.id,
      metadata: { name: category.name },
    });
    res.json({ category });
  }),
);

const reorderBody = z.object({ ids: z.array(z.string().cuid()).min(1).max(200) });

adminTaxonomyRouter.post(
  '/categories/reorder',
  limiters.write,
  validate(reorderBody),
  asyncHandler(async (req, res) => {
    const { ids } = req.body as z.infer<typeof reorderBody>;
    await prisma.$transaction(
      ids.map((id, position) => prisma.category.update({ where: { id }, data: { position } })),
    );
    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'category.reordered',
      targetType: 'category',
      metadata: { count: ids.length },
    });
    res.json({ ok: true });
  }),
);

adminTaxonomyRouter.delete(
  '/categories/:id',
  limiters.write,
  asyncHandler(async (req, res) => {
    const category = await prisma.category.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { resources: true, children: true, tutorials: true } } },
    });
    if (!category) throw notFound('That category does not exist.');

    // Deleting is only safe when nothing depends on it (PRD §11).
    if (category._count.resources > 0) {
      throw badRequest(
        `${category._count.resources} resource${category._count.resources === 1 ? ' is' : 's are'} still in this category. Move them first, or archive the category instead.`,
      );
    }
    if (category._count.children > 0) {
      throw badRequest('Remove or move its subcategories first.');
    }
    if (category._count.tutorials > 0) {
      throw badRequest('Tutorials still use this category. Move them first.');
    }

    await prisma.category.delete({ where: { id: category.id } });
    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'category.deleted',
      targetType: 'category',
      targetId: category.id,
      metadata: { name: category.name },
    });
    res.json({ ok: true });
  }),
);

/** Software list. Powers the compatibility filters. */
adminTaxonomyRouter.get(
  '/software',
  asyncHandler(async (_req, res) => {
    const items = await prisma.software.findMany({
      orderBy: { position: 'asc' },
      include: { _count: { select: { resources: true } } },
    });
    res.json({
      items: items.map((s) => ({ id: s.id, name: s.name, slug: s.slug, position: s.position, resourceCount: s._count.resources })),
    });
  }),
);

adminTaxonomyRouter.post(
  '/software',
  limiters.write,
  validate(z.object({ name: z.string().trim().min(1).max(60) })),
  asyncHandler(async (req, res) => {
    const { name } = req.body as { name: string };
    const last = await prisma.software.findFirst({ orderBy: { position: 'desc' }, select: { position: true } });
    const software = await prisma.software.upsert({
      where: { slug: slugify(name) },
      create: { name, slug: slugify(name), position: (last?.position ?? -1) + 1 },
      update: { name },
    });
    res.status(201).json({ software });
  }),
);

adminTaxonomyRouter.delete(
  '/software/:id',
  limiters.write,
  asyncHandler(async (req, res) => {
    const software = await prisma.software.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { resources: true } } },
    });
    if (!software) throw notFound('That software entry does not exist.');
    if (software._count.resources > 0) {
      throw badRequest(`${software._count.resources} resources list this software. Remove it from them first.`);
    }
    await prisma.software.delete({ where: { id: software.id } });
    res.json({ ok: true });
  }),
);

/** Licenses (PRD §32). */
adminTaxonomyRouter.get(
  '/licenses',
  asyncHandler(async (_req, res) => {
    const items = await prisma.license.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { resources: true } } },
    });
    res.json({ items: items.map((l) => ({ ...l, resourceCount: l._count.resources })) });
  }),
);

const licenseBody = z.object({
  name: z.string().trim().min(1, 'Give the license a name.').max(60),
  summary: z.string().trim().min(1, 'Summarise it in one line.').max(200),
  personalUse: z.boolean().default(true),
  commercialUse: z.boolean().default(false),
  modification: z.boolean().default(true),
  redistribution: z.boolean().default(false),
  resale: z.boolean().default(false),
  attributionRequired: z.boolean().default(false),
  customText: z.string().max(5000).nullable().optional(),
  isDefault: z.boolean().default(false),
});

adminTaxonomyRouter.post(
  '/licenses',
  limiters.write,
  validate(licenseBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof licenseBody>;
    if (body.isDefault) await prisma.license.updateMany({ data: { isDefault: false } });
    const license = await prisma.license.create({
      data: { ...body, slug: slugify(body.name), customText: body.customText ?? null },
    });
    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'license.created',
      targetType: 'license',
      targetId: license.id,
      metadata: { name: license.name },
    });
    res.status(201).json({ license });
  }),
);

adminTaxonomyRouter.patch(
  '/licenses/:id',
  limiters.write,
  validate(licenseBody.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof licenseBody>>;
    const existing = await prisma.license.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('That license does not exist.');
    if (body.isDefault) await prisma.license.updateMany({ data: { isDefault: false } });
    const license = await prisma.license.update({
      where: { id: existing.id },
      data: { ...body, ...(body.name ? { slug: slugify(body.name) } : {}) },
    });
    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'license.updated',
      targetType: 'license',
      targetId: license.id,
      metadata: { name: license.name },
    });
    res.json({ license });
  }),
);

adminTaxonomyRouter.delete(
  '/licenses/:id',
  limiters.write,
  asyncHandler(async (req, res) => {
    const license = await prisma.license.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { resources: true } } },
    });
    if (!license) throw notFound('That license does not exist.');
    if (license._count.resources > 0) {
      throw badRequest(
        `${license._count.resources} resources use this license. Reassign them before deleting it.`,
      );
    }
    await prisma.license.delete({ where: { id: license.id } });
    res.json({ ok: true });
  }),
);
