/**
 * The shapes the API actually returns.
 *
 * These mirror backend/src/modules/dto.ts and the route handlers. They are
 * written out rather than inferred so a change on the server shows up here as
 * a type error instead of as an empty space on a page.
 */

export type ContentStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'UNLISTED' | 'ARCHIVED';
export type PreviewType = 'VIDEO' | 'IMAGE' | 'BEFORE_AFTER' | 'AUDIO' | 'GALLERY' | 'NONE';
export type SkillLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type QualityFlag =
  | 'FEATURED'
  | 'CREATOR_PICK'
  | 'BEGINNER_FRIENDLY'
  | 'ADVANCED'
  | 'EXPERIMENTAL';

/** A named thing the visitor can filter or navigate by. */
export interface Ref {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
}

export interface ResourceCard {
  id: string;
  title: string;
  slug: string;
  shortDescription: string;
  status: ContentStatus;
  featured: boolean;
  qualityFlags: QualityFlag[];
  previewType: PreviewType;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  previewPosterUrl: string | null;
  format: string | null;
  downloadCount: number;
  publishedAt: string | null;
  updatedAt: string;
  downloadToken: string;
  category: Ref;
  software: Ref[];
  version: string | null;
  fileSize: number | null;
  fileSizeLabel: string | null;
  isNew: boolean;
  isUpdated: boolean;
}

export interface License {
  id: string;
  name: string;
  slug: string;
  summary: string;
  personalUse: boolean;
  commercialUse: boolean;
  modification: boolean;
  redistribution: boolean;
  resale: boolean;
  attributionRequired: boolean;
  customText: string | null;
}

export interface Version {
  id: string;
  version: string;
  releaseNotes: string;
  fileSize: number;
  fileSizeLabel: string;
  compatibility: string;
  checksum: string | null;
  originalName: string;
  publishedAt: string;
  isCurrent: boolean;
}

export interface GalleryItem {
  id: string;
  url: string | null;
  contentType: string;
  caption: string | null;
  width: number | null;
  height: number | null;
}

export interface LinkedTutorial {
  id: string;
  title: string;
  slug: string;
  summary: string;
  coverUrl: string | null;
  durationSeconds: number | null;
  skillLevel: SkillLevel;
  note: string | null;
}

export interface Resource extends ResourceCard {
  fullDescription: string;
  installationGuide: string;
  requirements: string;
  subcategory: Ref | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  viewCount: number;
  saveCount: number;
  previewBeforeUrl: string | null;
  previewAfterUrl: string | null;
  license: License | null;
  tags: Ref[];
  softwareCompatibility: Array<Ref & { minVersion: string | null; note: string | null }>;
  gallery: GalleryItem[];
  versions: Version[];
  related: ResourceCard[];
  tutorials: LinkedTutorial[];
  originalFilename: string | null;
  saved: boolean;
}

/** What the resource editor needs on top of the public detail payload. */
export interface AdminResource extends Resource {
  scheduledFor: string | null;
  allVersions: Array<Version & { retired: boolean }>;
  tutorialIds: string[];
  relatedIds: string[];
}

export interface TutorialCard {
  id: string;
  title: string;
  slug: string;
  summary: string;
  coverUrl: string | null;
  durationSeconds: number | null;
  skillLevel: SkillLevel;
  status: ContentStatus;
  featured: boolean;
  publishedAt: string | null;
  updatedAt: string;
  viewCount: number;
  category: Ref | null;
  software: Ref[];
  resourceCount: number;
}

export interface Tutorial extends Omit<TutorialCard, 'resourceCount'> {
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
  videoUrl: string | null;
  isExternalVideo: boolean;
  transcript: string | null;
  ogImageUrl: string | null;
  tags: Ref[];
  steps: Array<{
    id: string;
    position: number;
    title: string;
    body: string;
    timestampSeconds: number | null;
  }>;
  resources: Array<ResourceCard & { note: string | null }>;
  related: TutorialCard[];
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  position: number;
  parentId: string | null;
  status: string;
  seoTitle: string | null;
  seoDescription: string | null;
  resourceCount: number;
  children: Array<{
    id: string;
    name: string;
    slug: string;
    icon: string | null;
    position: number;
    resourceCount: number;
  }>;
}

