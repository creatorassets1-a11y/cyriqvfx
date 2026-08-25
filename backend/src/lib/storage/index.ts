import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { R2Storage } from './r2.js';
import { LocalStorage } from './local.js';
import type { StorageDriver } from './types.js';

export * from './types.js';
export { sanitizeFilename } from './r2.js';

export const storage: StorageDriver = env.STORAGE_DRIVER === 'r2' ? new R2Storage() : new LocalStorage();

export const localStorageDriver = storage instanceof LocalStorage ? storage : null;

/**
 * Server-generated object keys (PRD §36, §37). Original filenames are never
 * used as keys. They are stored in PostgreSQL for display only.
 */
export const objectKeys = {
  resourceVersion: (resourceId: string, versionId: string) =>
    `resources/${resourceId}/versions/${versionId}/file`,
  resourcePreview: (resourceId: string, previewId: string = randomUUID()) =>
    `resources/${resourceId}/previews/${previewId}`,
  resourceThumbnail: (resourceId: string) => `resources/${resourceId}/thumbnail`,
  resourceOgImage: (resourceId: string) => `resources/${resourceId}/og-image`,
  tutorialCover: (tutorialId: string) => `tutorials/${tutorialId}/cover`,
  tutorialMedia: (tutorialId: string, mediaId: string = randomUUID()) =>
    `tutorials/${tutorialId}/media/${mediaId}`,
  siteAsset: (name: string) => `site/${name}`,
  /** Staging area for uploads whose owning record does not exist yet. */
  staging: (uploadId: string) => `staging/${uploadId}/file`,
};
