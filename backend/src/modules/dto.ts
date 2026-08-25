import { Prisma } from '@prisma/client';
import { storage } from '../lib/storage/index.js';
import { formatBytes } from '../lib/fileValidation.js';

/**
 * One place that turns database rows into the shapes the client consumes.
 * Storage keys never leave the server. They become media URLs here.
 */

export function mediaUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return storage.publicUrl(key);
}

export const resourceCardSelect = {
  id: true,
  title: true,
  slug: true,
  shortDescription: true,
  status: true,
  featured: true,
  qualityFlags: true,
  previewType: true,
  thumbnailKey: true,
  previewKey: true,
  previewPosterKey: true,
  format: true,
  downloadCount: true,
  publishedAt: true,
  updatedAt: true,
  publicDownloadToken: true,
  category: { select: { id: true, name: true, slug: true, icon: true } },
  software: { select: { software: { select: { id: true, name: true, slug: true } } } },
  currentVersion: { select: { id: true, version: true, fileSize: true, publishedAt: true } },
} satisfies Prisma.ResourceSelect;

type ResourceCardRow = Prisma.ResourceGetPayload<{ select: typeof resourceCardSelect }>;

const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const UPDATED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function toResourceCard(r: ResourceCardRow) {
  const publishedAt = r.publishedAt?.toISOString() ?? null;
  const isNew = r.publishedAt ? Date.now() - r.publishedAt.getTime() < NEW_WINDOW_MS : false;
  // "Updated" only counts when a new version landed after first publication.
  const versionAt = r.currentVersion?.publishedAt?.getTime();
  const isUpdated =
    !isNew &&
    !!versionAt &&
    !!r.publishedAt &&
    versionAt > r.publishedAt.getTime() &&
    Date.now() - versionAt < UPDATED_WINDOW_MS;

  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    shortDescription: r.shortDescription,
    status: r.status,
    featured: r.featured,
    qualityFlags: r.qualityFlags,
    previewType: r.previewType,
    thumbnailUrl: mediaUrl(r.thumbnailKey),
    previewUrl: mediaUrl(r.previewKey),
    previewPosterUrl: mediaUrl(r.previewPosterKey ?? r.thumbnailKey),
    format: r.format,
    downloadCount: r.downloadCount,
    publishedAt,
    updatedAt: r.updatedAt.toISOString(),
    downloadToken: r.publicDownloadToken,
    category: r.category,
    software: r.software.map((s) => s.software),
    version: r.currentVersion?.version ?? null,
    fileSize: r.currentVersion ? Number(r.currentVersion.fileSize) : null,
    fileSizeLabel: r.currentVersion ? formatBytes(Number(r.currentVersion.fileSize)) : null,
    isNew,
    isUpdated,
  };
}

export type ResourceCard = ReturnType<typeof toResourceCard>;

export const resourceDetailInclude = {
  category: { select: { id: true, name: true, slug: true, icon: true, description: true } },
  subcategory: { select: { id: true, name: true, slug: true } },
  license: true,
  currentVersion: true,
  versions: { orderBy: { publishedAt: 'desc' } },
  tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
  software: {
    select: {
      minVersion: true,
      note: true,
      software: { select: { id: true, name: true, slug: true } },
    },
  },
  galleryItems: { orderBy: { position: 'asc' } },
  relatedFrom: {
    orderBy: { position: 'asc' },
    select: { to: { select: resourceCardSelect } },
  },
  tutorials: {
    select: {
      note: true,
      tutorial: {
        select: {
          id: true,
          title: true,
          slug: true,
          summary: true,
          coverKey: true,
          durationSeconds: true,
          skillLevel: true,
          status: true,
        },
      },
    },
  },
} satisfies Prisma.ResourceInclude;

type ResourceDetailRow = Prisma.ResourceGetPayload<{ include: typeof resourceDetailInclude }>;

export function toResourceDetail(r: ResourceDetailRow) {
  return {
    ...toResourceCard(r as unknown as ResourceCardRow),
    fullDescription: r.fullDescription,
    installationGuide: r.installationGuide,
    requirements: r.requirements,
    subcategory: r.subcategory,
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    ogImageUrl: mediaUrl(r.ogImageKey),
    viewCount: r.viewCount,
    saveCount: r.saveCount,
    previewBeforeUrl: mediaUrl(r.previewBeforeKey),
    previewAfterUrl: mediaUrl(r.previewAfterKey),
    license: r.license
      ? {
          id: r.license.id,
          name: r.license.name,
          slug: r.license.slug,
          summary: r.license.summary,
          personalUse: r.license.personalUse,
          commercialUse: r.license.commercialUse,
          modification: r.license.modification,
          redistribution: r.license.redistribution,
          resale: r.license.resale,
          attributionRequired: r.license.attributionRequired,
          customText: r.license.customText,
        }
      : null,
    tags: r.tags.map((t) => t.tag),
    softwareCompatibility: r.software.map((s) => ({
      ...s.software,
      minVersion: s.minVersion,
      note: s.note,
    })),
    gallery: r.galleryItems.map((m) => ({
      id: m.id,
      url: mediaUrl(m.objectKey),
      contentType: m.contentType,
      caption: m.caption,
      width: m.width,
      height: m.height,
    })),
    versions: r.versions
      .filter((v) => !v.retired)
      .map((v) => ({
        id: v.id,
        version: v.version,
        releaseNotes: v.releaseNotes,
        fileSize: Number(v.fileSize),
        fileSizeLabel: formatBytes(Number(v.fileSize)),
        compatibility: v.compatibility,
        checksum: v.checksum,
        originalName: v.originalName,
        publishedAt: v.publishedAt.toISOString(),
        isCurrent: v.id === r.currentVersionId,
      })),
    related: r.relatedFrom.map((rel) => toResourceCard(rel.to)),
    tutorials: r.tutorials
      .filter((t) => t.tutorial.status === 'PUBLISHED')
      .map((t) => ({
        id: t.tutorial.id,
        title: t.tutorial.title,
        slug: t.tutorial.slug,
        summary: t.tutorial.summary,
        coverUrl: mediaUrl(t.tutorial.coverKey),
        durationSeconds: t.tutorial.durationSeconds,
        skillLevel: t.tutorial.skillLevel,
        note: t.note,
      })),
    originalFilename: r.currentVersion?.originalName ?? null,
  };
}

