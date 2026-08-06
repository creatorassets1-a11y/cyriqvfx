import { useEffect, useRef } from 'react';
import {
  composeFrame,
  frameCost,
  ticksToSeconds,
  type EditDocument,
  type Ticks,
} from '@apex/edit-engine';
import { Compositor } from '../render/compositor.js';
import type { MediaPool } from '../render/media-pool.js';

/**
 * The preview surface.
 *
 * Every displayed frame goes through the same path an export does:
 * `composeFrame` produces a render description and the compositor draws it.
 * There is deliberately no "preview-only" shortcut — a preview that renders
 * differently from the export is worse than no preview.
 */

interface PreviewProps {
  doc: EditDocument;
  playhead: Ticks;
  playing: boolean;
  pool: MediaPool;
  onCostChange?: (cost: number) => void;
}

export function Preview({ doc, playhead, playing, pool, onCostChange }: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const frameRef = useRef<number>(0);
  const errorRef = useRef<string | null>(null);

  // Keep the latest props in refs so the render loop is created once and never
  // torn down mid-playback by a dependency change.
  const latest = useRef({ doc, playhead, playing, pool, onCostChange });
  latest.current = { doc, playhead, playing, pool, onCostChange };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      compositorRef.current = new Compositor(canvas);
    } catch (error) {
      errorRef.current = error instanceof Error ? error.message : String(error);
      return;
    }

    const draw = () => {
      const { doc, playhead, playing, pool, onCostChange } = latest.current;
      const compositor = compositorRef.current;
      if (compositor) {
        const frame = composeFrame(doc, playhead, { preferProxy: playing });
        if (playing) pool.play(frame.layers);
        compositor.render(frame, (layer) => pool.resolve(layer), ticksToSeconds(playhead));
        onCostChange?.(frameCost(frame));
      }
      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(() => {
    if (!playing) pool.pauseAll();
  }, [playing, pool]);

  return (
    <div className="preview">
      <canvas
        ref={canvasRef}
        className="preview__canvas"
        role="img"
        aria-label={`Video preview at ${Math.round(ticksToSeconds(playhead) * 10) / 10} seconds`}
      />
      {errorRef.current && (
        <div className="preview__error" role="alert">
          {errorRef.current}
        </div>
      )}
    </div>
  );
}
