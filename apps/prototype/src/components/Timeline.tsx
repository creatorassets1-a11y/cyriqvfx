import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clipsOnTrack,
  describeSpeed,
  documentDuration,
  formatDuration,
  isSpeedAltered,
  moveClip,
  roundToFrame,
  secondsToTicks,
  snapTarget,
  ticksToSeconds,
  trimClipEnd,
  trimClipStart,
  type Clip,
  type Id,
  type Ticks,
  type Track,
} from '@apex/edit-engine';
import { haptic, MAX_ZOOM, MIN_ZOOM, type Editor } from '../engine-bridge/useEditor.js';

/**
 * The timeline.
 *
 * Three gestures share one surface, distinguished by where the touch lands:
 * a drag on a clip's body moves it, a drag on either edge trims it, and a drag
 * anywhere else scrubs the playhead. Pinch zooms. Each gesture folds into a
 * single undo entry through the editor's coalescing key.
 */

interface TimelineProps {
  editor: Editor;
}

/** Snap distance in pixels — converted to ticks against the current zoom. */
const SNAP_PIXELS = 12;
/** Width of the trim handle hit area. Generous, because fingers are wide. */
const TRIM_HANDLE_PX = 22;

type DragKind = 'move' | 'trim-start' | 'trim-end' | 'scrub';

interface DragState {
  kind: DragKind;
  clipId: Id | null;
  startX: number;
  startY: number;
  originalStart: Ticks;
  originalDuration: Ticks;
  gestureKey: string;
  trackId: Id;
  moved: boolean;
}

