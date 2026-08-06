import { useState } from 'react';
import {
  blockedReason,
  CAPABILITIES,
  cancelJob,
  completeJob,
  describeUpload,
  enqueue,
  grantConsent,
  reportProgress,
  requiresNetwork,
  startJob,
  type AiCapability,
  type AiJob,
  type JobQueue,
} from '@apex/edit-engine';
import { haptic, type Editor } from '../../engine-bridge/useEditor.js';
import { EmptyState, OnlineBadge, PanelSection, Toggle } from '../controls.js';

/**
 * The AI panel.
 *
 * This is the screen the PRD's "honest AI" principle is really about. Three
 * things are enforced by the engine rather than by this component's good
 * behaviour:
 *
 *   - Server capabilities land in `awaiting-consent` and cannot start until a
 *     consent record exists, so there is no code path where tapping a button
 *     uploads media.
 *   - The consent sheet shows `describeUpload(job)` verbatim, and that exact
 *     string is what gets stored on the consent record.
 *   - Going offline does not disable anything. Jobs queue and state why they
 *     are waiting.
 */

interface AiPanelProps {
  editor: Editor;
  queue: JobQueue;
  setQueue: (update: (queue: JobQueue) => JobQueue) => void;
}

export function AiPanel({ editor, queue, setQueue }: AiPanelProps) {
  const [consentFor, setConsentFor] = useState<AiJob | null>(null);
  const selected = editor.selectedClips;

  const request = (capability: AiCapability) => {
    const durationTicks = selected.reduce((sum, clip) => sum + clip.duration, 0);
    setQueue((current) => {
      const { queue: next, job } = enqueue(current, {
        capability,
        clipIds: selected.map((c) => c.id),
        durationTicks,
      });
      // On-device work needs no sheet; server work always shows one.
      if (job.state === 'awaiting-consent') setConsentFor(job);
      else simulate(job.id, setQueue);
      return next;
    });
    haptic('light');
  };

  const onDevice = CAPABILITIES.filter((c) => c.onDevice);
  const server = CAPABILITIES.filter((c) => !c.onDevice);

  return (
    <>
      <PanelSection title="Connection">
        <Toggle
          label="Simulate being online"
          hint="Turn this off to see how every online feature queues instead of failing."
          checked={queue.online}
          onChange={(online) => setQueue((q) => ({ ...q, online }))}
        />
        <p className="panel-section__note">
          {queue.credits} credits available · {queue.jobs.length} job
          {queue.jobs.length === 1 ? '' : 's'} in the queue
        </p>
      </PanelSection>

      {queue.jobs.length > 0 && (
        <PanelSection title="Queue">
          {queue.jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              reason={blockedReason(queue, job.id)}
              onConsent={() => setConsentFor(job)}
              onStart={() => {
                setQueue((q) => startJob(q, job.id));
                simulate(job.id, setQueue);
              }}
              onCancel={() => setQueue((q) => cancelJob(q, job.id))}
            />
          ))}
        </PanelSection>
      )}

      <PanelSection
        title="On this device"
        note="These run locally. Nothing is uploaded, and they work with no connection."
      >
        <div className="effect-grid">
          {onDevice.map((def) => (
            <button
              key={def.capability}
              type="button"
              className="effect-tile"
              onClick={() => request(def.capability)}
              disabled={selected.length === 0 && def.unit === 'clip'}
            >
              <span className="effect-tile__name">{def.name}</span>
              <span className="effect-tile__meta">On device</span>
            </button>
          ))}
        </div>
      </PanelSection>

      <PanelSection
        title="Online"
        note="These need a connection and credits. You will be shown exactly what gets uploaded before anything leaves this device."
      >
        <div className="effect-grid">
          {server.map((def) => (
            <button
              key={def.capability}
              type="button"
              className="effect-tile"
              onClick={() => request(def.capability)}
            >
              <span className="effect-tile__name">{def.name}</span>
              <span className="effect-tile__meta">
                {def.creditsPerUnit} cr/{def.unit}
              </span>
            </button>
          ))}
        </div>
      </PanelSection>

      {consentFor && (
        <ConsentSheet
          job={consentFor}
          onCancel={() => {
            setQueue((q) => cancelJob(q, consentFor.id));
            setConsentFor(null);
          }}
          onApprove={() => {
            setQueue((q) => grantConsent(q, consentFor.id, describeUpload(consentFor)));
            setConsentFor(null);
            haptic('medium');
          }}
        />
      )}
    </>
  );
}

