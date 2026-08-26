import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, limiters, validate, validatedQuery } from '../../middleware/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { generateDownloadToken, slugify } from '../../lib/crypto.js';
import { objectKeys, storage } from '../../lib/storage/index.js';
import { promoteUpload } from '../../modules/uploadAttach.js';
import { recordAudit } from '../../modules/audit.js';
import { fanOutNotification } from '../../modules/notifications.js';
import { resourceDetailInclude, toResourceDetail, resourceCardSelect, toResourceCard } from '../../modules/dto.js';
import { formatBytes } from '../../lib/fileValidation.js';

export const adminResourcesRouter = Router();

/** Ensures a slug is unique, appending -2, -3 … when needed. */
async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base) || 'resource';
  let candidate = root;
  for (let i = 2; i < 200; i++) {
    const existing = await prisma.resource.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${root}-${i}`;
  }
  return `${root}-${Date.now()}`;
}

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNLISTED', 'ARCHIVED']).optional(),
  category: z.string().trim().max(80).optional(),
  sort: z.enum(['newest', 'updated', 'popular', 'az']).default('updated'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});

adminResourcesRouter.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const q = validatedQuery<z.infer<typeof listQuery>>(req);
    const where: Prisma.ResourceWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.category ? { category: { slug: q.category } } : {}),
      ...(q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const orderBy: Prisma.ResourceOrderByWithRelationInput =
      q.sort === 'popular'
        ? { downloadCount: 'desc' }
        : q.sort === 'az'
          ? { title: 'asc' }
          : q.sort === 'newest'
            ? { createdAt: 'desc' }
            : { updatedAt: 'desc' };

    const [total, rows, counts] = await Promise.all([
      prisma.resource.count({ where }),
      prisma.resource.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
        select: {
          ...resourceCardSelect,
          scheduledFor: true,
          viewCount: true,
          saveCount: true,
          _count: { select: { versions: true } },
        },
      }),
      prisma.resource.groupBy({ by: ['status'], _count: true }),
    ]);

    res.json({
      items: rows.map((r) => ({
        ...toResourceCard(r),
        scheduledFor: r.scheduledFor?.toISOString() ?? null,
        viewCount: r.viewCount,
        saveCount: r.saveCount,
        versionCount: r._count.versions,
      })),
      page: q.page,
      perPage: q.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.perPage)),
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    });
  }),
);

const resourceBody = z.object({
  title: z.string().trim().min(1, 'A title is required.').max(140),
  slug: z.string().trim().max(90).optional(),
  shortDescription: z.string().trim().min(1, 'Write a one-line summary.').max(200),
  fullDescription: z.string().max(20000).default(''),
  categoryId: z.string().cuid('Choose a category.'),
  subcategoryId: z.string().cuid().nullable().optional(),
  licenseId: z.string().cuid().nullable().optional(),
  installationGuide: z.string().max(20000).default(''),
  requirements: z.string().max(5000).default(''),
  format: z.string().trim().max(40).nullable().optional(),
  previewType: z.enum(['VIDEO', 'IMAGE', 'BEFORE_AFTER', 'AUDIO', 'GALLERY', 'NONE']).default('NONE'),
  featured: z.boolean().default(false),
  qualityFlags: z
    .array(z.enum(['FEATURED', 'CREATOR_PICK', 'BEGINNER_FRIENDLY', 'ADVANCED', 'EXPERIMENTAL']))
    .max(5)
    .default([]),
  seoTitle: z.string().trim().max(70).nullable().optional(),
  seoDescription: z.string().trim().max(200).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  software: z
    .array(
      z.object({
        softwareId: z.string().cuid(),
        minVersion: z.string().trim().max(40).nullable().optional(),
        note: z.string().trim().max(120).nullable().optional(),
      }),
    )
    .max(15)
    .default([]),
  relatedIds: z.array(z.string().cuid()).max(12).default([]),
  tutorialIds: z.array(z.string().cuid()).max(20).default([]),
});

/** Resolves tag names to rows, creating any that are new. */
async function resolveTags(names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of [...new Set(names.map((n) => n.trim()).filter(Boolean))]) {
    const slug = slugify(name);
    if (!slug) continue;
    const tag = await prisma.tag.upsert({
      where: { slug },
      create: { name, slug },
      update: {},
      select: { id: true },
    });
    ids.push(tag.id);
  }
  return ids;
}

async function writeRelations(
  resourceId: string,
  body: z.infer<typeof resourceBody>,
): Promise<void> {
  const tagIds = await resolveTags(body.tags);
  await prisma.$transaction([
    prisma.resourceTag.deleteMany({ where: { resourceId } }),
    prisma.resourceTag.createMany({ data: tagIds.map((tagId) => ({ resourceId, tagId })) }),
    prisma.resourceSoftware.deleteMany({ where: { resourceId } }),
    prisma.resourceSoftware.createMany({
      data: body.software.map((s) => ({
        resourceId,
        softwareId: s.softwareId,
        minVersion: s.minVersion ?? null,
        note: s.note ?? null,
      })),
    }),
    prisma.relatedResource.deleteMany({ where: { fromId: resourceId } }),
    prisma.relatedResource.createMany({
      data: body.relatedIds
        .filter((id) => id !== resourceId)
        .map((toId, position) => ({ fromId: resourceId, toId, position })),
    }),
    prisma.tutorialResource.deleteMany({ where: { resourceId } }),
    prisma.tutorialResource.createMany({
      data: body.tutorialIds.map((tutorialId, position) => ({ tutorialId, resourceId, position })),
    }),
  ]);
}

adminResourcesRouter.post(
  '/',
  limiters.write,
  validate(resourceBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof resourceBody>;
    const slug = await uniqueSlug(body.slug || body.title);

    const resource = await prisma.resource.create({
      data: {
        publicDownloadToken: generateDownloadToken(),
        title: body.title,
        slug,
        shortDescription: body.shortDescription,
        fullDescription: body.fullDescription,
        categoryId: body.categoryId,
        subcategoryId: body.subcategoryId ?? null,
        licenseId: body.licenseId ?? null,
        installationGuide: body.installationGuide,
        requirements: body.requirements,
        format: body.format ?? null,
        previewType: body.previewType,
        featured: body.featured,
        qualityFlags: body.qualityFlags,
        seoTitle: body.seoTitle ?? null,
        seoDescription: body.seoDescription ?? null,
        status: 'DRAFT',
      },
    });

    await writeRelations(resource.id, body);
    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'resource.created',
      targetType: 'resource',
      targetId: resource.id,
      metadata: { title: resource.title },
    });

    const full = await prisma.resource.findUniqueOrThrow({
      where: { id: resource.id },
      include: resourceDetailInclude,
    });
    res.status(201).json({ resource: toResourceDetail(full) });
  }),
);

adminResourcesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const resource = await prisma.resource.findUnique({
      where: { id: req.params.id },
      include: resourceDetailInclude,
    });
    if (!resource) throw notFound('That resource does not exist.');
    res.json({
      resource: {
        ...toResourceDetail(resource),
        // Admin needs the raw editing state, including unpublished links.
        scheduledFor: resource.scheduledFor?.toISOString() ?? null,
        allVersions: resource.versions.map((v) => ({
          id: v.id,
          version: v.version,
          releaseNotes: v.releaseNotes,
          fileSize: Number(v.fileSize),
          fileSizeLabel: formatBytes(Number(v.fileSize)),
          originalName: v.originalName,
          checksum: v.checksum,
          compatibility: v.compatibility,
          retired: v.retired,
          isCurrent: v.id === resource.currentVersionId,
          publishedAt: v.publishedAt.toISOString(),
        })),
        tutorialIds: resource.tutorials.map((t) => t.tutorial.id),
        relatedIds: resource.relatedFrom.map((r) => r.to.id),
      },
    });
  }),
);

adminResourcesRouter.patch(
  '/:id',
  limiters.write,
  validate(resourceBody.partial().extend({ tags: z.array(z.string()).max(20).optional() })),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof resourceBody>>;
    const existing = await prisma.resource.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('That resource does not exist.');

    const slug =
      body.slug && body.slug !== existing.slug
        ? await uniqueSlug(body.slug, existing.id)
        : existing.slug;

    await prisma.resource.update({
      where: { id: existing.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        slug,
        ...(body.shortDescription !== undefined ? { shortDescription: body.shortDescription } : {}),
        ...(body.fullDescription !== undefined ? { fullDescription: body.fullDescription } : {}),
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.subcategoryId !== undefined ? { subcategoryId: body.subcategoryId } : {}),
        ...(body.licenseId !== undefined ? { licenseId: body.licenseId } : {}),
        ...(body.installationGuide !== undefined ? { installationGuide: body.installationGuide } : {}),
        ...(body.requirements !== undefined ? { requirements: body.requirements } : {}),
        ...(body.format !== undefined ? { format: body.format } : {}),
        ...(body.previewType !== undefined ? { previewType: body.previewType } : {}),
        ...(body.featured !== undefined ? { featured: body.featured } : {}),
        ...(body.qualityFlags !== undefined ? { qualityFlags: body.qualityFlags } : {}),
        ...(body.seoTitle !== undefined ? { seoTitle: body.seoTitle } : {}),
        ...(body.seoDescription !== undefined ? { seoDescription: body.seoDescription } : {}),
      },
    });

    if (body.tags || body.software || body.relatedIds || body.tutorialIds) {
      await writeRelations(existing.id, {
        ...(body as z.infer<typeof resourceBody>),
        tags: body.tags ?? [],
        software: body.software ?? [],
        relatedIds: body.relatedIds ?? [],
        tutorialIds: body.tutorialIds ?? [],
      });
    }

    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'resource.updated',
      targetType: 'resource',
      targetId: existing.id,
      metadata: { title: body.title ?? existing.title },
    });

    const full = await prisma.resource.findUniqueOrThrow({
      where: { id: existing.id },
      include: resourceDetailInclude,
    });
    res.json({ resource: toResourceDetail(full) });
  }),
);

/** Attach media (thumbnail / preview / gallery) from a completed upload. */
const mediaSchema = z.object({
  uploadSessionId: z.string().cuid(),
  slot: z.enum(['thumbnail', 'preview', 'previewPoster', 'previewBefore', 'previewAfter', 'ogImage', 'gallery']),
  caption: z.string().trim().max(160).optional(),
});

adminResourcesRouter.post(
  '/:id/media',
  limiters.upload,
  validate(mediaSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof mediaSchema>;
    const resource = await prisma.resource.findUnique({ where: { id: req.params.id } });
    if (!resource) throw notFound('That resource does not exist.');

    if (body.slot === 'gallery') {
      const promoted = await promoteUpload({
        uploadSessionId: body.uploadSessionId,
        adminId: req.user!.id,
        targetKey: objectKeys.resourcePreview(resource.id),
        expectedPurpose: ['preview', 'thumbnail'],
      });
      const last = await prisma.resourceMedia.findFirst({
        where: { resourceId: resource.id },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const media = await prisma.resourceMedia.create({
        data: {
          resourceId: resource.id,
          objectKey: promoted.objectKey,
          contentType: promoted.contentType,
          caption: body.caption ?? null,
          position: (last?.position ?? -1) + 1,
        },
      });
      return res.status(201).json({ mediaId: media.id });
    }

    const keyFor: Record<string, string> = {
      thumbnail: objectKeys.resourceThumbnail(resource.id),
      preview: objectKeys.resourcePreview(resource.id, 'main'),
      previewPoster: objectKeys.resourcePreview(resource.id, 'poster'),
      previewBefore: objectKeys.resourcePreview(resource.id, 'before'),
      previewAfter: objectKeys.resourcePreview(resource.id, 'after'),
      ogImage: objectKeys.resourceOgImage(resource.id),
    };
    const promoted = await promoteUpload({
      uploadSessionId: body.uploadSessionId,
      adminId: req.user!.id,
      targetKey: keyFor[body.slot],
      expectedPurpose: ['thumbnail', 'preview'],
    });

    const fieldFor: Record<string, string> = {
      thumbnail: 'thumbnailKey',
      preview: 'previewKey',
      previewPoster: 'previewPosterKey',
      previewBefore: 'previewBeforeKey',
      previewAfter: 'previewAfterKey',
      ogImage: 'ogImageKey',
    };
    await prisma.resource.update({
      where: { id: resource.id },
      data: { [fieldFor[body.slot]]: promoted.objectKey },
    });
    res.json({ ok: true, slot: body.slot });
  }),
);

adminResourcesRouter.delete(
  '/:id/media/:mediaId',
  limiters.write,
  asyncHandler(async (req, res) => {
    const media = await prisma.resourceMedia.findFirst({
      where: { id: req.params.mediaId, resourceId: req.params.id },
    });
    if (!media) throw notFound('That media item does not exist.');
    await prisma.resourceMedia.delete({ where: { id: media.id } });
    await storage.delete(media.objectKey).catch(() => {});
    res.json({ ok: true });
  }),
);

/** Versions (PRD §34). */
const versionSchema = z.object({
  uploadSessionId: z.string().cuid(),
  version: z.string().trim().min(1, 'Give the version a name, like 1.2.').max(40),
  releaseNotes: z.string().max(5000).default(''),
  compatibility: z.string().max(300).default(''),
  makeCurrent: z.boolean().default(true),
  notifyDownloaders: z.boolean().default(false),
});

adminResourcesRouter.post(
  '/:id/versions',
  limiters.upload,
  validate(versionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof versionSchema>;
    const resource = await prisma.resource.findUnique({ where: { id: req.params.id } });
    if (!resource) throw notFound('That resource does not exist.');

    const clash = await prisma.resourceVersion.findUnique({
      where: { resourceId_version: { resourceId: resource.id, version: body.version } },
      select: { id: true },
    });
    if (clash) throw conflict(`Version ${body.version} already exists for this resource.`);

    // Create the row first so the object key can reference its id.
    const draft = await prisma.resourceVersion.create({
      data: {
        resourceId: resource.id,
        version: body.version,
        releaseNotes: body.releaseNotes,
        compatibility: body.compatibility,
        objectKey: 'pending',
        originalName: 'pending',
        fileSize: BigInt(0),
        contentType: 'application/octet-stream',
      },
    });

    try {
      const promoted = await promoteUpload({
        uploadSessionId: body.uploadSessionId,
        adminId: req.user!.id,
        targetKey: objectKeys.resourceVersion(resource.id, draft.id),
        expectedPurpose: 'resource-file',
      });
      const version = await prisma.resourceVersion.update({
        where: { id: draft.id },
        data: {
          objectKey: promoted.objectKey,
          originalName: promoted.originalName,
          contentType: promoted.contentType,
          fileSize: BigInt(promoted.size),
          checksum: promoted.checksum,
        },
      });

      if (body.makeCurrent) {
        await prisma.resource.update({
          where: { id: resource.id },
          data: { currentVersionId: version.id },
        });
      }

      await recordAudit({
        req,
        actorLabel: req.user!.email,
        action: 'version.created',
        targetType: 'resource',
        targetId: resource.id,
        metadata: { version: version.version, size: promoted.size },
      });

      // Only notify when the resource is actually public and the admin opts in.
      if (body.notifyDownloaders && resource.status === 'PUBLISHED' && body.makeCurrent) {
        await fanOutNotification({
          type: 'RESOURCE_UPDATED',
          title: `${resource.title} ${version.version} is available`,
          body: body.releaseNotes.slice(0, 200) || 'A new version is ready to download.',
          link: `/resources/${resource.slug}`,
          resourceId: resource.id,
        });
      }

      res.status(201).json({
        version: {
          id: version.id,
          version: version.version,
          fileSize: Number(version.fileSize),
          fileSizeLabel: formatBytes(Number(version.fileSize)),
          checksum: version.checksum,
          originalName: version.originalName,
          isCurrent: body.makeCurrent,
        },
      });
    } catch (err) {
      // Never leave a half-written version row behind.
      await prisma.resourceVersion.delete({ where: { id: draft.id } }).catch(() => {});
      throw err;
    }
  }),
);

const versionPatch = z.object({
  releaseNotes: z.string().max(5000).optional(),
  compatibility: z.string().max(300).optional(),
  retired: z.boolean().optional(),
  makeCurrent: z.boolean().optional(),
});

adminResourcesRouter.patch(
  '/:id/versions/:versionId',
  limiters.write,
  validate(versionPatch),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof versionPatch>;
    const version = await prisma.resourceVersion.findFirst({
      where: { id: req.params.versionId, resourceId: req.params.id },
      include: { resource: { select: { currentVersionId: true } } },
    });
    if (!version) throw notFound('That version does not exist.');

    if (body.retired && version.resource.currentVersionId === version.id) {
      throw badRequest('Make another version current before retiring this one.');
    }

    await prisma.resourceVersion.update({
      where: { id: version.id },
      data: {
        ...(body.releaseNotes !== undefined ? { releaseNotes: body.releaseNotes } : {}),
        ...(body.compatibility !== undefined ? { compatibility: body.compatibility } : {}),
        ...(body.retired !== undefined ? { retired: body.retired } : {}),
      },
    });

    if (body.makeCurrent) {
      if (version.retired) throw badRequest('A retired version cannot be made current.');
      await prisma.resource.update({
        where: { id: req.params.id },
        data: { currentVersionId: version.id },
      });
      await recordAudit({
        req,
        actorLabel: req.user!.email,
        action: 'version.made_current',
        targetType: 'resource',
        targetId: req.params.id,
        metadata: { version: version.version },
      });
    }

    res.json({ ok: true });
  }),
);

/** Publishing (PRD §43). */
const publishSchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'SCHEDULED', 'UNLISTED', 'ARCHIVED']),
  scheduledFor: z.string().datetime().nullable().optional(),
  notify: z.boolean().default(false),
});

adminResourcesRouter.post(
  '/:id/status',
  limiters.write,
  validate(publishSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof publishSchema>;
    const resource = await prisma.resource.findUnique({
      where: { id: req.params.id },
      include: { currentVersion: true, category: { select: { id: true } } },
    });
    if (!resource) throw notFound('That resource does not exist.');

    // A public resource must actually be downloadable (PRD §102).
    if ((body.status === 'PUBLISHED' || body.status === 'UNLISTED') && !resource.currentVersionId) {
      throw badRequest('Add a downloadable file before publishing this resource.');
    }
    if (body.status === 'SCHEDULED') {
      if (!body.scheduledFor) throw badRequest('Choose a date and time to publish.');
      if (new Date(body.scheduledFor) <= new Date()) {
        throw badRequest('Choose a time in the future, or publish it now.');
      }
    }

    const wasPublic = resource.status === 'PUBLISHED';
    const updated = await prisma.resource.update({
      where: { id: resource.id },
      data: {
        status: body.status,
        scheduledFor: body.status === 'SCHEDULED' ? new Date(body.scheduledFor!) : null,
        publishedAt:
          body.status === 'PUBLISHED' && !resource.publishedAt ? new Date() : resource.publishedAt,
      },
    });

    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action:
        body.status === 'PUBLISHED'
          ? 'resource.published'
          : body.status === 'ARCHIVED'
            ? 'resource.archived'
            : 'resource.unpublished',
      targetType: 'resource',
      targetId: resource.id,
      metadata: { title: resource.title, status: body.status },
    });

    if (body.notify && body.status === 'PUBLISHED' && !wasPublic) {
      await fanOutNotification({
        type: 'NEW_RESOURCE',
        title: `New: ${resource.title}`,
        body: resource.shortDescription,
        link: `/resources/${resource.slug}`,
        categoryId: resource.categoryId,
      });
    }

    res.json({ status: updated.status, publishedAt: updated.publishedAt?.toISOString() ?? null });
  }),
);

adminResourcesRouter.post(
  '/:id/duplicate',
  limiters.write,
  asyncHandler(async (req, res) => {
    const source = await prisma.resource.findUnique({
      where: { id: req.params.id },
      include: { tags: true, software: true },
    });
    if (!source) throw notFound('That resource does not exist.');

    const copy = await prisma.resource.create({
      data: {
        publicDownloadToken: generateDownloadToken(),
        title: `${source.title} (copy)`,
        slug: await uniqueSlug(`${source.title}-copy`),
        shortDescription: source.shortDescription,
        fullDescription: source.fullDescription,
        categoryId: source.categoryId,
        subcategoryId: source.subcategoryId,
        licenseId: source.licenseId,
        installationGuide: source.installationGuide,
        requirements: source.requirements,
        format: source.format,
        previewType: source.previewType,
        qualityFlags: source.qualityFlags,
        // A copy always starts as a draft with no file and no counts.
        status: 'DRAFT',
      },
    });
    await prisma.resourceTag.createMany({
      data: source.tags.map((t) => ({ resourceId: copy.id, tagId: t.tagId })),
    });
    await prisma.resourceSoftware.createMany({
      data: source.software.map((s) => ({
        resourceId: copy.id,
        softwareId: s.softwareId,
        minVersion: s.minVersion,
        note: s.note,
      })),
    });

    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'resource.duplicated',
      targetType: 'resource',
      targetId: copy.id,
      metadata: { sourceId: source.id },
    });
    res.status(201).json({ id: copy.id, slug: copy.slug });
  }),
);

adminResourcesRouter.delete(
  '/:id',
  limiters.write,
  asyncHandler(async (req, res) => {
    const resource = await prisma.resource.findUnique({
      where: { id: req.params.id },
      include: { versions: true, galleryItems: true },
    });
    if (!resource) throw notFound('That resource does not exist.');

    const keys = [
      ...resource.versions.map((v) => v.objectKey),
      ...resource.galleryItems.map((m) => m.objectKey),
      resource.thumbnailKey,
      resource.previewKey,
      resource.previewPosterKey,
      resource.previewBeforeKey,
      resource.previewAfterKey,
      resource.ogImageKey,
    ].filter((k): k is string => !!k && k !== 'pending');

    // Clear the FK before deleting so the self-reference does not block it.
    await prisma.resource.update({ where: { id: resource.id }, data: { currentVersionId: null } });
    await prisma.resource.delete({ where: { id: resource.id } });
    for (const key of keys) await storage.delete(key).catch(() => {});

    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: 'resource.deleted',
      targetType: 'resource',
      targetId: resource.id,
      metadata: { title: resource.title, objectsRemoved: keys.length },
    });
    res.json({ ok: true });
  }),
);

/** Bulk actions (PRD §42). */
const bulkSchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(100),
  action: z.enum(['publish', 'unpublish', 'archive', 'feature', 'unfeature', 'category']),
  categoryId: z.string().cuid().optional(),
});

adminResourcesRouter.post(
  '/bulk',
  limiters.write,
  validate(bulkSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof bulkSchema>;

    if (body.action === 'publish') {
      // Refuse to publish anything that has no file rather than half-applying.
      const missing = await prisma.resource.findMany({
        where: { id: { in: body.ids }, currentVersionId: null },
        select: { title: true },
      });
      if (missing.length) {
        throw badRequest(
          `${missing.length} of those have no file yet: ${missing.slice(0, 3).map((m) => m.title).join(', ')}.`,
        );
      }
    }
    if (body.action === 'category' && !body.categoryId) {
      throw badRequest('Choose a category to move them into.');
    }

    const data: Prisma.ResourceUncheckedUpdateManyInput =
      body.action === 'publish'
        ? { status: 'PUBLISHED', publishedAt: new Date(), scheduledFor: null }
        : body.action === 'unpublish'
          ? { status: 'DRAFT', scheduledFor: null }
          : body.action === 'archive'
            ? { status: 'ARCHIVED' }
            : body.action === 'feature'
              ? { featured: true }
              : body.action === 'unfeature'
                ? { featured: false }
                : { categoryId: body.categoryId };

    const result = await prisma.resource.updateMany({ where: { id: { in: body.ids } }, data });

    await recordAudit({
      req,
      actorLabel: req.user!.email,
      action: body.action === 'archive' ? 'resource.archived' : 'resource.updated',
      targetType: 'resource',
      metadata: { bulk: true, action: body.action, count: result.count },
    });
    res.json({ ok: true, updated: result.count });
  }),
);