export function Timeline({ editor }: TimelineProps) {
  const { doc, state, apply, setPlayhead, select, setZoom } = editor;
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const duration = documentDuration(doc);
  const pxPerSecond = state.zoom;
  const timeToPx = useCallback((t: Ticks) => ticksToSeconds(t) * pxPerSecond, [pxPerSecond]);
  const pxToTime = useCallback((px: number) => secondsToTicks(px / pxPerSecond), [pxPerSecond]);

  // Always leave a screen of runway past the last clip so there is somewhere to
  // drag to.
  const contentWidth = Math.max(timeToPx(duration) + 800, 1200);
  const snapTolerance = pxToTime(SNAP_PIXELS);

  const tracks = useMemo(() => {
    const video = doc.tracks.filter((t) => t.kind === 'video').sort((a, b) => b.index - a.index);
    const audio = doc.tracks.filter((t) => t.kind === 'audio').sort((a, b) => a.index - b.index);
    // Show only tracks in use plus one empty of each kind, so an empty project
    // is not a wall of twelve blank rows.
    const used = (t: Track) => (doc.trackClips[t.id]?.length ?? 0) > 0;
    const trim = (list: Track[]) => {
      const lastUsed = list.reduce((acc, t, i) => (used(t) ? i : acc), -1);
      return list.slice(0, Math.min(list.length, Math.max(lastUsed + 2, 1)));
    };
    return [...trim(video.slice().reverse()).reverse(), ...trim(audio)];
  }, [doc]);

  // ---------------------------------------------------------------------
  // Gestures
  // ---------------------------------------------------------------------

  /** Playhead position for a pointer event, in timeline ticks. */
  const timeAtPointer = useCallback(
    (clientX: number): Ticks | null => {
      const rect = scrollRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
      return pxToTime(clientX - rect.left + scrollLeft);
    },
    [pxToTime],
  );

  const beginDrag = useCallback(
    (event: React.PointerEvent, kind: DragKind, clip: Clip | null, trackId: Id) => {
      (event.target as Element).setPointerCapture?.(event.pointerId);

      // A tap on the ruler should move the playhead there straight away rather
      // than waiting for the pointer to travel — tapping to position is the
      // more common intent than dragging to scrub.
      if (kind === 'scrub') {
        const time = timeAtPointer(event.clientX);
        if (time !== null) setPlayhead(time);
      }

      dragRef.current = {
        kind,
        clipId: clip?.id ?? null,
        startX: event.clientX,
        startY: event.clientY,
        originalStart: clip?.start ?? 0,
        originalDuration: clip?.duration ?? 0,
        gestureKey: `${kind}-${Date.now()}`,
        trackId,
        moved: false,
      };
      setDragging(true);
      if (clip) haptic('light');
    },
    [timeAtPointer, setPlayhead],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = event.clientX - drag.startX;
      if (!drag.moved && Math.abs(dx) < 3) return;
      drag.moved = true;

      const rate = doc.project.settings.frameRate;
      const deltaTicks = pxToTime(dx);

      if (drag.kind === 'scrub') {
        const time = timeAtPointer(event.clientX);
        if (time !== null) setPlayhead(time);
        return;
      }

      const clip = drag.clipId ? doc.clips[drag.clipId] : null;
      if (!clip) return;

      switch (drag.kind) {
        case 'move': {
          let target = drag.originalStart + deltaTicks;
          if (state.snapping) {
            const snap = snapTarget(doc, target, snapTolerance, { exclude: [clip.id] });
            if (snap !== null) target = snap;
          }
          // Vertical movement past half a row retargets the track.
          const dy = event.clientY - drag.startY;
          const trackId = retarget(tracks, drag.trackId, dy, clip);
          apply(
            (d) =>
              moveClip(d, clip.id, {
                trackId,
                start: Math.max(0, roundToFrame(target, rate)),
                policy: state.rippleMode ? 'ripple' : 'overwrite',
              }),
            'Move clip',
            { coalesceKey: drag.gestureKey },
          );
          break;
        }
        case 'trim-start': {
          let target = drag.originalStart + deltaTicks;
          if (state.snapping) {
            const snap = snapTarget(doc, target, snapTolerance, { exclude: [clip.id] });
            if (snap !== null) target = snap;
          }
          apply(
            (d) => trimClipStart(d, clip.id, target, { ripple: state.rippleMode }),
            'Trim clip',
            { coalesceKey: drag.gestureKey },
          );
          break;
        }
        case 'trim-end': {
          let target = drag.originalStart + drag.originalDuration + deltaTicks;
          if (state.snapping) {
            const snap = snapTarget(doc, target, snapTolerance, { exclude: [clip.id] });
            if (snap !== null) target = snap;
          }
          apply(
            (d) => trimClipEnd(d, clip.id, target, { ripple: state.rippleMode }),
            'Trim clip',
            { coalesceKey: drag.gestureKey },
          );
          break;
        }
      }
    },
    [doc, apply, pxToTime, setPlayhead, timeAtPointer, snapTolerance, state.snapping, state.rippleMode, tracks],
  );

  const endDrag = useCallback(() => {
    if (dragRef.current?.moved) haptic('light');
    dragRef.current = null;
    setDragging(false);
  }, []);

  // Pinch to zoom, and trackpad/wheel zoom with a modifier.
  const onTouchStart = useCallback(
    (event: React.TouchEvent) => {
      if (event.touches.length !== 2) return;
      pinchRef.current = { distance: touchDistance(event.touches), zoom: state.zoom };
    },
    [state.zoom],
  );

  const onTouchMove = useCallback(
    (event: React.TouchEvent) => {
      const pinch = pinchRef.current;
      if (!pinch || event.touches.length !== 2) return;
      const ratio = touchDistance(event.touches) / pinch.distance;
      setZoom(pinch.zoom * ratio);
    },
    [setZoom],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((current) => current * (1 - event.deltaY / 500));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  return (
    <div className="timeline">
      <TimelineToolbar editor={editor} />

      <div
        ref={scrollRef}
        className={`timeline__scroll ${dragging ? 'is-dragging' : ''}`}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={() => (pinchRef.current = null)}
      >
        <div className="timeline__content" style={{ width: contentWidth }}>
          <Ruler
            duration={duration}
            pxPerSecond={pxPerSecond}
            width={contentWidth}
            onScrub={(event) => beginDrag(event, 'scrub', null, '')}
          />

          <div
            className="timeline__tracks"
            onPointerDown={(event) => {
              // Empty track space scrubs too. The ruler alone is a 26px target,
              // which is far too small to be the only way to move the playhead
              // on a phone. Clips handle their own pointer events, so only a
              // press that lands on the lane background gets here.
              const target = event.target as HTMLElement;
              if (target.closest('.clip')) return;
              beginDrag(event, 'scrub', null, '');
              select([]);
            }}
          >
            {tracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                clips={clipsOnTrack(doc, track.id)}
                selection={state.selection}
                timeToPx={timeToPx}
                onSelect={select}
                onBeginDrag={beginDrag}
              />
            ))}
          </div>

          <div
            className="timeline__playhead"
            style={{ transform: `translateX(${timeToPx(state.playhead)}px)` }}
            aria-hidden="true"
          >
            <div className="timeline__playhead-handle" />
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------

function Ruler({
  duration,
  pxPerSecond,
  width,
  onScrub,
}: {
  duration: Ticks;
  pxPerSecond: number;
  width: number;
  onScrub: (event: React.PointerEvent) => void;
}) {
  // Choose a tick interval that keeps labels at least 64px apart, stepping
  // through a sequence that reads naturally as time rather than arbitrary
  // decimals.
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const interval = candidates.find((c) => c * pxPerSecond >= 64) ?? 600;
  const count = Math.ceil(width / (interval * pxPerSecond)) + 1;

  return (
    <div className="ruler" onPointerDown={onScrub} role="presentation">
      {Array.from({ length: count }, (_, i) => {
        const seconds = i * interval;
        return (
          <div key={i} className="ruler__tick" style={{ left: seconds * pxPerSecond }}>
            <span className="ruler__label">
              {formatDuration(secondsToTicks(seconds), { tenths: interval < 1 })}
            </span>
          </div>
        );
      })}
      <div className="ruler__end" style={{ left: ticksToSeconds(duration) * pxPerSecond }} />
    </div>
  );
}

