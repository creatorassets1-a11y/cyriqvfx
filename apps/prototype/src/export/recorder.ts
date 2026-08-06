import {
  composeFrame,
  documentDuration,
  framesToTicks,
  ticksToSeconds,
  type EditDocument,
  type ExportSettings,
} from '@apex/edit-engine';
import { Compositor } from '../render/compositor.js';
import type { MediaPool } from '../render/media-pool.js';

/**
 * Export.
 *
 * Renders every frame through the same `composeFrame` → compositor path the
 * preview uses, into an offscreen canvas at the export resolution, and captures
 * it with MediaRecorder.
 *
 * This is deliberately the slow, correct path rather than a real-time capture
 * of the preview: each frame is composed at its exact timeline tick and the
 * decoders are given a chance to land on it, so the output is frame-accurate
 * even when the machine cannot render at speed. A native build replaces the
 * recorder with a hardware encoder and everything above this line is unchanged.
 */

export interface ExportOptions {
  doc: EditDocument;
  settings: ExportSettings;
  pool: MediaPool;
  onProgress: (phase: string, value: number) => void;
  /** How long to wait for a decoder to land on a frame before drawing anyway. */
  seekTimeoutMs?: number;
}

export async function exportTimeline(options: ExportOptions): Promise<Blob> {
  const { doc, settings, pool, onProgress } = options;

  const duration = settings.range?.duration ?? documentDuration(doc);
  if (duration <= 0) throw new Error('There is nothing on the timeline to export.');

  const canvas = document.createElement('canvas');
  canvas.width = settings.resolution.width;
  canvas.height = settings.resolution.height;
  const compositor = new Compositor(canvas);

  const fps = settings.frameRate.num / settings.frameRate.den;
  const frameCount = Math.max(1, Math.round(ticksToSeconds(duration) * fps));
  const start = settings.range?.start ?? 0;

  const mimeType = pickMimeType();
  if (!mimeType) {
    throw new Error('This browser cannot record video. Try Chrome or Edge.');
  }

  // A manually driven stream lets us advance one frame at a time rather than
  // recording in real time, which is what keeps the output frame-accurate.
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: settings.videoBitrate,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = () => reject(new Error('The recorder failed mid-export.'));
  });

  pool.pauseAll();
  recorder.start();
  onProgress('rendering', 0);

  for (let i = 0; i < frameCount; i++) {
    const time = start + framesToTicks(i, settings.frameRate);
    const frame = composeFrame(doc, time, { preferProxy: false, resolution: settings.resolution });

    // Give the decoders a chance to land on this exact frame before drawing.
    await settleSources(frame.layers.length > 0, pool, frame, options.seekTimeoutMs ?? 250);

    compositor.render(frame, (layer) => pool.resolve(layer, 1 / (fps * 4)), ticksToSeconds(time));
    track.requestFrame();

    if (i % 5 === 0) {
      onProgress('rendering', i / frameCount);
      // Yield so the progress bar actually paints during a long export.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  onProgress('finalizing', 0.98);
  recorder.stop();
  const blob = await finished;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${doc.project.name || 'export'}.webm`;
  link.click();
  URL.revokeObjectURL(url);

  return blob;
}

/**
 * Wait for the video elements backing this frame to finish seeking, with a
 * ceiling so a decoder that never reports `seeked` cannot stall the export.
 */
async function settleSources(
  hasLayers: boolean,
  pool: MediaPool,
  frame: ReturnType<typeof composeFrame>,
  timeoutMs: number,
): Promise<void> {
  if (!hasLayers) return;

  const deadline = performance.now() + timeoutMs;
  // Prime the seeks.
  for (const layer of frame.layers) pool.resolve(layer, 1 / 240);

  while (performance.now() < deadline) {
    const pending = frame.layers.some((layer) => {
      if (layer.source.kind !== 'media') return false;
      const media = pool.get(layer.source.mediaId);
      if (!media || media.kind !== 'video') return false;
      const element = media.element as HTMLVideoElement;
      return element.seeking || element.readyState < 2;
    });
    if (!pending) return;
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}

function pickMimeType(): string | null {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** `captureStream(0)` gives a track that only emits on request. */
interface CanvasCaptureMediaStreamTrack extends MediaStreamTrack {
  requestFrame(): void;
}
