import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  StorageDriver,
  SignedUpload,
  MultipartInit,
  SignedPart,
  CompletedPart,
  ObjectHead,
} from './types.js';
import { env } from '../../config/env.js';
import { storageFailure } from '../errors.js';

/** R2 requires parts of at least 5 MiB (except the final part). */
const MIN_PART_SIZE = 5 * 1024 * 1024;
const TARGET_PART_SIZE = 16 * 1024 * 1024;

export class R2Storage implements StorageDriver {
  readonly name = 'r2' as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = env.R2_BUCKET!;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  private expiry(seconds: number): Date {
    return new Date(Date.now() + seconds * 1000);
  }

  async signUpload(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds?: number;
  }): Promise<SignedUpload> {
    const expiresIn = input.expiresInSeconds ?? 900;
    try {
      // ContentType and ContentLength are part of the signature, so the browser
      // cannot upload a different type or a larger body than we authorised.
      const url = await getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          ContentType: input.contentType,
          ContentLength: input.contentLength,
        }),
        { expiresIn },
      );
      return {
        url,
        headers: {
          'Content-Type': input.contentType,
          'Content-Length': String(input.contentLength),
        },
        expiresAt: this.expiry(expiresIn),
      };
    } catch (cause) {
      throw storageFailure('Could not start the upload.', cause);
    }
  }

  async createMultipartUpload(input: { key: string; contentType: string }): Promise<MultipartInit> {
    try {
      const res = await this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: input.key,
          ContentType: input.contentType,
        }),
      );
      if (!res.UploadId) throw new Error('R2 did not return an UploadId');
      return { uploadId: res.UploadId, partSize: Math.max(TARGET_PART_SIZE, MIN_PART_SIZE) };
    } catch (cause) {
      throw storageFailure('Could not start the multipart upload.', cause);
    }
  }

  async signUploadPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds?: number;
  }): Promise<SignedPart> {
    const expiresIn = input.expiresInSeconds ?? 3600;
    try {
      const url = await getSignedUrl(
        this.client,
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: input.key,
          UploadId: input.uploadId,
          PartNumber: input.partNumber,
        }),
        { expiresIn },
      );
      return { partNumber: input.partNumber, url, expiresAt: this.expiry(expiresIn) };
    } catch (cause) {
      throw storageFailure('Could not sign the upload part.', cause);
    }
  }

  async completeMultipartUpload(input: {
    key: string;
    uploadId: string;
    parts: CompletedPart[];
  }): Promise<void> {
    try {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: input.key,
          UploadId: input.uploadId,
          MultipartUpload: {
            Parts: input.parts
              .slice()
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    } catch (cause) {
      throw storageFailure('Could not finish the upload.', cause);
    }
  }

  async abortMultipartUpload(input: { key: string; uploadId: string }): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: input.key,
          UploadId: input.uploadId,
        }),
      );
    } catch (cause) {
      throw storageFailure('Could not abort the upload.', cause);
    }
  }

  async signDownload(input: {
    key: string;
    expiresInSeconds?: number;
    downloadFilename?: string;
    contentType?: string;
  }): Promise<{ url: string; expiresAt: Date }> {
    const expiresIn = input.expiresInSeconds ?? env.DOWNLOAD_URL_TTL_SECONDS;
    try {
      const url = await getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          // R2 serves this object directly and honours HTTP range requests, so
          // large downloads resume without touching the Node process.
          ResponseContentDisposition: input.downloadFilename
            ? `attachment; filename="${sanitizeFilename(input.downloadFilename)}"`
            : undefined,
          ResponseContentType: input.contentType,
        }),
        { expiresIn },
      );
      return { url, expiresAt: this.expiry(expiresIn) };
    } catch (cause) {
      throw storageFailure('Could not prepare the download.', cause);
    }
  }

  publicUrl(key: string): string | null {
    if (!env.R2_PUBLIC_BASE_URL) return null;
    return `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: Number(res.ContentLength ?? 0),
        contentType: res.ContentType,
        etag: res.ETag?.replaceAll('"', ''),
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw storageFailure('Could not read the stored file.', err);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (cause) {
      throw storageFailure('Could not delete the stored file.', cause);
    }
  }

  async getBytes(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (isNotFound(err)) return null;
      throw storageFailure('Could not read the stored file.', err);
    }
  }

  async putBytes(input: { key: string; body: Buffer; contentType: string }): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
        }),
      );
    } catch (cause) {
      throw storageFailure('Could not store the file.', cause);
    }
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-() ]+/g, '_').slice(0, 180);
}