function TrackRow({
  track,
  clips,
  selection,
  timeToPx,
  onSelect,
  onBeginDrag,
}: {
  track: Track;
  clips: Clip[];
  selection: readonly Id[];
  timeToPx: (t: Ticks) => number;
  onSelect: (ids: Id[], additive?: boolean) => void;
  onBeginDrag: (event: React.PointerEvent, kind: DragKind, clip: Clip | null, trackId: Id) => void;
}) {
  return (
    <div
      className={`track track--${track.kind} ${track.locked ? 'is-locked' : ''}`}
      style={{ height: track.height }}
      data-track-id={track.id}
    >
      <div className="track__lane">
        {clips.map((clip) => {
          const selected = selection.includes(clip.id);
          const left = timeToPx(clip.start);
          const width = Math.max(timeToPx(clip.duration), 8);

          return (
            <div
              key={clip.id}
              className={`clip clip--${track.kind} ${selected ? 'is-selected' : ''}`}
              style={{
                left,
                width,
                ...(clip.colorTag ? { ['--clip-tag' as string]: clip.colorTag } : {}),
              }}
              role="button"
              tabIndex={0}
              aria-label={clipLabel(clip, track)}
              aria-pressed={selected}
              onPointerDown={(event) => {
                onSelect([clip.id], event.shiftKey);
                if (!track.locked) onBeginDrag(event, 'move', clip, track.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect([clip.id]);
                }
              }}
            >
              <span className="clip__label">{clipTitle(clip)}</span>

              {isSpeedAltered(clip.speed) && (
                <span className="clip__badge">{describeSpeed(clip.speed)}</span>
              )}
              {clip.transitionIn && <span className="clip__transition" aria-hidden="true" />}

              {width > TRIM_HANDLE_PX * 2 && !track.locked && (
                <>
                  <button
                    type="button"
                    className="clip__handle clip__handle--start"
                    aria-label={`Trim start of ${clipTitle(clip)}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onSelect([clip.id]);
                      onBeginDrag(event, 'trim-start', clip, track.id);
                    }}
                  />
                  <button
                    type="button"
                    className="clip__handle clip__handle--end"
                    aria-label={`Trim end of ${clipTitle(clip)}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onSelect([clip.id]);
                      onBeginDrag(event, 'trim-end', clip, track.id);
                    }}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineToolbar({ editor }: { editor: Editor }) {
  const { state, setZoom, toggleSnapping, toggleRipple } = editor;
  return (
    <div className="timeline__bar">
      <button
        type="button"
        className={`chip ${state.snapping ? 'is-on' : ''}`}
        onClick={toggleSnapping}
        aria-pressed={state.snapping}
      >
        Snap
      </button>
      <button
        type="button"
        className={`chip ${state.rippleMode ? 'is-on' : ''}`}
        onClick={toggleRipple}
        aria-pressed={state.rippleMode}
        title="Trims and moves push the clips after them"
      >
        Ripple
      </button>
      <div className="timeline__zoom">
        <button
          type="button"
          className="icon-button"
          onClick={() => setZoom((z) => z / 1.5)}
          aria-label="Zoom out"
          disabled={state.zoom <= MIN_ZOOM}
        >
          −
        </button>
        <input
          type="range"
          min={Math.log(MIN_ZOOM)}
          max={Math.log(MAX_ZOOM)}
          step={0.01}
          value={Math.log(state.zoom)}
          onChange={(event) => setZoom(Math.exp(Number(event.target.value)))}
          aria-label="Timeline zoom"
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => setZoom((z) => z * 1.5)}
          aria-label="Zoom in"
          disabled={state.zoom >= MAX_ZOOM}
        >
          +
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------

function clipTitle(clip: Clip): string {
  if (clip.label) return clip.label;
  switch (clip.content.kind) {
    case 'text':
      return clip.content.text.slice(0, 20) || 'Text';
    case 'color':
      return 'Color';
    case 'shape':
      return 'Shape';
    case 'adjustment':
      return 'Adjustment';
    default:
      return 'Clip';
  }
}

function clipLabel(clip: Clip, track: Track): string {
  const seconds = Math.round(ticksToSeconds(clip.duration) * 10) / 10;
  return `${clipTitle(clip)} on ${track.name}, ${seconds} seconds`;
}

/** Which track a vertical drag has landed on. */
function retarget(tracks: Track[], currentId: Id, dy: number, clip: Clip): Id {
  const index = tracks.findIndex((t) => t.id === currentId);
  if (index < 0) return currentId;
  const rowHeight = tracks[index].height;
  const steps = Math.round(dy / rowHeight);
  const target = tracks[Math.min(tracks.length - 1, Math.max(0, index + steps))];
  // Never drop a video clip onto an audio track or the reverse.
  const isAudioClip = clip.content.kind === 'media' && clip.audio !== null;
  if (target.kind !== tracks[index].kind && !isAudioClip) return currentId;
  return target.id;
}

function touchDistance(touches: React.TouchList): number {
  const [a, b] = [touches[0], touches[1]];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
