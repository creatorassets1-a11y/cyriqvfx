import { describe, expect, it } from 'vitest';
import {
  acceptResult,
  activeJobs,
  applyCaptionStyle,
  blockedReason,
  cancelJob,
  CAPABILITIES,
  completeJob,
  createCaptionTrack,
  createQueue,
  describeUpload,
  enqueue,
  failJob,
  fillerRanges,
  fromSrt,
  getCaptionStyle,
  grantConsent,
  lowConfidenceCues,
  markFillerWords,
  MAX_ATTEMPTS,
  pendingReview,
  pruneQueue,
  regroupCues,
  reportProgress,
  requiresNetwork,
  retryDelayMs,
  rippleCaptions,
  runnableJobs,
  setOnline,
  startJob,
  TICKS_PER_SECOND,
  toSrt,
  toVtt,
  type CaptionWord,
} from '../src/index.js';

const S = TICKS_PER_SECOND;

const words = (text: string, startSeconds = 0, perWord = 0.4): CaptionWord[] =>
  text.split(' ').map((token, i) => ({
    text: token,
    start: Math.round((startSeconds + i * perWord) * S),
    end: Math.round((startSeconds + (i + 1) * perWord) * S),
    confidence: 0.95,
  }));

describe('privacy guarantees', () => {
  it('marks on-device capabilities as uploading nothing', () => {
    for (const def of CAPABILITIES.filter((c) => c.onDevice)) {
      expect(def.uploads).toBe('none');
      expect(requiresNetwork(def.capability)).toBe(false);
    }
  });

  it('never starts a server job before consent is recorded', () => {
    let queue = setOnline(createQueue({ credits: 1000 }), true);
    const { queue: q, job } = enqueue(queue, {
      capability: 'object-removal',
      clipIds: ['c1'],
      durationTicks: 5 * S,
    });
    queue = q;

    expect(job.state).toBe('awaiting-consent');
    expect(runnableJobs(queue)).toHaveLength(0);
    // Trying to start it directly is a no-op too.
    expect(startJob(queue, job.id).jobs[0].state).toBe('awaiting-consent');
  });

  it('releases the job only once consent is granted', () => {
    let queue = setOnline(createQueue({ credits: 1000 }), true);
    const { queue: q, job } = enqueue(queue, {
      capability: 'object-removal',
      clipIds: ['c1'],
      durationTicks: 5 * S,
    });
    queue = grantConsent(q, job.id, describeUpload(job));

    expect(queue.jobs[0].state).toBe('queued');
    expect(queue.jobs[0].consent).not.toBeNull();
    expect(runnableJobs(queue)).toHaveLength(1);
  });

  it('records verbatim what the user agreed to', () => {
    const { queue, job } = enqueue(createQueue(), {
      capability: 'captions-premium',
      clipIds: ['c1'],
      durationTicks: 60 * S,
    });
    const description = describeUpload(job);
    expect(description).toContain('audio');
    const granted = grantConsent(queue, job.id, description);
    expect(granted.jobs[0].consent?.describedAs).toBe(description);
  });

  it('starts on-device work immediately, with no consent step', () => {
    const { job } = enqueue(createQueue(), {
      capability: 'background-removal',
      clipIds: ['c1'],
    });
    expect(job.state).toBe('processing');
  });

  it('describes each upload shape distinctly', () => {
    const shapes = new Set(
      CAPABILITIES.map((c) => describeUpload({ capability: c.capability } as never)),
    );
    expect(shapes.size).toBeGreaterThan(3);
  });
});

