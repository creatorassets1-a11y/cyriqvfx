import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addMedia,
  appendClip,
  createClip,
  createDocument,
  createMediaAsset,
  createQueue,
  createTextClip,
  defaultTitleDuration,
  deserialize,
  documentDuration,
  formatTimecode,
  framesToTicks,
  liftClips,
  newId,
  rippleDeleteClips,
  secondsToTicks,
  serialize,
  splitAt,
  ticksToSeconds,
  videoTracks,
  audioTracks,
  type EditDocument,
  type ExportSettings,
  type JobQueue,
  type Ticks,
} from '@apex/edit-engine';
import { haptic, useEditor, type ToolPanel } from './engine-bridge/useEditor.js';
import { MediaPool } from './render/media-pool.js';
import { Preview } from './components/Preview.js';
import { Timeline } from './components/Timeline.js';
import {
  AudioPanel,
  ColorPanel,
  EffectsPanel,
  SpeedPanel,
  TransformPanel,
} from './components/panels/InspectorPanels.js';
import { AiPanel } from './components/panels/AiPanel.js';
import { ExportPanel } from './components/panels/ExportPanel.js';
import { exportTimeline } from './export/recorder.js';

/**
 * The editor shell.
 *
 * Layout follows the PRD's phone-first rule: preview on top, timeline below,
 * primary tools in the thumb zone at the bottom, and contextual panels sliding
 * up over the timeline rather than replacing the preview — you should always be
 * able to see what you are changing while you change it.
 */

