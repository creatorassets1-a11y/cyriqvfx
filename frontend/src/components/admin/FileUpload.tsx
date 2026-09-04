import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Button, Note, cx } from '../../ui/primitives';

/**
 * Uploading a file.
 *
 * The browser sends the bytes straight to object storage using a short-lived
 * signed URL, so a 200 MB pack never travels through the API process. Large
 * files go up in parts, each part signed on its own, which is what makes an
 * interrupted upload recoverable rather than a total loss. The server then
 * verifies what actually landed — size, signature, archive contents — before
 * anything can be attached to a resource.
 */

export type UploadPurpose =
  | 'resource-file'
  | 'thumbnail'
  | 'preview'
  | 'tutorial-media'
  | 'site-asset';

export interface CompletedUpload {
  uploadSessionId: string;
  originalName: string;
  size: number;
  sizeLabel: string;
  checksum: string | null;
  warning?: string;
  duplicateOf?: { resourceId: string; title: string; version: string } | null;
}

interface CreateResponse {
  uploadSessionId: string;
  mode: 'single' | 'multipart';
  url?: string;
  headers?: Record<string, string>;
  partSize?: number;
  partCount?: number;
  duplicateOf?: { resourceId: string; title: string; version: string } | null;
}

type Stage = 'idle' | 'hashing' | 'uploading' | 'verifying' | 'done' | 'failed';

/** A PUT that reports progress, which fetch still cannot do for uploads. */
function put(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress?: (loaded: number) => void,
): Promise<{ etag: string | null }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url, true);

    for (const [name, value] of Object.entries(headers)) {
      // The browser owns these two; setting them is refused anyway.
      if (name.toLowerCase() === 'content-length' || name.toLowerCase() === 'host') continue;
      request.setRequestHeader(name, value);
    }

    request.upload.onprogress = (event) => onProgress?.(event.loaded);
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve({ etag: request.getResponseHeader('ETag') })
        : reject(new Error(`The storage service refused that upload (${request.status}).`));
    request.onerror = () => reject(new Error('The connection dropped during the upload.'));
    request.onabort = () => reject(new Error('That upload was cancelled.'));
    request.send(body);
  });
}

