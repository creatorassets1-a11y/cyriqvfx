import { ticksToSeconds, type RenderLayer, type Ticks } from '@apex/edit-engine';
import type { TextureSource } from './compositor.js';

/**
 * Media resolution for the reference renderer.
 *
 * On device this is the decoder: the engine asks for a source time and gets the
 * frame at it. In the browser the closest equivalent is a pool of `<video>`
 * elements that we seek, which is why scrubbing here is only as good as the
 * browser's seek — a native build uses a real frame-accurate decoder and does
 * not have this limitation.
 *
 * Text is rasterised to an offscreen canvas per layer, cached on the string and
 * style so typing does not re-rasterise every frame.
 */

export interface LoadedMedia {
  readonly id: string;
  readonly element: HTMLVideoElement | HTMLImageElement;
  readonly width: number;
  readonly height: number;
  readonly kind: 'video' | 'image';
  readonly objectUrl: string;
}

export class MediaPool {
  private media = new Map<string, LoadedMedia>();
  private textCache = new Map<string, HTMLCanvasElement>();
  /** Seek requests in flight, so we do not thrash a video element. */
  private pendingSeeks = new Map<string, number>();

  async load(id: string, file: File): Promise<LoadedMedia> {
    const objectUrl = URL.createObjectURL(file);
    const isImage = file.type.startsWith('image/');

    if (isImage) {
      const element = new Image();
      element.src = objectUrl;
      await element.decode();
      const loaded: LoadedMedia = {
        id,
        element,
        width: element.naturalWidth,
        height: element.naturalHeight,
        kind: 'image',
        objectUrl,
      };
      this.media.set(id, loaded);
      return loaded;
    }

    const element = document.createElement('video');
    element.src = objectUrl;
    element.muted = true;
    element.playsInline = true;
    element.preload = 'auto';
    // Required for `texImage2D` to accept the element without tainting.
    element.crossOrigin = 'anonymous';

    await new Promise<void>((resolve, reject) => {
      element.onloadedmetadata = () => resolve();
      element.onerror = () => reject(new Error(`Could not decode ${file.name}`));
    });
    // Seek to the first frame so there is something to show immediately.
    await this.seekElement(element, 0);

    const loaded: LoadedMedia = {
      id,
      element,
      width: element.videoWidth,
      height: element.videoHeight,
      kind: 'video',
      objectUrl,
    };
    this.media.set(id, loaded);
    return loaded;
  }

  get(id: string): LoadedMedia | undefined {
    return this.media.get(id);
  }

  /** Duration in seconds, or null if the element has not reported one. */
  durationSeconds(id: string): number | null {
    const loaded = this.media.get(id);
    if (!loaded || loaded.kind !== 'video') return null;
    const duration = (loaded.element as HTMLVideoElement).duration;
    return Number.isFinite(duration) ? duration : null;
  }

  /**
   * Resolve a layer to a texture source, seeking the underlying video if it is
   * not already near the requested time.
   *
   * The tolerance is half a frame at 30 fps: seeking for anything smaller costs
   * more than it gains, since the browser will land on the same decoded frame.
   */
  resolve(layer: RenderLayer, toleranceSeconds = 1 / 60): TextureSource | null {
    if (layer.source.kind === 'text') return this.rasteriseText(layer);
    if (layer.source.kind !== 'media') return null;

    const loaded = this.media.get(layer.source.mediaId);
    if (!loaded) return null;

    if (loaded.kind === 'image') {
      return { source: loaded.element, width: loaded.width, height: loaded.height };
    }

    const element = loaded.element as HTMLVideoElement;
    const wanted = ticksToSeconds(layer.source.sourceTime);

    if (element.paused && Math.abs(element.currentTime - wanted) > toleranceSeconds) {
      this.requestSeek(loaded.id, element, wanted);
    }

    if (element.readyState < 2) return null;
    return { source: element, width: loaded.width, height: loaded.height };
  }