describe('offline queueing', () => {
  it('holds a consented job until there is a connection', () => {
    let queue = createQueue({ credits: 1000 });
    const { queue: q, job } = enqueue(queue, {
      capability: 'super-resolution',
      clipIds: ['c1'],
      durationTicks: 10 * S,
    });
    queue = grantConsent(q, job.id, 'test');

    expect(runnableJobs(queue)).toHaveLength(0);
    expect(blockedReason(queue, job.id)).toMatch(/connection/i);

    queue = setOnline(queue, true);
    expect(runnableJobs(queue)).toHaveLength(1);
    expect(blockedReason(queue, job.id)).toBeNull();
  });

  it('explains a credit shortfall rather than failing the job', () => {
    let queue = setOnline(createQueue({ credits: 1 }), true);
    const { queue: q, job } = enqueue(queue, {
      capability: 'text-to-video',
      clipIds: [],
      durationTicks: 5 * S,
    });
    queue = grantConsent(q, job.id, 'test');

    expect(runnableJobs(queue)).toHaveLength(0);
    expect(blockedReason(queue, job.id)).toMatch(/credits/i);
    expect(queue.jobs[0].state).toBe('queued');
  });

  it('respects the concurrency limit', () => {
    let queue = setOnline(createQueue({ credits: 10_000, concurrency: 2 }), true);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { queue: q, job } = enqueue(queue, {
        capability: 'style-transfer',
        clipIds: [`c${i}`],
        durationTicks: 2 * S,
      });
      queue = grantConsent(q, job.id, 'test');
      ids.push(job.id);
    }
    expect(runnableJobs(queue)).toHaveLength(2);
    queue = startJob(queue, ids[0]);
    queue = startJob(queue, ids[1]);
    expect(runnableJobs(queue)).toHaveLength(0);
    expect(activeJobs(queue)).toHaveLength(2);
  });
});

describe('job lifecycle', () => {
  const prepared = () => {
    let queue = setOnline(createQueue({ credits: 1000 }), true);
    const { queue: q, job } = enqueue(queue, {
      capability: 'object-removal',
      clipIds: ['c1'],
      durationTicks: 4 * S,
    });
    return { queue: grantConsent(q, job.id, 'test'), jobId: job.id };
  };

  it('moves from uploading to processing when the upload completes', () => {
    const { queue: base, jobId } = prepared();
    let queue = startJob(base, jobId);
    expect(queue.jobs[0].state).toBe('uploading');
    queue = reportProgress(queue, jobId, 1);
    expect(queue.jobs[0].state).toBe('processing');
  });

  it('deducts credits only on completion', () => {
    const { queue: base, jobId } = prepared();
    const cost = base.jobs[0].estimatedCredits;
    let queue = startJob(base, jobId);
    expect(queue.credits).toBe(1000);
    queue = completeJob(queue, jobId, { maskUri: 'file:///out.mp4' });
    expect(queue.credits).toBe(1000 - cost);
    expect(pendingReview(queue)).toHaveLength(1);
  });

  it('is non-destructive until the user accepts', () => {
    const { queue: base, jobId } = prepared();
    let queue = completeJob(startJob(base, jobId), jobId, { uri: 'x' });
    expect(queue.jobs[0].state).toBe('ready');
    queue = acceptResult(queue, jobId);
    expect(queue.jobs[0].state).toBe('applied');
  });

  it('retries a transient failure and gives up at the attempt limit', () => {
    const { queue: base, jobId } = prepared();
    let queue = base;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      queue = startJob(queue, jobId);
      queue = failJob(queue, jobId, 'network dropped', { transient: true });
    }
    expect(queue.jobs[0].state).toBe('failed');
    expect(queue.jobs[0].attempts).toBe(MAX_ATTEMPTS);
  });

  it('does not retry a permanent failure', () => {
    const { queue: base, jobId } = prepared();
    const queue = failJob(startJob(base, jobId), jobId, 'unsupported media');
    expect(queue.jobs[0].state).toBe('failed');
  });

  it('backs off exponentially, with a ceiling', () => {
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(2)).toBe(4000);
    expect(retryDelayMs(3)).toBe(8000);
    expect(retryDelayMs(30)).toBe(60_000);
  });

  it('cancels a job at any point before it is applied', () => {
    const { queue: base, jobId } = prepared();
    expect(cancelJob(base, jobId).jobs[0].state).toBe('cancelled');
  });

  it('prunes finished jobs but keeps live ones', () => {
    const { queue: base, jobId } = prepared();
    let queue = acceptResult(completeJob(startJob(base, jobId), jobId, {}), jobId);
    queue = {
      ...queue,
      jobs: queue.jobs.map((j) => ({ ...j, updatedAt: Date.now() - 30 * 24 * 3600 * 1000 })),
    };
    expect(pruneQueue(queue).jobs).toHaveLength(0);
  });
});

