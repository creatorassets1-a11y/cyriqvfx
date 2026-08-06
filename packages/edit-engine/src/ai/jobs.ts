import type { Id, Ticks } from '../model/types.js';

/**
 * The AI job queue.
 *
 * Two product rules from the PRD are enforced here rather than left to the UI,
 * because a rule that lives only in a screen gets broken by the next screen:
 *
 *   1. Nothing is uploaded without an explicit, recorded consent for that job.
 *      A job cannot leave `awaiting-consent` any other way.
 *   2. Every server capability is queueable offline. Jobs sit in `queued` until
 *      connectivity and consent both exist, so "Process later" is the default
 *      path rather than a fallback.
 */

export type AiCapability =
  // On-device — these never enter the upload path at all.
  | 'background-removal'
  | 'object-tracking'
  | 'denoise'
  | 'auto-captions-basic'
  | 'beat-detection'
  // Server-backed.
  | 'captions-premium'
  | 'filler-word-removal'
  | 'translate-captions'
  | 'tts'
  | 'voice-clone'
  | 'text-to-video'
  | 'image-to-video'
  | 'avatar'
  | 'object-removal'
  | 'super-resolution'
  | 'style-transfer'
  | 'auto-edit'
  | 'highlight-reel'
  | 'long-to-short'
  | 'natural-language-edit'
  | 'generative-music'
  | 'generative-sfx';

export interface CapabilityDef {
  readonly capability: AiCapability;
  readonly name: string;
  readonly onDevice: boolean;
  /** What leaves the device. `none` for on-device capabilities. */
  readonly uploads: 'none' | 'proxy' | 'region' | 'audio-only' | 'original' | 'text-only';
  /** Credits consumed per unit; the unit depends on the capability. */
  readonly creditsPerUnit: number;
  readonly unit: 'second' | 'clip' | 'invocation' | 'minute';
  /** Rough wall-clock estimate per unit, for the pre-flight dialog. */
  readonly secondsPerUnit: number;
}

export const CAPABILITIES: readonly CapabilityDef[] = [
  { capability: 'background-removal', name: 'Remove Background', onDevice: true, uploads: 'none', creditsPerUnit: 0, unit: 'clip', secondsPerUnit: 0 },
  { capability: 'object-tracking', name: 'Track Object', onDevice: true, uploads: 'none', creditsPerUnit: 0, unit: 'clip', secondsPerUnit: 0 },
  { capability: 'denoise', name: 'Enhance', onDevice: true, uploads: 'none', creditsPerUnit: 0, unit: 'clip', secondsPerUnit: 0 },
  { capability: 'auto-captions-basic', name: 'Auto Captions', onDevice: true, uploads: 'none', creditsPerUnit: 0, unit: 'minute', secondsPerUnit: 0 },
  { capability: 'beat-detection', name: 'Detect Beats', onDevice: true, uploads: 'none', creditsPerUnit: 0, unit: 'clip', secondsPerUnit: 0 },

  { capability: 'captions-premium', name: 'Premium Captions', onDevice: false, uploads: 'audio-only', creditsPerUnit: 1, unit: 'minute', secondsPerUnit: 6 },
  { capability: 'filler-word-removal', name: 'Remove Filler Words', onDevice: false, uploads: 'audio-only', creditsPerUnit: 1, unit: 'minute', secondsPerUnit: 5 },
  { capability: 'translate-captions', name: 'Translate Captions', onDevice: false, uploads: 'text-only', creditsPerUnit: 1, unit: 'minute', secondsPerUnit: 3 },
  { capability: 'tts', name: 'Text to Speech', onDevice: false, uploads: 'text-only', creditsPerUnit: 1, unit: 'minute', secondsPerUnit: 8 },
  { capability: 'voice-clone', name: 'Voice Clone', onDevice: false, uploads: 'audio-only', creditsPerUnit: 20, unit: 'invocation', secondsPerUnit: 120 },
  { capability: 'text-to-video', name: 'Text to Video', onDevice: false, uploads: 'text-only', creditsPerUnit: 30, unit: 'second', secondsPerUnit: 25 },
  { capability: 'image-to-video', name: 'Image to Video', onDevice: false, uploads: 'original', creditsPerUnit: 30, unit: 'second', secondsPerUnit: 25 },
  { capability: 'avatar', name: 'AI Avatar', onDevice: false, uploads: 'text-only', creditsPerUnit: 25, unit: 'second', secondsPerUnit: 20 },
  { capability: 'object-removal', name: 'Remove Object', onDevice: false, uploads: 'region', creditsPerUnit: 8, unit: 'second', secondsPerUnit: 12 },
  { capability: 'super-resolution', name: 'Upscale', onDevice: false, uploads: 'original', creditsPerUnit: 6, unit: 'second', secondsPerUnit: 10 },
  { capability: 'style-transfer', name: 'Style Transfer', onDevice: false, uploads: 'proxy', creditsPerUnit: 10, unit: 'second', secondsPerUnit: 15 },
  { capability: 'auto-edit', name: 'Auto Edit', onDevice: false, uploads: 'proxy', creditsPerUnit: 5, unit: 'minute', secondsPerUnit: 30 },
  { capability: 'highlight-reel', name: 'Highlight Reel', onDevice: false, uploads: 'proxy', creditsPerUnit: 5, unit: 'minute', secondsPerUnit: 30 },
  { capability: 'long-to-short', name: 'Long to Short', onDevice: false, uploads: 'proxy', creditsPerUnit: 5, unit: 'minute', secondsPerUnit: 40 },
  { capability: 'natural-language-edit', name: 'Edit by Description', onDevice: false, uploads: 'text-only', creditsPerUnit: 2, unit: 'invocation', secondsPerUnit: 10 },
  { capability: 'generative-music', name: 'Generate Music', onDevice: false, uploads: 'text-only', creditsPerUnit: 10, unit: 'invocation', secondsPerUnit: 30 },
  { capability: 'generative-sfx', name: 'Generate SFX', onDevice: false, uploads: 'text-only', creditsPerUnit: 3, unit: 'invocation', secondsPerUnit: 12 },
];