  /** Put every video element into playback at `rate` from `sourceTime`. */
  play(layers: readonly RenderLayer[]): void {
    for (const layer of layers) {
      if (layer.source.kind !== 'media') continue;
      const loaded = this.media.get(layer.source.mediaId);
      if (!loaded || loaded.kind !== 'video') continue;
      const element = loaded.element as HTMLVideoElement;

      const wanted = ticksToSeconds(layer.source.sourceTime);
      if (Math.abs(element.currentTime - wanted) > 0.25) element.currentTime = wanted;
      // The browser clamps playbackRate; a rate outside it falls back to 1 and
      // the engine's source-time mapping keeps the picture correct anyway.
      element.playbackRate = Math.min(16, Math.max(0.0625, Math.abs(layer.source.rate) || 1));
      if (element.paused) void element.play().catch(() => undefined);
    }
  }

  pauseAll(): void {
    for (const loaded of this.media.values()) {
      if (loaded.kind === 'video') (loaded.element as HTMLVideoElement).pause();
    }
  }

  private requestSeek(id: string, element: HTMLVideoElement, seconds: number): void {
    // Collapse rapid scrub requests: keep only the newest target per element.
    this.pendingSeeks.set(id, seconds);
    if (element.seeking) return;

    const target = this.pendingSeeks.get(id)!;
    this.pendingSeeks.delete(id);
    try {
      element.currentTime = Math.max(0, target);
    } catch {
      // Seeking before metadata is ready throws in some browsers; the next
      // frame will retry.
    }
  }

  private seekElement(element: HTMLVideoElement, seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        element.removeEventListener('seeked', done);
        resolve();
      };
      element.addEventListener('seeked', done);
      element.currentTime = seconds;
      // Do not hang the load if the browser never fires `seeked`.
      setTimeout(done, 1500);
    });
  }

  private rasteriseText(layer: RenderLayer): TextureSource | null {
    if (layer.source.kind !== 'text') return null;
    const { text, style } = layer.source;
    const key = JSON.stringify({ text, style });

    const cached = this.textCache.get(key);
    if (cached) return { source: cached, width: cached.width, height: cached.height };

    const canvas = document.createElement('canvas');
    // Rasterise at the working resolution's short edge so text stays crisp when
    // the layer is scaled up.
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const fontSize = style.fontSize;
    ctx.font = `${style.italic ? 'italic ' : ''}${style.weight} ${fontSize}px ${style.fontFamily}, sans-serif`;
    ctx.textAlign = style.align === 'left' ? 'left' : style.align === 'right' ? 'right' : 'center';
    ctx.textBaseline = 'middle';

    const lines = wrapText(ctx, text, canvas.width * 0.9);
    const lineHeight = fontSize * style.lineHeight;
    const totalHeight = lines.length * lineHeight;
    const x = style.align === 'left' ? canvas.width * 0.05 : style.align === 'right' ? canvas.width * 0.95 : canvas.width / 2;
    let y = canvas.height / 2 - totalHeight / 2 + lineHeight / 2;

    for (const line of lines) {
      if (style.background) {
        const metrics = ctx.measureText(line);
        const padding = style.background.padding;
        const boxWidth = metrics.width + padding * 2;
        const boxX = style.align === 'left' ? x - padding : style.align === 'right' ? x - boxWidth + padding : x - boxWidth / 2;
        ctx.fillStyle = style.background.color;
        roundRect(ctx, boxX, y - lineHeight / 2, boxWidth, lineHeight, style.background.cornerRadius);
        ctx.fill();
      }

      if (style.shadow) {
        ctx.shadowColor = style.shadow.color;
        ctx.shadowOffsetX = style.shadow.dx;
        ctx.shadowOffsetY = style.shadow.dy;
        ctx.shadowBlur = style.shadow.blur;
      }

      if (style.outline && style.outline.width > 0) {
        ctx.lineWidth = style.outline.width * 2;
        ctx.strokeStyle = style.outline.color;
        ctx.lineJoin = 'round';
        ctx.strokeText(line, x, y);
      }

      ctx.fillStyle = style.color;
      ctx.fillText(line, x, y);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      y += lineHeight;
    }

    // Bound the cache so a long typing session does not leak canvases.
    if (this.textCache.size > 32) {
      this.textCache.delete(this.textCache.keys().next().value!);
    }
    this.textCache.set(key, canvas);
    return { source: canvas, width: canvas.width, height: canvas.height };
  }

  dispose(): void {
    for (const loaded of this.media.values()) URL.revokeObjectURL(loaded.objectUrl);
    this.media.clear();
    this.textCache.clear();
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/** Ticks the pool considers "close enough" when scrubbing. */
export const SCRUB_TOLERANCE: Ticks = 705_600_000 / 60;