export interface Paged<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface Facets {
  categories: Array<{ id: string; name: string; slug: string; icon: string | null; count: number }>;
  software: Array<{ id: string; name: string; slug: string; count: number }>;
  licenses: Array<{ id: string; name: string; slug: string; commercialUse: boolean; count: number }>;
  formats: Array<{ value: string; count: number }>;
  tags: Array<{ id: string; name: string; slug: string; count: number }>;
}

export interface HomePayload {
  latest: ResourceCard[];
  featured: Resource | null;
  popular: ResourceCard[];
  recentlyUpdated: ResourceCard[];
  categories: Array<{
    id: string;
    name: string;
    slug: string;
    icon: string | null;
    description: string | null;
    resourceCount: number;
  }>;
  tutorials: Array<{
    id: string;
    title: string;
    slug: string;
    summary: string;
    coverUrl: string | null;
    durationSeconds: number | null;
    skillLevel: SkillLevel;
    publishedAt: string | null;
    resourceCount: number;
  }>;
  stats: { resourceCount: number; downloadCount: number };
}

export interface CategoryPayload {
  category: Category;
  featured: ResourceCard[];
  latest: ResourceCard[];
  popular: ResourceCard[];
  total: number;
}

export interface SearchPayload {
  query: string;
  resources: ResourceCard[];
  tutorials: Array<{
    id: string;
    title: string;
    slug: string;
    summary: string;
    coverUrl: string | null;
    durationSeconds: number | null;
    skillLevel: SkillLevel;
  }>;
  categories: Array<{ id: string; name: string; slug: string }>;
  total: number;
  suggestions: Array<{ label: string; href: string }>;
}

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: 'USER' | 'ADMIN';
  status: string;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface SiteSettings {
  siteName: string;
  tagline: string;
  heroTitle: string;
  heroSubtitle: string;
  heroPrimaryCta: string;
  heroSecondaryCta: string;
  aboutTitle: string;
  aboutBody: string;
  creatorName: string;
  contactEmail: string;
  announcement: { enabled: boolean; text: string; href: string };
  social: { youtube: string; instagram: string; tiktok: string; x: string; discord: string };
  seo: { defaultTitle: string; defaultDescription: string };
  downloadMessage: string;
  footerNote: string;
}

/** A short-lived, signed URL for one file, plus what to tell the visitor. */
export interface DownloadGrant {
  url: string;
  expiresAt: string;
  filename: string;
  size: number;
  sizeLabel: string;
  version: string | null;
  checksum: string | null;
  resource: { title: string; slug: string };
  suggestAccount: boolean;
}

export interface DownloadInfo {
  title: string;
  slug: string;
  shortDescription: string;
  version: string | null;
  filename: string | null;
  size: number | null;
  sizeLabel: string | null;
}

export interface Notification {
  id: string;
  type: 'NEW_RESOURCE' | 'RESOURCE_UPDATED' | 'TUTORIAL_PUBLISHED' | 'ANNOUNCEMENT';
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationPreference {
  enabled: boolean;
  newResource: boolean;
  resourceUpdates: boolean;
  tutorials: boolean;
  announcements: boolean;
  emailEnabled: boolean;
  categoryIds: string[];
}

export interface DownloadedResource extends ResourceCard {
  downloadedAt: string;
  downloadedVersion: string | null;
  currentVersion: string | null;
  updateAvailable: boolean;
}

export interface AccountOverview {
  counts: { downloads: number; saved: number };
  recentDownloads: DownloadedResource[];
  updatesAvailable: DownloadedResource[];
  saved: ResourceCard[];
}

export interface ChangelogEntry {
  id: string;
  title: string;
  slug: string;
  body: string;
  kind: 'RELEASE' | 'UPDATE' | 'SITE' | 'ANNOUNCEMENT';
  status?: ContentStatus;
  publishedAt: string | null;
  createdAt?: string;
  resources: Array<{ id: string; title: string; slug: string; version: string | null }>;
  tutorials?: Array<{ id: string; title: string; slug: string }>;
  resourceIds?: string[];
  tutorialIds?: string[];
}

export interface ResourceRequest {
  id: string;
  title: string;
  description: string;
  software: string | null;
  status: 'RECEIVED' | 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED';
  adminNote: string | null;
  voteCount: number;
  voted?: boolean;
  requestedBy?: string;
  createdAt: string;
}

export interface Software {
  id: string;
  name: string;
  slug: string;
  position?: number;
  resourceCount?: number;
}

export interface Session {
  id: string;
  current: boolean;
  createdAt: string;
  lastUsedAt: string;
  userAgent: string | null;
}