const BY_CAPABILITY = new Map(CAPABILITIES.map((c) => [c.capability, c]));

export const getCapability = (c: AiCapability): CapabilityDef | undefined => BY_CAPABILITY.get(c);

export const requiresNetwork = (c: AiCapability): boolean => !(BY_CAPABILITY.get(c)?.onDevice ?? false);

/**
 * Job lifecycle.
 *
 *   awaiting-consent ──grant──▶ queued ──online──▶ uploading ──▶ processing
 *          │                      │                    │             │
 *          └──── cancel ──────────┴──── cancel ────────┴──── fail ───┤
 *                                                                    ▼
 *                                             ready ──accept/reject──▶ applied
 *
 * On-device jobs skip straight to `processing`, which is what makes the offline
 * path structurally identical to the online one for the rest of the app.
 */
export type JobState =
  | 'awaiting-consent'
  | 'queued'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'applied'
  | 'rejected'
  | 'failed'
  | 'cancelled';

export interface UploadConsent {
  readonly grantedAt: number;
  /** Exactly what the user was told would be sent. */
  readonly describedAs: string;
  readonly estimatedBytes: number;
}

export interface AiJob {
  readonly id: Id;
  readonly capability: AiCapability;
  readonly state: JobState;
  /** Clips the result will be applied to. */
  readonly clipIds: readonly Id[];
  readonly params: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly progress: number;
  readonly consent: UploadConsent | null;
  readonly estimatedCredits: number;
  readonly estimatedSeconds: number;
  readonly estimatedUploadBytes: number;
  /** Populated on `ready`; opaque to the engine. */
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly error: string | null;
  /** Attempts so far, for the backoff policy. */
  readonly attempts: number;
}

export interface JobQueue {
  readonly jobs: readonly AiJob[];
  readonly online: boolean;
  /** Remaining credit balance; jobs above it are held rather than failed. */
  readonly credits: number;
  /** How many server jobs may run at once. */
  readonly concurrency: number;
}

export const createQueue = (opts: Partial<JobQueue> = {}): JobQueue => ({
  jobs: [],
  online: false,
  credits: 0,
  concurrency: 2,
  ...opts,
});

export interface EnqueueOptions {
  readonly capability: AiCapability;
  readonly clipIds: readonly Id[];
  readonly params?: Readonly<Record<string, unknown>>;
  /** Media length the job covers, used for the credit and time estimate. */
  readonly durationTicks?: Ticks;
  readonly estimatedUploadBytes?: number;
  readonly id?: Id;
}

const TICKS_PER_SECOND = 705_600_000;