/** SHA-256 in the browser, so the server can warn about an exact duplicate. */
async function checksumOf(file: File): Promise<string | undefined> {
  // Not worth blocking the main thread on a very large file; the server
  // computes the authoritative checksum from the bytes that actually land.
  if (file.size > 64 * 1024 * 1024 || !globalThis.crypto?.subtle) return undefined;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function useUpload(purpose: UploadPurpose) {
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompletedUpload | null>(null);
  const session = useRef<string | null>(null);

  const reset = useCallback(() => {
    setStage('idle');
    setProgress(0);
    setError(null);
    setResult(null);
    session.current = null;
  }, []);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      setResult(null);
      setProgress(0);
      setStage('hashing');

      try {
        const checksum = await checksumOf(file);
        setStage('uploading');

        const created = await api.post<CreateResponse>('/admin/uploads', {
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          purpose,
          ...(checksum ? { checksum } : {}),
        });
        session.current = created.uploadSessionId;

        let parts: Array<{ partNumber: number; etag: string }> | undefined;

        if (created.mode === 'multipart' && created.partSize) {
          parts = [];
          const total = created.partCount ?? Math.ceil(file.size / created.partSize);

          for (let index = 0; index < total; index += 1) {
            const start = index * created.partSize;
            const chunk = file.slice(start, Math.min(start + created.partSize, file.size));
            const signed = await api.post<{ url: string }>(
              `/admin/uploads/${created.uploadSessionId}/part`,
              { partNumber: index + 1 },
            );
            const { etag } = await put(signed.url, chunk, {}, (loaded) =>
              setProgress(Math.round(((start + loaded) / file.size) * 100)),
            );
            if (!etag) throw new Error('Storage did not acknowledge that part.');
            parts.push({ partNumber: index + 1, etag: etag.replace(/"/g, '') });
          }
        } else if (created.url) {
          await put(created.url, file, created.headers ?? {}, (loaded) =>
            setProgress(Math.round((loaded / file.size) * 100)),
          );
        } else {
          throw new Error('The server did not return anywhere to upload to.');
        }

        setProgress(100);
        setStage('verifying');

        const completed = await api.post<{
          uploadSessionId: string;
          size: number;
          sizeLabel: string;
          checksum: string | null;
          originalName: string;
          warning?: string;
        }>(`/admin/uploads/${created.uploadSessionId}/complete`, parts ? { parts } : {});

        setResult({ ...completed, duplicateOf: created.duplicateOf ?? null });
        setStage('done');
      } catch (err) {
        setStage('failed');
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'That upload failed.',
        );

        // Leave nothing half-written in storage behind a failure.
        if (session.current) {
          await api.post(`/admin/uploads/${session.current}/abort`).catch(() => {});
          session.current = null;
        }
      }
    },
    [purpose],
  );

  return { stage, progress, error, result, upload, reset };
}

/**
 * The drop target. The file input covers it completely and is transparent
 * rather than hidden, so clicking, tabbing to it and dropping onto it all
 * reach the same control.
 */
export function FileDrop({
  purpose,
  accept,
  label,
  hint,
  onDone,
}: {
  purpose: UploadPurpose;
  accept?: string;
  label: string;
  hint?: string;
  onDone: (upload: CompletedUpload) => void;
}) {
  const { stage, progress, error, result, upload, reset } = useUpload(purpose);
  const [over, setOver] = useState(false);

  async function handle(file: File | undefined) {
    if (!file) return;
    await upload(file);
  }

  // Reported upwards once, after the server has verified the bytes.
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (!result || reported.current === result.uploadSessionId) return;
    reported.current = result.uploadSessionId;
    onDone(result);
  }, [result, onDone]);

  const busy = stage === 'hashing' || stage === 'uploading' || stage === 'verifying';

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void handle(event.dataTransfer.files[0]);
        }}
        className={cx(
          'relative flex min-h-[7rem] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors duration-fast ease-out',
          over ? 'border-accent bg-accent-wash' : 'border-line-strong bg-inset',
        )}
      >
        <Icon name="upload" size={20} className="text-text-3" />
        <p className="text-[13.5px] text-text-2">{label}</p>
        {hint ? <p className="text-[12px] text-text-4">{hint}</p> : null}

        <input
          type="file"
          accept={accept}
          disabled={busy}
          aria-label={label}
          onChange={(event) => void handle(event.target.files?.[0])}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>

      {busy ? (
        <div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-accent transition-[width] duration-fast ease-out"
              style={{ width: `${stage === 'verifying' ? 100 : progress}%` }}
            />
          </div>
          <p className="mt-1.5 font-mono text-[12px] text-text-3" role="status">
            {stage === 'hashing'
              ? 'reading the file…'
              : stage === 'verifying'
                ? 'checking what arrived…'
                : `uploading ${progress}%`}
          </p>
        </div>
      ) : null}

      {result ? (
        <p className="font-mono text-[12.5px] text-positive" role="status">
          {result.originalName} / {result.sizeLabel || formatBytes(result.size)} / ready
        </p>
      ) : null}

      {result?.duplicateOf ? (
        <Note tone="caution">
          The same file is already published as {result.duplicateOf.title} v
          {result.duplicateOf.version}. Adding it again will store a second copy.
        </Note>
      ) : null}

      {result?.warning ? <Note tone="caution">{result.warning}</Note> : null}

      {error ? (
        <div className="flex flex-col items-start gap-2">
          <Note tone="critical">{error}</Note>
          <Button size="sm" onClick={reset}>
            Try another file
          </Button>
        </div>
      ) : null}
    </div>
  );
}
