import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  StorageDriver,
  SignedUpload,
  MultipartInit,
  SignedPart,
  CompletedPart,
  ObjectHead,
} from './types.js';
import { env } from '../../config/env.js';
import { sanitizeFilename } from './r2.js';

/**
 * Development/test driver. It mirrors the R2 contract exactly: signed URLs
 * that expire, multipart uploads assembled from parts, range-friendly reads, so
 * so the same code paths run in tests as in production. `env.ts` refuses to
 * boot production with this driver.
 */
export class LocalStorage implements StorageDriver {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor() {
    this.root = path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR);
  }

  private objectPath(key: string): string {
    // Keys are server-generated, but defence in depth against traversal.
    const safe = key
      .split('/')
      .map((seg) => seg.replace(/[^\w.-]/g, '_'))
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/');
    return path.join(this.root, 'objects', safe);
  }

  private partsDir(uploadId: string): string {
    return path.join(this.root, 'multipart', uploadId.replace(/[^\w-]/g, ''));
  }

  private sign(payload: string): string {
    return createHmac('sha256', env.AUTH_SECRET).update(payload).digest('hex');
  }

  private buildSignedUrl(op: 'put' | 'get' | 'part', key: string, extra: Record<string, string>, expiresIn: number) {
    const exp = Math.floor(Date.now() / 1000) + expiresIn;
    const params = new URLSearchParams({ key, op, exp: String(exp), ...extra });
    const signature = this.sign(params.toString());
    params.set('sig', signature);
    return {
      // Relative, so the upload is always same-origin with the page. An
      // absolute URL built from a configured host makes the browser treat an
      // otherwise identical origin (localhost vs 127.0.0.1) as cross-origin
      // and preflight the PUT. R2 signs absolute URLs and needs bucket CORS
      // instead. See docs/deployment.md.
      url: `/api/_local-storage?${params.toString()}`,
      expiresAt: new Date(exp * 1000),
    };
  }

  /** Verifies a signed local-storage URL. Returns null when invalid or expired. */
  verify(params: URLSearchParams): { key: string; op: string; uploadId?: string; partNumber?: string } | null {
    const sig = params.get('sig');
    if (!sig) return null;
    const copy = new URLSearchParams(params);
    copy.delete('sig');
    const expected = this.sign(copy.toString());
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const exp = Number(params.get('exp') ?? 0);
    if (!exp || exp * 1000 < Date.now()) return null;
    const key = params.get('key');
    const op = params.get('op');
    if (!key || !op) return null;
    return {
      key,
      op,
      uploadId: params.get('uploadId') ?? undefined,
      partNumber: params.get('partNumber') ?? undefined,
    };
  }

  async signUpload(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds?: number;
  }): Promise<SignedUpload> {
    const { url, expiresAt } = this.buildSignedUrl(
      'put',
      input.key,
      { ct: input.contentType, len: String(input.contentLength) },
      input.expiresInSeconds ?? 900,
    );
    return {
      url,
      headers: { 'Content-Type': input.contentType, 'Content-Length': String(input.contentLength) },
      expiresAt,
    };
  }

  async createMultipartUpload(input: { key: string; contentType: string }): Promise<MultipartInit> {
    const uploadId = randomUUID();
    await mkdir(this.partsDir(uploadId), { recursive: true });
    await writeFile(
      path.join(this.partsDir(uploadId), 'meta.json'),
      JSON.stringify({ key: input.key, contentType: input.contentType }),
    );
    return { uploadId, partSize: 5 * 1024 * 1024 };
  }

  async signUploadPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds?: number;
  }): Promise<SignedPart> {
    const { url, expiresAt } = this.buildSignedUrl(
      'part',
      input.key,
      { uploadId: input.uploadId, partNumber: String(input.partNumber) },
      input.expiresInSeconds ?? 3600,
    );
    return { partNumber: input.partNumber, url, expiresAt };
  }

  async writePart(uploadId: string, partNumber: number, body: Buffer): Promise<string> {
    const dir = this.partsDir(uploadId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `part-${String(partNumber).padStart(5, '0')}`), body);
    return createHmac('sha256', 'etag').update(body).digest('hex');
  }

  async completeMultipartUpload(input: {
    key: string;
    uploadId: string;
    parts: CompletedPart[];
  }): Promise<void> {
    const dir = this.partsDir(input.uploadId);
    const files = (await readdir(dir)).filter((f) => f.startsWith('part-')).sort();
    if (files.length === 0) throw new Error('No uploaded parts found for this upload');
    const chunks: Buffer[] = [];
    for (const f of files) chunks.push(await readFile(path.join(dir, f)));
    const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8')) as {
      contentType: string;
    };
    await this.putBytes({
      key: input.key,
      body: Buffer.concat(chunks),
      contentType: meta.contentType,
    });
    await rm(dir, { recursive: true, force: true });
  }

  async abortMultipartUpload(input: { key: string; uploadId: string }): Promise<void> {
    await rm(this.partsDir(input.uploadId), { recursive: true, force: true });
  }

  async signDownload(input: {
    key: string;
    expiresInSeconds?: number;
    downloadFilename?: string;
    contentType?: string;
  }): Promise<{ url: string; expiresAt: Date }> {
    const extra: Record<string, string> = {};
    if (input.downloadFilename) extra.fn = sanitizeFilename(input.downloadFilename);
    if (input.contentType) extra.ct = input.contentType;
    return this.buildSignedUrl('get', input.key, extra, input.expiresInSeconds ?? env.DOWNLOAD_URL_TTL_SECONDS);
  }

  publicUrl(key: string): string | null {
    // Relative on purpose: the page and its media are same-origin, so this
    // works behind any host or port without a configured base URL, and never
    // trips a strict img-src policy. Absolute URLs are only needed for OG
    // images, which build their own from PUBLIC_SITE_URL.
    return `/api/media/${encodeURIComponent(key)}`;
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const s = await stat(this.objectPath(key));
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.objectPath(key), { force: true });
  }

  async getBytes(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.objectPath(key));
    } catch {
      return null;
    }
  }

  async putBytes(input: { key: string; body: Buffer; contentType: string }): Promise<void> {
    const p = this.objectPath(input.key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, input.body);
    await writeFile(`${p}.meta`, JSON.stringify({ contentType: input.contentType }));
  }

  async contentTypeOf(key: string): Promise<string | undefined> {
    try {
      const raw = await readFile(`${this.objectPath(key)}.meta`, 'utf8');
      return (JSON.parse(raw) as { contentType?: string }).contentType;
    } catch {
      return undefined;
    }
  }
}
