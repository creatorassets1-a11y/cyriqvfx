/**
 * Storage contract (PRD §6, §15, §35, §37, §38).
 *
 * Production uses Cloudflare R2. A local driver implements the identical
 * contract, including signed, expiring URLs and multipart uploads, so every
 * upload and download path is exercised for real in development and tests.
 * `env.ts` refuses to boot production with anything but the R2 driver.
 */

export interface SignedUpload {
  url: string;
  /** Headers the browser MUST send with the PUT for the signature to validate. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface MultipartInit {
  uploadId: string;
  partSize: number;
}

export interface SignedPart {
  partNumber: number;
  url: string;
  expiresAt: Date;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface ObjectHead {
  size: number;
  contentType?: string;
  etag?: string;
}

export interface StorageDriver {
  readonly name: 'r2' | 'local';

  /** Presigned single-request PUT, for files below the multipart threshold. */
  signUpload(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds?: number;
  }): Promise<SignedUpload>;

  createMultipartUpload(input: { key: string; contentType: string }): Promise<MultipartInit>;

  signUploadPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds?: number;
  }): Promise<SignedPart>;

  completeMultipartUpload(input: {
    key: string;
    uploadId: string;
    parts: CompletedPart[];
  }): Promise<void>;

  abortMultipartUpload(input: { key: string; uploadId: string }): Promise<void>;

  /**
   * Short-lived download grant. Treated as a bearer token, so it is never logged and
   * never used as the site's canonical share URL (PRD §15).
   */
  signDownload(input: {
    key: string;
    expiresInSeconds?: number;
    downloadFilename?: string;
    contentType?: string;
  }): Promise<{ url: string; expiresAt: Date }>;

  /** Cacheable URL for public media (thumbnails/previews) served via CDN. */
  publicUrl(key: string): string | null;

  head(key: string): Promise<ObjectHead | null>;
  delete(key: string): Promise<void>;
  /** Used by tests and by the local driver's own serving route. */
  getBytes(key: string): Promise<Buffer | null>;
  putBytes(input: { key: string; body: Buffer; contentType: string }): Promise<void>;
}