function JobRow({
  job,
  reason,
  onConsent,
  onStart,
  onCancel,
}: {
  job: AiJob;
  reason: string | null;
  onConsent: () => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const def = CAPABILITIES.find((c) => c.capability === job.capability);
  return (
    <div className={`job job--${job.state}`}>
      <div className="job__head">
        <span className="job__name">{def?.name ?? job.capability}</span>
        {requiresNetwork(job.capability) && <OnlineBadge />}
      </div>

      <div className="job__state">
        {job.state === 'awaiting-consent' && (
          <button type="button" className="button button--accent" onClick={onConsent}>
            Review what gets uploaded
          </button>
        )}
        {job.state === 'queued' && (
          <>
            <span className="job__reason">{reason ?? 'Ready'}</span>
            {!reason && (
              <button type="button" className="button" onClick={onStart}>
                Start
              </button>
            )}
          </>
        )}
        {(job.state === 'uploading' || job.state === 'processing') && (
          <>
            <span className="job__reason">
              {job.state === 'uploading' ? 'Uploading' : 'Processing'} ·{' '}
              {Math.round(job.progress * 100)}%
            </span>
            <div className="job__progress">
              <div style={{ width: `${job.progress * 100}%` }} />
            </div>
          </>
        )}
        {job.state === 'ready' && <span className="job__reason">Ready to review</span>}
        {job.state === 'failed' && <span className="job__reason job__reason--error">{job.error}</span>}
        {job.state === 'cancelled' && <span className="job__reason">Cancelled</span>}
      </div>

      {!['applied', 'cancelled', 'failed'].includes(job.state) && (
        <button type="button" className="job__cancel" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}

/**
 * The consent sheet.
 *
 * Deliberately blunt: it names the payload, the cost and the time before the
 * approve button, and "Process later" is a first-class option rather than a
 * dismissal — queueing is the offline-first path, not a failure mode.
 */
function ConsentSheet({
  job,
  onApprove,
  onCancel,
}: {
  job: AiJob;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const def = CAPABILITIES.find((c) => c.capability === job.capability);
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="sheet">
        <h2 id="consent-title" className="sheet__title">
          {def?.name}
        </h2>
        <p className="sheet__body">{describeUpload(job)}</p>

        <dl className="sheet__facts">
          <div>
            <dt>Cost</dt>
            <dd>{job.estimatedCredits} credits</dd>
          </div>
          <div>
            <dt>Estimated time</dt>
            <dd>~{Math.max(1, Math.round(job.estimatedSeconds))}s</dd>
          </div>
          <div>
            <dt>Clips</dt>
            <dd>{job.clipIds.length || '—'}</dd>
          </div>
        </dl>

        <p className="sheet__fineprint">
          Your original media stays on this device. The result comes back as a separate version you
          can accept or discard — nothing is overwritten.
        </p>

        <div className="sheet__actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button button--accent" onClick={onApprove}>
            Approve &amp; queue
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Stand-in for the real backend. Advances a job through its states on a timer
 * so the queue UI can be exercised without a server.
 */
function simulate(jobId: string, setQueue: (update: (queue: JobQueue) => JobQueue) => void): void {
  let progress = 0;
  const tick = setInterval(() => {
    progress += 0.15;
    if (progress >= 1) {
      clearInterval(tick);
      setQueue((q) => {
        const job = q.jobs.find((j) => j.id === jobId);
        if (!job || job.state === 'cancelled') return q;
        return completeJob(q, jobId, { simulated: true });
      });
      haptic('success');
      return;
    }
    setQueue((q) => {
      const job = q.jobs.find((j) => j.id === jobId);
      if (!job || job.state === 'cancelled') {
        clearInterval(tick);
        return q;
      }
      return reportProgress(q, jobId, progress);
    });
  }, 400);
}
