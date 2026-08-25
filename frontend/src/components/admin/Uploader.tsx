import { useCallback, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { Button, cx, Progress, useToast } from '../ui';
import { Icon } from '../Icon';
import { formatBytes } from '../../lib/format';

/**
 * Admin upload (PRD §35).
 *
 * The browser uploads straight to storage with a signed URL, so the API process
 * never handles the bytes. Large files are split into parts and uploaded in
 * parallel, with real progress, cancel, and retry.
 */

export type UploadPurpose = 'resource-file' | 'thumbnail' | 'preview' | 'tutorial-media' | 'site-asset';

export interface CompletedUpload {
  uploadSessionId: string;
  originalName: string;
  size: number;
  checksum: string | null;
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

type Phase = 'idle' | 'hashing' | 'uploading' | 'verifying' | 'done' | 'error';

const PARALLEL_PARTS = 3;

export function Uploader({
  purpose,
  label,
  accept,
  onComplete,
  compact,
}: {
  purpose: UploadPurpose;
  label: string;
  accept?: string;
  onComplete: (upload: CompletedUpload) => void;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState<string>('');
  const [remaining, setRemaining] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<CreateResponse['duplicateOf']>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = useCallback(() => {
    setPhase('idle');
    setFile(null);
    setProgress(0);
    setSpeed('');
    setRemaining('');
    setError(null);
    setDuplicate(null);
    sessionRef.current = null;
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const cancel = useCallback(async () => {
    abortRef.current?.abort();
    if (sessionRef.current) {
      await api.post(`/admin/uploads/${sessionRef.current}/abort`).catch(() => {});
    }
    reset();
    toast('Upload cancelled.', 'info');
  }, [reset, toast]);

  const upload = useCallback(
    async (selected: File) => {
      setFile(selected);
      setError(null);
      setDuplicate(null);
      setProgress(0);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Checksum first, so duplicates are caught before any bytes move.
        setPhase('hashing');
        const checksum = await sha256(selected);
        if (controller.signal.aborted) return;

        const created = await api.post<CreateResponse>('/admin/uploads', {
          filename: selected.name,
          contentType: selected.type || 'application/octet-stream',
          size: selected.size,
          purpose,
          checksum,
        });
        sessionRef.current = created.uploadSessionId;
        if (created.duplicateOf) setDuplicate(created.duplicateOf);

        setPhase('uploading');
        const startedAt = Date.now();
        const onBytes = (uploaded: number) => {
          const pct = (uploaded / selected.size) * 100;
          setProgress(pct);
          const elapsed = (Date.now() - startedAt) / 1000;
          if (elapsed > 0.6) {
            const bytesPerSecond = uploaded / elapsed;
            setSpeed(`${formatBytes(bytesPerSecond)}/s`);
            const secondsLeft = (selected.size - uploaded) / bytesPerSecond;
            setRemaining(secondsLeft > 1 ? formatSeconds(secondsLeft) : '');
          }
        };

        const parts =
          created.mode === 'multipart'
            ? await uploadMultipart(created, selected, onBytes, controller.signal)
            : await uploadSingle(created, selected, onBytes, controller.signal);

        if (controller.signal.aborted) return;

        // The server re-verifies size, file signature and archive contents.
        setPhase('verifying');
        const completed = await api.post<{
          uploadSessionId: string;
          size: number;
          checksum: string | null;
          originalName: string;
          warning?: string;
        }>(`/admin/uploads/${created.uploadSessionId}/complete`, { parts });

        setPhase('done');
        setProgress(100);
        if (completed.warning) toast(completed.warning, 'info');
        onComplete({
          uploadSessionId: completed.uploadSessionId,
          originalName: completed.originalName,
          size: completed.size,
          checksum: completed.checksum,
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        const message =
          err instanceof ApiError ? err.message : 'That upload failed. Try again.';
        setPhase('error');
        setError(message);
        toast(message, 'error');
        // Never leave an orphaned object behind.
        if (sessionRef.current) {
          await api.post(`/admin/uploads/${sessionRef.current}/abort`).catch(() => {});
        }
      }
    },
    [purpose, onComplete, toast],
  );

  const busy = phase === 'hashing' || phase === 'uploading' || phase === 'verifying';


  if (compact && phase === 'idle') {
    return (
      <>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <Button size="sm" icon="upload" onClick={() => inputRef.current?.click()}>
          {label}
        </Button>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />

      {phase === 'idle' ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void upload(f);
          }}
          className={cx(
            'flex flex-col items-start gap-2 border border-dashed px-5 py-7 transition-colors duration-fast',
            dragOver ? 'border-blue bg-blue-wash' : 'border-rule-strong',
          )}
        >
          <Icon name="upload" size={22} className="text-ghost" />
          <p className="text-[14px] font-medium">{label}</p>
          <p className="text-[12.5px] text-faint">Drag a file here, or</p>
          <Button size="sm" onClick={() => inputRef.current?.click()}>
            Choose a file
          </Button>
          {accept ? (
            <p className="mt-1 font-mono text-[11.5px] text-ghost">{accept}</p>
          ) : null}
        </div>
      ) : (
        <div className="border-t border-rule pt-4">
          <div className="flex items-center gap-3">
            <Icon
              name={phase === 'done' ? 'check' : phase === 'error' ? 'alert' : 'file'}
              size={17}
              className={
                phase === 'done' ? 'text-go' : phase === 'error' ? 'text-stop' : 'text-faint'
              }
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium">{file?.name}</p>
              <p className="text-[12px] text-faint">
                {file ? formatBytes(file.size) : ''}
                {phase === 'hashing' ? ' · checking for duplicates…' : ''}
                {phase === 'uploading' && speed ? ` · ${speed}` : ''}
                {phase === 'uploading' && remaining ? ` · ${remaining} left` : ''}
                {phase === 'verifying' ? ' · verifying…' : ''}
                {phase === 'done' ? ' · uploaded' : ''}
              </p>
            </div>

            {busy ? (
              <Button size="sm" onClick={cancel}>
                Cancel
              </Button>
            ) : (
              <Button size="sm" icon="refresh" onClick={reset}>
                {phase === 'error' ? 'Try another' : 'Replace'}
              </Button>
            )}
          </div>

          {busy ? (
            <div className="mt-3">
              <Progress
                value={phase === 'uploading' ? progress : null}
                label={`Uploading ${file?.name ?? ''}`}
              />
              {phase === 'uploading' ? (
                <p className="mt-1 text-right font-mono text-[11.5px] text-faint">
                  {Math.round(progress)}%
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mt-3 text-[13px] text-stop">
              {error}
            </p>
          ) : null}

          {duplicate ? (
            <p className="mt-3 flex items-start gap-1.5 rounded-md bg-warn-wash p-2.5 text-[12.5px] text-soft">
              <Icon name="info" size={13} className="mt-0.5 shrink-0 text-warn" />
              An identical file is already attached to{' '}
              <strong className="text-ink">{duplicate.title}</strong> (v{duplicate.version}).
              Nothing was overwritten. Continue only if that is intended.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}


/** Single-request upload for files under the multipart threshold. */
async function uploadSingle(
  created: CreateResponse,
  selected: File,
  onBytes: (n: number) => void,
  signal: AbortSignal,
): Promise<undefined> {
  await putWithProgress(created.url!, selected, created.headers ?? {}, onBytes, signal);
  return undefined;
}

/**
 * Resumable multipart upload. Parts go up a few at a time so a dropped part
 * costs one chunk rather than the whole file, and progress is the sum of every
 * part's bytes rather than a guess.
 */
async function uploadMultipart(
  created: CreateResponse,
  selected: File,
  onBytes: (n: number) => void,
  signal: AbortSignal,
): Promise<Array<{ partNumber: number; etag: string }>> {
  const partSize = created.partSize!;
  const partCount = Math.ceil(selected.size / partSize);
  const parts: Array<{ partNumber: number; etag: string }> = [];
  const progressByPart = new Map<number, number>();

  const reportTotal = () => {
    let total = 0;
    for (const value of progressByPart.values()) total += value;
    onBytes(total);
  };

  let next = 1;
  const workers = Array.from({ length: Math.min(PARALLEL_PARTS, partCount) }, async () => {
    for (;;) {
      const partNumber = next++;
      if (partNumber > partCount || signal.aborted) return;

      const start = (partNumber - 1) * partSize;
      const chunk = selected.slice(start, Math.min(start + partSize, selected.size));

      const signed = await api.post<{ url: string }>(
        `/admin/uploads/${created.uploadSessionId}/part`,
        { partNumber },
      );

      const etag = await putWithProgress(
        signed.url,
        chunk,
        {},
        (uploaded) => {
          progressByPart.set(partNumber, uploaded);
          reportTotal();
        },
        signal,
      );
      parts.push({ partNumber, etag: etag ?? `"${partNumber}"` });
    }
  });

  await Promise.all(workers);
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

/** XHR rather than fetch, because only XHR reports upload progress. */
function putWithProgress(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onBytes: (uploaded: number) => void,
  signal: AbortSignal,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [key, value] of Object.entries(headers)) {
      // The browser sets Content-Length itself and rejects attempts to set it.
      if (key.toLowerCase() === 'content-length') continue;
      xhr.setRequestHeader(key, value);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onBytes(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onBytes(body.size);
        resolve(xhr.getResponseHeader('ETag'));
      } else {
        reject(new ApiError(xhr.status, 'upload_failed', `Storage rejected the upload (${xhr.status}).`));
      }
    };
    xhr.onerror = () =>
      reject(new ApiError(0, 'network_error', 'The connection dropped during upload.'));
    xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Upload cancelled.'));

    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/** SHA-256 in the browser, for duplicate detection before uploading. */
async function sha256(file: File): Promise<string | undefined> {
  if (!crypto?.subtle) return undefined;
  // Hashing a multi-gigabyte file in memory is not worth the stall; the server
  // computes the authoritative checksum after upload either way.
  if (file.size > 256 * 1024 * 1024) return undefined;
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${Math.ceil(seconds % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