export function App() {
  const editor = useEditor();
  const { doc, state, apply, setPlayhead, setPanel, setMode, setPlaying, select } = editor;

  const pool = useMemo(() => new MediaPool(), []);
  const [queue, setQueueState] = useState<JobQueue>(() =>
    createQueue({ credits: 120, online: false }),
  );
  const setQueue = useCallback(
    (update: (queue: JobQueue) => JobQueue) => setQueueState((q) => update(q)),
    [],
  );

  const [exportProgress, setExportProgress] = useState<{ phase: string; value: number } | null>(null);
  const [cost, setCost] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const duration = documentDuration(doc);
  const rate = doc.project.settings.frameRate;
  const selected = editor.selectedClips[0];

  // ---------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!state.playing) return;
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const elapsed = (now - last) / 1000;
      last = now;
      setPlayhead(editorPlayheadRef.current + secondsToTicks(elapsed));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.playing, setPlayhead]);

  // The playback loop needs the live playhead without re-subscribing each frame.
  const editorPlayheadRef = useRef(state.playhead);
  editorPlayheadRef.current = state.playhead;

  // Stop at the end rather than running off into empty timeline.
  useEffect(() => {
    if (state.playing && duration > 0 && state.playhead >= duration) {
      setPlaying(false);
      setPlayhead(duration);
    }
  }, [state.playing, state.playhead, duration, setPlaying, setPlayhead]);

  // ---------------------------------------------------------------------
  // Media
  // ---------------------------------------------------------------------

  const importFiles = useCallback(
    async (files: FileList) => {
      const videoTrack = videoTracks(doc)[0];
      const audioTrack = audioTracks(doc)[0];

      for (const file of Array.from(files)) {
        const id = newId('med');
        try {
          const loaded = await pool.load(id, file);
          const seconds = pool.durationSeconds(id);
          const isImage = loaded.kind === 'image';
          const durationTicks = isImage
            ? secondsToTicks(5)
            : secondsToTicks(seconds ?? 5);

          const asset = createMediaAsset({
            id,
            kind: isImage ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'video',
            name: file.name,
            localUri: loaded.objectUrl,
            duration: isImage ? null : durationTicks,
            naturalSize: { width: loaded.width, height: loaded.height },
            hasAudio: !isImage,
          });

          const track = asset.kind === 'audio' ? audioTrack : videoTrack;
          apply(
            (d) =>
              appendClip(addMedia(d, asset), {
                ...createClip({
                  trackId: track.id,
                  start: 0,
                  duration: durationTicks,
                  content: { kind: 'media', mediaId: id },
                  withAudio: asset.hasAudio,
                  label: file.name.replace(/\.[^.]+$/, ''),
                }),
              }),
            `Import ${file.name}`,
          );
        } catch (error) {
          console.error(error);
          alert(`Could not import ${file.name}: ${(error as Error).message}`);
        }
      }
      haptic('medium');
    },
    [apply, doc, pool],
  );

  const addTitle = useCallback(() => {
    const track = videoTracks(doc)[1] ?? videoTracks(doc)[0];
    apply(
      (d) =>
        appendClip(
          d,
          createTextClip(track.id, 0, defaultTitleDuration(rate), 'Your title here', {
            fontSize: 96,
          }),
        ),
      'Add title',
    );
    haptic('light');
  }, [apply, doc, rate]);

  const addColorCard = useCallback(() => {
    const track = videoTracks(doc)[0];
    apply(
      (d) =>
        appendClip(
          d,
          createClip({
            trackId: track.id,
            start: 0,
            duration: secondsToTicks(3),
            content: { kind: 'color', color: '#22e3c3' },
            label: 'Color',
          }),
        ),
      'Add color card',
    );
  }, [apply, doc]);

  // ---------------------------------------------------------------------
  // Editing actions
  // ---------------------------------------------------------------------

  const doSplit = useCallback(() => {
    apply((d) => splitAt(d, state.playhead), 'Split');
    haptic('medium');
  }, [apply, state.playhead]);

  const doDelete = useCallback(() => {
    if (state.selection.length === 0) return;
    apply(
      (d) => (state.rippleMode ? rippleDeleteClips(d, state.selection) : liftClips(d, state.selection)),
      state.rippleMode ? 'Ripple delete' : 'Delete',
    );
    select([]);
    haptic('medium');
  }, [apply, select, state.selection, state.rippleMode]);

  const step = useCallback(
    (frames: number) => setPlayhead(state.playhead + framesToTicks(frames, rate)),
    [setPlayhead, state.playhead, rate],
  );

  // ---------------------------------------------------------------------
  // Project I/O
  // ---------------------------------------------------------------------

  const saveProject = useCallback(() => {
    const blob = new Blob([serialize(doc, { pretty: true })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${doc.project.name || 'project'}.apex.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [doc]);

  const openProject = useCallback(
    async (file: File) => {
      try {
        const { document: loaded, warnings, migratedFrom } = deserialize(await file.text());
        editor.replaceDocument(loaded, `Open ${file.name}`);
        if (warnings.length > 0 || migratedFrom !== null) {
          alert(
            [
              migratedFrom !== null ? `Updated from format ${migratedFrom}.` : null,
              ...warnings,
            ]
              .filter(Boolean)
              .join('\n'),
          );
        }
      } catch (error) {
        alert((error as Error).message);
      }
    },
    [editor],
  );

  // ---------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------

  const runExport = useCallback(
    async (settings: ExportSettings) => {
      setExportProgress({ phase: 'preparing', value: 0 });
      try {
        await exportTimeline({
          doc,
          settings,
          pool,
          onProgress: (phase, value) => setExportProgress({ phase, value }),
        });
        setExportProgress({ phase: 'done', value: 1 });
      } catch (error) {
        setExportProgress({ phase: 'failed', value: 0 });
        alert(`Export failed: ${(error as Error).message}`);
      }
    },
    [doc, pool],
  );

  // ---------------------------------------------------------------------
  // Keyboard, for tablets with a keyboard attached
  // ---------------------------------------------------------------------

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? editor.redo() : editor.undo();
        return;
      }

      switch (event.key) {
        case ' ':
          event.preventDefault();
          setPlaying(!state.playing);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          step(event.shiftKey ? -10 : -1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          step(event.shiftKey ? 10 : 1);
          break;
        case 'Backspace':
        case 'Delete':
          event.preventDefault();
          doDelete();
          break;
        case 's':
          doSplit();
          break;
        case 'Home':
          setPlayhead(0);
          break;
        case 'End':
          setPlayhead(duration);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, state.playing, setPlaying, step, doDelete, doSplit, setPlayhead, duration]);

  // ---------------------------------------------------------------------

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__left">
          <button
            type="button"
            className="icon-button"
            onClick={editor.undo}
            disabled={!editor.canUndo}
            aria-label="Undo"
          >
            ↺
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={editor.redo}
            disabled={!editor.canRedo}
            aria-label="Redo"
          >
            ↻
          </button>
        </div>

        <div className="topbar__center">
          <span className="timecode" aria-live="off">
            {formatTimecode(state.playhead, rate)}
          </span>
          <span className="topbar__meta">
            {doc.project.settings.aspectRatio} ·{' '}
            {(rate.num / rate.den).toFixed(2).replace(/\.00$/, '')} fps
            {cost > 6 && <span className="topbar__warn"> · heavy</span>}
          </span>
        </div>

        <div className="topbar__right">
          <button type="button" className="chip" onClick={saveProject}>
            Save
          </button>
          <button
            type="button"
            className={`chip ${state.mode === 'pro' ? 'is-on' : ''}`}
            onClick={() => setMode(state.mode === 'pro' ? 'simple' : 'pro')}
            aria-pressed={state.mode === 'pro'}
            title="Pro mode reveals keyframing and the full grading set"
          >
            {state.mode === 'pro' ? 'Pro' : 'Simple'}
          </button>
        </div>
      </header>

      <main className="stage">
        <Preview
          doc={doc}
          playhead={state.playhead}
          playing={state.playing}
          pool={pool}
          onCostChange={setCost}
        />

        <div className="transport">
          <button
            type="button"
            className="icon-button"
            onClick={() => setPlayhead(0)}
            aria-label="Go to start"
          >
            ⏮
          </button>
          <button type="button" className="icon-button" onClick={() => step(-1)} aria-label="Previous frame">
            ◀
          </button>
          <button
            type="button"
            className="transport__play"
            onClick={() => {
              setPlaying(!state.playing);
              haptic('light');
            }}
            aria-label={state.playing ? 'Pause' : 'Play'}
          >
            {state.playing ? '❚❚' : '▶'}
          </button>
          <button type="button" className="icon-button" onClick={() => step(1)} aria-label="Next frame">
            ▶
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setPlayhead(duration)}
            aria-label="Go to end"
          >
            ⏭
          </button>
        </div>
      </main>

      <Timeline editor={editor} />

      <nav className="toolbar" aria-label="Tools">
        <ToolButton label="Media" icon="＋" onClick={() => fileInputRef.current?.click()} />
        <ToolButton label="Split" icon="✂" onClick={doSplit} />
        <ToolButton
          label="Delete"
          icon="🗑"
          onClick={doDelete}
          disabled={state.selection.length === 0}
        />
        <ToolButton
          label="Transform"
          icon="⤢"
          active={state.panel === 'transform'}
          onClick={() => setPanel('transform')}
        />
        <ToolButton
          label="Speed"
          icon="⏱"
          active={state.panel === 'speed'}
          onClick={() => setPanel('speed')}
        />
        <ToolButton
          label="Color"
          icon="◑"
          active={state.panel === 'color'}
          onClick={() => setPanel('color')}
        />
        <ToolButton
          label="Audio"
          icon="♪"
          active={state.panel === 'audio'}
          onClick={() => setPanel('audio')}
        />
        <ToolButton
          label="Effects"
          icon="✦"
          active={state.panel === 'effects'}
          onClick={() => setPanel('effects')}
        />
        <ToolButton label="Text" icon="T" onClick={addTitle} />
        <ToolButton
          label="AI"
          icon="✨"
          active={state.panel === 'ai'}
          onClick={() => setPanel('ai')}
        />
        <ToolButton
          label="Export"
          icon="↥"
          active={state.panel === 'export'}
          onClick={() => setPanel('export')}
        />
      </nav>

      {state.panel && (
        <PanelSheet
          panel={state.panel}
          onClose={() => setPanel(state.panel)}
          title={PANEL_TITLES[state.panel]}
        >
          {state.panel === 'transform' && <TransformPanel editor={editor} clip={selected} />}
          {state.panel === 'speed' && <SpeedPanel editor={editor} clip={selected} />}
          {state.panel === 'color' && <ColorPanel editor={editor} clip={selected} />}
          {state.panel === 'audio' && <AudioPanel editor={editor} clip={selected} />}
          {state.panel === 'effects' && <EffectsPanel editor={editor} clip={selected} />}
          {state.panel === 'ai' && <AiPanel editor={editor} queue={queue} setQueue={setQueue} />}
          {state.panel === 'export' && (
            <ExportPanel editor={editor} onExport={runExport} progress={exportProgress} />
          )}
        </PanelSheet>
      )}

      {duration === 0 && (
        <StartCard
          onImport={() => fileInputRef.current?.click()}
          onTitle={addTitle}
          onColor={addColorCard}
          onOpen={() => projectInputRef.current?.click()}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,image/*,audio/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void importFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={projectInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openProject(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}

const PANEL_TITLES: Record<NonNullable<ToolPanel>, string> = {
  transform: 'Transform',
  speed: 'Speed',
  color: 'Color',
  audio: 'Audio',
  text: 'Text',
  effects: 'Effects',
  captions: 'Captions',
  ai: 'AI',
  export: 'Export',
};

function ToolButton({
  label,
  icon,
  onClick,
  active,
  disabled,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`tool ${active ? 'is-on' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
    >
      <span className="tool__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="tool__label">{label}</span>
    </button>
  );
}

function PanelSheet({
  title,
  children,
  onClose,
}: {
  panel: ToolPanel;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="panel" role="region" aria-label={title}>
      <div className="panel__header">
        <h2 className="panel__title">{title}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label={`Close ${title}`}>
          ✕
        </button>
      </div>
      <div className="panel__body">{children}</div>
    </div>
  );
}

function StartCard({
  onImport,
  onTitle,
  onColor,
  onOpen,
}: {
  onImport: () => void;
  onTitle: () => void;
  onColor: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="start-card">
      <h2>Start editing</h2>
      <p>
        Everything here runs locally — no account, no upload. Bring in your own footage, or drop in a
        title and a colour card to try the timeline with nothing at all.
      </p>
      <div className="start-card__actions">
        <button type="button" className="button button--accent" onClick={onImport}>
          Import media
        </button>
        <button type="button" className="button" onClick={onTitle}>
          Add a title
        </button>
        <button type="button" className="button" onClick={onColor}>
          Add a color card
        </button>
        <button type="button" className="button" onClick={onOpen}>
          Open a project
        </button>
      </div>
    </div>
  );
}