export function estimateJob(opts: EnqueueOptions): {
  credits: number;
  seconds: number;
} {
  const def = getCapability(opts.capability);
  if (!def) return { credits: 0, seconds: 0 };
  const seconds = (opts.durationTicks ?? 0) / TICKS_PER_SECOND;

  let units: number;
  switch (def.unit) {
    case 'second':
      units = Math.max(1, Math.ceil(seconds));
      break;
    case 'minute':
      units = Math.max(1, Math.ceil(seconds / 60));
      break;
    case 'clip':
      units = Math.max(1, opts.clipIds.length);
      break;
    case 'invocation':
    default:
      units = 1;
  }

  return {
    credits: def.creditsPerUnit * units,
    seconds: def.secondsPerUnit * units,
  };
}

/**
 * Add a job.
 *
 * On-device work starts immediately. Server work always lands in
 * `awaiting-consent` first — even when the device is online and the user has
 * consented before, because consent is per job and per payload, not a global
 * setting that can silently widen.
 */
export function enqueue(queue: JobQueue, opts: EnqueueOptions): { queue: JobQueue; job: AiJob } {
  const def = getCapability(opts.capability);
  const { credits, seconds } = estimateJob(opts);
  const now = Date.now();

  const job: AiJob = {
    id: opts.id ?? `job_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    capability: opts.capability,
    state: def?.onDevice ? 'processing' : 'awaiting-consent',
    clipIds: opts.clipIds,
    params: opts.params ?? {},
    createdAt: now,
    updatedAt: now,
    progress: 0,
    consent: null,
    estimatedCredits: credits,
    estimatedSeconds: seconds,
    estimatedUploadBytes: opts.estimatedUploadBytes ?? 0,
    result: null,
    error: null,
    attempts: 0,
  };

  return { queue: { ...queue, jobs: [...queue.jobs, job] }, job };
}

function patch(queue: JobQueue, jobId: Id, delta: Partial<AiJob>): JobQueue {
  return {
    ...queue,
    jobs: queue.jobs.map((j) => (j.id === jobId ? { ...j, ...delta, updatedAt: Date.now() } : j)),
  };
}

/** Record consent and release the job into the queue. The only way out of `awaiting-consent`. */
export function grantConsent(queue: JobQueue, jobId: Id, describedAs: string): JobQueue {
  const job = queue.jobs.find((j) => j.id === jobId);
  if (!job || job.state !== 'awaiting-consent') return queue;
  return patch(queue, jobId, {
    state: 'queued',
    consent: {
      grantedAt: Date.now(),
      describedAs,
      estimatedBytes: job.estimatedUploadBytes,
    },
  });
}

export function cancelJob(queue: JobQueue, jobId: Id): JobQueue {
  const job = queue.jobs.find((j) => j.id === jobId);
  if (!job || job.state === 'applied' || job.state === 'cancelled') return queue;
  return patch(queue, jobId, { state: 'cancelled', progress: 0 });
}

export function setOnline(queue: JobQueue, online: boolean): JobQueue {
  return { ...queue, online };
}

/**
 * Jobs eligible to start right now.
 *
 * Gated on consent, connectivity, credits and concurrency — in that order, so
 * the reason a job is not running is always the most fundamental one, which is
 * what the UI shows the user.
 */
export function runnableJobs(queue: JobQueue): AiJob[] {
  const active = queue.jobs.filter((j) => j.state === 'uploading' || j.state === 'processing');
  const serverActive = active.filter((j) => requiresNetwork(j.capability)).length;
  const slots = Math.max(0, queue.concurrency - serverActive);
  if (slots === 0) return [];

  let budget = queue.credits;
  const out: AiJob[] = [];
  for (const job of queue.jobs) {
    if (out.length >= slots) break;
    if (job.state !== 'queued') continue;
    if (!job.consent) continue;
    if (!queue.online) continue;
    if (job.estimatedCredits > budget) continue;
    budget -= job.estimatedCredits;
    out.push(job);
  }
  return out;
}

/** Why a queued job is not running, phrased for the UI. */
export function blockedReason(queue: JobQueue, jobId: Id): string | null {
  const job = queue.jobs.find((j) => j.id === jobId);
  if (!job || job.state !== 'queued') return null;
  if (!job.consent) return 'Waiting for you to approve what gets uploaded';
  if (!queue.online) return 'Waiting for a connection';
  if (job.estimatedCredits > queue.credits) {
    return `Needs ${job.estimatedCredits} credits — ${queue.credits} left`;
  }
  const active = queue.jobs.filter((j) => j.state === 'uploading' || j.state === 'processing');
  if (active.length >= queue.concurrency) return 'Waiting for another job to finish';
  return null;
}

export function startJob(queue: JobQueue, jobId: Id): JobQueue {
  const job = queue.jobs.find((j) => j.id === jobId);
  if (!job || job.state !== 'queued') return queue;
  const def = getCapability(job.capability);
  return patch(queue, jobId, {
    state: def?.uploads === 'none' ? 'processing' : 'uploading',
    attempts: job.attempts + 1,
    progress: 0,
  });
}

export function reportProgress(queue: JobQueue, jobId: Id, progress: number): JobQueue {
  const job = queue.jobs.find((j) => j.id === jobId);
  if (!job) return queue;
  const state: JobState = job.state === 'uploading' && progress >= 1 ? 'processing' : job.state;
  return patch(queue, jobId, { progress: Math.min(1, Math.max(0, progress)), state });
}

export function completeJob(
  queue: JobQueue,
  jobId: Id,
  result: Readonly<Record<string, unknown>>,
): JobQueue {
  const job = queue.jobs.find((j) => j.id === jobId);
  if (!job) return queue;
  return {
    ...patch(queue, jobId, { state: 'ready', progress: 1, result }),
    credits: Math.max(0, queue.credits - job.estimatedCredits),
  };
}

export const MAX_ATTEMPTS = 3;

/**
 * Fail a job. Transient failures go back to `queued` for retry with backoff;
 * once the attempt budget is spent the job stays failed so it stops burning
 * battery and data on a request that is not going to succeed.
 */
export function failJob(
  queue: JobQueue,
  jobId: Id,
  error: string,
  opts: { transient?: boolean } = {},
): JobQueue {
  const job = queue.jobs.find((j) => j.id === jobId);
  if (!job) return queue;
  const retry = (opts.transient ?? false) && job.attempts < MAX_ATTEMPTS;
  return patch(queue, jobId, {
    state: retry ? 'queued' : 'failed',
    error,
    progress: 0,
  });
}

/** Exponential backoff before the next attempt, in milliseconds. */
export function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}

/** The user accepted the result — the engine applies it and the job is done. */
export function acceptResult(queue: JobQueue, jobId: Id): JobQueue {
  return patch(queue, jobId, { state: 'applied' });
}

export function rejectResult(queue: JobQueue, jobId: Id): JobQueue {
  return patch(queue, jobId, { state: 'rejected' });
}

/** Jobs the user should be shown a badge for: finished and awaiting review. */
export const pendingReview = (queue: JobQueue): AiJob[] =>
  queue.jobs.filter((j) => j.state === 'ready');

export const activeJobs = (queue: JobQueue): AiJob[] =>
  queue.jobs.filter((j) => j.state === 'uploading' || j.state === 'processing');

/** Total credits committed by everything not yet finished. */
export function committedCredits(queue: JobQueue): number {
  return queue.jobs
    .filter((j) => ['queued', 'uploading', 'processing'].includes(j.state))
    .reduce((sum, j) => sum + j.estimatedCredits, 0);
}

/** Drop finished jobs older than `maxAgeMs` so the queue does not grow forever. */
export function pruneQueue(queue: JobQueue, maxAgeMs = 7 * 24 * 60 * 60 * 1000): JobQueue {
  const cutoff = Date.now() - maxAgeMs;
  const terminal: JobState[] = ['applied', 'rejected', 'cancelled', 'failed'];
  return {
    ...queue,
    jobs: queue.jobs.filter((j) => !(terminal.includes(j.state) && j.updatedAt < cutoff)),
  };
}

/**
 * Human-readable description of what a job will upload. Shown verbatim in the
 * consent sheet and stored on the consent record, so what the user agreed to is
 * auditable after the fact.
 */
export function describeUpload(job: AiJob): string {
  const def = getCapability(job.capability);
  if (!def) return 'Nothing will be uploaded.';
  switch (def.uploads) {
    case 'none':
      return 'Runs entirely on this device. Nothing is uploaded.';
    case 'proxy':
      return 'A low-resolution copy of the selected clips is uploaded. Your original stays on this device.';
    case 'region':
      return 'Only the frames and the region you marked are uploaded.';
    case 'audio-only':
      return 'Only the audio of the selected clips is uploaded. No video leaves this device.';
    case 'text-only':
      return 'Only text is sent. No media leaves this device.';
    case 'original':
      return 'The original media for the selected clips is uploaded at full quality.';
  }
}