export const tutorialCardSelect = {
  id: true,
  title: true,
  slug: true,
  summary: true,
  coverKey: true,
  durationSeconds: true,
  skillLevel: true,
  status: true,
  featured: true,
  publishedAt: true,
  updatedAt: true,
  viewCount: true,
  category: { select: { id: true, name: true, slug: true } },
  software: { select: { software: { select: { id: true, name: true, slug: true } } } },
  _count: { select: { resources: true } },
} satisfies Prisma.TutorialSelect;

type TutorialCardRow = Prisma.TutorialGetPayload<{ select: typeof tutorialCardSelect }>;

export function toTutorialCard(t: TutorialCardRow) {
  return {
    id: t.id,
    title: t.title,
    slug: t.slug,
    summary: t.summary,
    coverUrl: mediaUrl(t.coverKey),
    durationSeconds: t.durationSeconds,
    skillLevel: t.skillLevel,
    status: t.status,
    featured: t.featured,
    publishedAt: t.publishedAt?.toISOString() ?? null,
    updatedAt: t.updatedAt.toISOString(),
    viewCount: t.viewCount,
    category: t.category,
    software: t.software.map((s) => s.software),
    resourceCount: t._count.resources,
  };
}

export const tutorialDetailInclude = {
  category: { select: { id: true, name: true, slug: true } },
  steps: { orderBy: { position: 'asc' } },
  software: { select: { software: { select: { id: true, name: true, slug: true } } } },
  tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
  resources: {
    orderBy: { position: 'asc' },
    select: { note: true, resource: { select: resourceCardSelect } },
  },
} satisfies Prisma.TutorialInclude;

type TutorialDetailRow = Prisma.TutorialGetPayload<{ include: typeof tutorialDetailInclude }>;

export function toTutorialDetail(t: TutorialDetailRow) {
  return {
    id: t.id,
    title: t.title,
    slug: t.slug,
    summary: t.summary,
    body: t.body,
    coverUrl: mediaUrl(t.coverKey),
    videoUrl: t.videoKey ? mediaUrl(t.videoKey) : t.videoUrl,
    isExternalVideo: !t.videoKey && !!t.videoUrl,
    durationSeconds: t.durationSeconds,
    skillLevel: t.skillLevel,
    status: t.status,
    featured: t.featured,
    transcript: t.transcript,
    seoTitle: t.seoTitle,
    seoDescription: t.seoDescription,
    ogImageUrl: mediaUrl(t.ogImageKey ?? t.coverKey),
    viewCount: t.viewCount,
    publishedAt: t.publishedAt?.toISOString() ?? null,
    updatedAt: t.updatedAt.toISOString(),
    category: t.category,
    software: t.software.map((s) => s.software),
    tags: t.tags.map((x) => x.tag),
    steps: t.steps.map((s) => ({
      id: s.id,
      position: s.position,
      title: s.title,
      body: s.body,
      timestampSeconds: s.timestampSeconds,
    })),
    // Unlisted resources stay reachable by direct link, so a tutorial may
    // legitimately reference one; only drafts and archives are hidden.
    resources: t.resources
      .filter((r) => r.resource.status === 'PUBLISHED' || r.resource.status === 'UNLISTED')
      .map((r) => ({ ...toResourceCard(r.resource), note: r.note })),
  };
}

export function toCategory(c: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  position: number;
  parentId: string | null;
  status: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  _count?: { resources: number };
  children?: Array<{ id: string; name: string; slug: string; icon: string | null; position: number; _count?: { resources: number } }>;
}) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    icon: c.icon,
    position: c.position,
    parentId: c.parentId,
    status: c.status,
    seoTitle: c.seoTitle ?? null,
    seoDescription: c.seoDescription ?? null,
    resourceCount: c._count?.resources ?? 0,
    children:
      c.children?.map((ch) => ({
        id: ch.id,
        name: ch.name,
        slug: ch.slug,
        icon: ch.icon,
        position: ch.position,
        resourceCount: ch._count?.resources ?? 0,
      })) ?? [],
  };
}