describe('captions', () => {
  it('groups words into cues at the requested density', () => {
    const cues = regroupCues(words('one two three four five six'), 3);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe('one two three');
  });

  it('breaks early at a sentence end', () => {
    const spoken = words('hello there. how are you');
    const cues = regroupCues(spoken, 10);
    expect(cues[0].text).toBe('hello there.');
  });

  it('breaks at a long pause', () => {
    const spoken: CaptionWord[] = [
      { text: 'before', start: 0, end: S, confidence: 1 },
      { text: 'after', start: 5 * S, end: 6 * S, confidence: 1 },
    ];
    expect(regroupCues(spoken, 10)).toHaveLength(2);
  });

  it('keeps cue text in step with its words', () => {
    const track = createCaptionTrack(words('the quick brown fox jumps'), {});
    for (const cue of track.cues) {
      expect(cue.text).toBe(cue.words.map((w) => w.text).join(' '));
    }
  });

  it('re-flows when the style changes', () => {
    const track = createCaptionTrack(words('one two three four five six seven eight nine'), {
      styleId: 'clean',
    });
    const restyled = applyCaptionStyle(track, 'single-word');
    expect(getCaptionStyle('single-word').wordsPerCue).toBe(1);
    expect(restyled.cues.length).toBeGreaterThan(track.cues.length);
    // No words are lost in the re-flow.
    expect(restyled.cues.flatMap((c) => c.words)).toHaveLength(9);
  });

  it('flags filler words and reports their ranges', () => {
    const track = markFillerWords(
      createCaptionTrack(words('so um this is uh really good'), { language: 'en' }),
    );
    const flagged = track.cues.flatMap((c) => c.words).filter((w) => w.filler);
    expect(flagged.map((w) => w.text)).toEqual(['um', 'uh']);
    expect(fillerRanges(track)).toHaveLength(2);
  });

  it('surfaces low-confidence cues for review', () => {
    const spoken = words('probably misheard here');
    spoken[1] = { ...spoken[1], confidence: 0.3 };
    const track = createCaptionTrack(spoken, {});
    expect(lowConfidenceCues(track)).toHaveLength(1);
  });

  it('pulls captions back in step with a ripple delete', () => {
    const track = createCaptionTrack(words('one two three four five six'), {});
    const rippled = rippleCaptions(track, 0, S);
    const first = rippled.cues[0].words[0];
    expect(first.start).toBeLessThan(track.cues[0].words[0].start + 1);
    // Nothing is left sitting before zero.
    for (const cue of rippled.cues) expect(cue.start).toBeGreaterThanOrEqual(0);
  });

  it('round-trips through SRT', () => {
    const track = createCaptionTrack(words('exported and imported again'), {});
    const reimported = fromSrt(toSrt(track));
    expect(reimported.cues.flatMap((c) => c.words).map((w) => w.text)).toEqual([
      'exported',
      'and',
      'imported',
      'again',
    ]);
    expect(reimported.source).toBe('imported');
  });

  it('writes SRT and WebVTT in their respective time formats', () => {
    const track = createCaptionTrack(words('hello world'), {});
    // SRT uses a comma before milliseconds; WebVTT uses a period.
    expect(toSrt(track)).toMatch(/00:00:00,000 --> /);
    expect(toVtt(track)).toMatch(/^WEBVTT/);
    expect(toVtt(track)).toMatch(/00:00:00\.000 --> /);
  });
});
