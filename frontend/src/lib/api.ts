/**
 * Typed API client.
 *
 * Every request carries cookies, aborts cleanly when a caller goes away, and
 * turns the backend's error envelope into something a component can show a
 * person without inventing a message of its own.
 */

export interface FieldIssue {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: FieldIssue[];

  constructor(status: number, code: string, message: string, issues: FieldIssue[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }

  /** Message for a specific form field, if the server named one. */
  fieldError(field: string): string | undefined {
    return this.issues.find((i) => i.field === field)?.message;
  }

  get isOffline(): boolean {
    return this.status === 0;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Absolute URL (used for signed storage URLs). */
  absolute?: boolean;
}

const BASE = '/api';

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, absolute } = options;
  const url = absolute ? path : `${BASE}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    // A network failure is a real, distinct state, not a generic 500.
    throw new ApiError(
      0,
      'network_error',
      'We could not reach the server. Check your connection and try again.',
    );
  }

  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: FieldIssue[] } })
      ?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'error',
      error?.message ?? 'Something went wrong.',
      Array.isArray(error?.details) ? error.details : [],
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: 'POST', body, signal }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Shared response types
// ---------------------------------------------------------------------------

export type ContentStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'UNLISTED' | 'ARCHIVED';
export type PreviewType = 'VIDEO' | 'IMAGE' | 'BEFORE_AFTER' | 'AUDIO' | 'GALLERY' | 'NONE';
export type SkillLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type QualityFlag =
  | 'FEATURED'
  | 'CREATOR_PICK'
  | 'BEGINNER_FRIENDLY'
  | 'ADVANCED'
  | 'EXPERIMENTAL';

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

export interface LicenseInfo {
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

export interface ResourceVersion {
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

export interface ResourceDetail extends ResourceCard {
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
  license: LicenseInfo | null;
  tags: Ref[];
  softwareCompatibility: Array<Ref & { minVersion: string | null; note: string | null }>;
  gallery: Array<{
    id: string;
    url: string | null;
    contentType: string;
    caption: string | null;
    width: number | null;
    height: number | null;
  }>;
  versions: ResourceVersion[];
  related: ResourceCard[];
  tutorials: Array<{
    id: string;
    title: string;
    slug: string;
    summary: string;
    coverUrl: string | null;
    durationSeconds: number | null;
    skillLevel: SkillLevel;
    note: string | null;
  }>;
  originalFilename: string | null;
  saved: boolean;
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

export interface TutorialDetail extends Omit<TutorialCard, 'resourceCount'> {
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

export interface NotificationItem {
  id: string;
  type: 'NEW_RESOURCE' | 'RESOURCE_UPDATED' | 'TUTORIAL_PUBLISHED' | 'ANNOUNCEMENT';
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

export interface HistoryItem extends ResourceCard {
  downloadedAt: string;
  downloadedVersion: string | null;
  currentVersion: string | null;
  updateAvailable: boolean;
}
