import { useState } from 'react';
import {
  documentDuration,
  estimateFileSize,
  EXPORT_PRESETS,
  exportWarnings,
  formatDuration,
  settingsFromPreset,
  totalFrames,
  type ExportPreset,
  type ExportSettings,
} from '@apex/edit-engine';
import { haptic, type Editor } from '../../engine-bridge/useEditor.js';
import { PanelSection, SegmentedControl } from '../controls.js';

/**
 * Export.
 *
 * The pre-flight summary is derived entirely from the engine — resolution,
 * bitrate, estimated size and the warnings all come from `render/export.ts`, so
 * the numbers a user sees here are the numbers the encoder is actually given.
 *
 * The reference build renders through the same `composeFrame` path as the
 * preview and captures the canvas with MediaRecorder. A native build swaps the
 * recorder for a hardware encoder; nothing above it changes.
 */

interface ExportPanelProps {
  editor: Editor;
  onExport: (settings: ExportSettings) => Promise<void>;
  progress: { phase: string; value: number } | null;
}

export function ExportPanel({ editor, onExport, progress }: ExportPanelProps) {
  const { doc } = editor;
  const [presetId, setPresetId] = useState(EXPORT_PRESETS[0].id);
  const [quality, setQuality] = useState<'balanced' | 'high'>('balanced');

  const preset = EXPORT_PRESETS.find((p) => p.id === presetId) ?? EXPORT_PRESETS[0];
  const base = settingsFromPreset(doc, preset);
  const settings: ExportSettings = {
    ...base,
    videoBitrate: quality === 'high' ? Math.round(base.videoBitrate * 1.6) : base.videoBitrate,
  };

  const duration = documentDuration(doc);
  const warnings = exportWarnings(doc, settings, preset);
  const bytes = estimateFileSize(doc, settings);
  const frames = totalFrames(doc, settings);
  const busy = progress !== null && progress.phase !== 'done' && progress.phase !== 'failed';

  return (
    <>
      <PanelSection title="Destination">
        <div className="preset-grid">
          {EXPORT_PRESETS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`preset-tile ${option.id === presetId ? 'is-on' : ''}`}
              onClick={() => setPresetId(option.id)}
              aria-pressed={option.id === presetId}
            >
              <span className="preset-tile__name">{option.name}</span>
              <span className="preset-tile__meta">
                {resolutionLabel(option)} · {option.videoCodec.toUpperCase()}
              </span>
            </button>
          ))}
        </div>
        {preset.note && <p className="panel-section__note">{preset.note}</p>}
      </PanelSection>

      <PanelSection title="Quality">
        <SegmentedControl
          label="Quality"
          value={quality}
          options={[
            { value: 'balanced', label: 'Balanced' },
            { value: 'high', label: 'High bitrate' },
          ]}
          onChange={setQuality}
        />
      </PanelSection>

      <PanelSection title="Summary">
        <dl className="summary">
          <div>
            <dt>Resolution</dt>
            <dd>
              {settings.resolution.width} × {settings.resolution.height}
            </dd>
          </div>
          <div>
            <dt>Frame rate</dt>
            <dd>{(settings.frameRate.num / settings.frameRate.den).toFixed(2)} fps</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>
              {formatDuration(duration, { tenths: true })} · {frames} frames
            </dd>
          </div>
          <div>
            <dt>Bitrate</dt>
            <dd>{(settings.videoBitrate / 1_000_000).toFixed(1)} Mbps</dd>
          </div>
          <div>
            <dt>Estimated size</dt>
            <dd>{formatBytes(bytes)}</dd>
          </div>
        </dl>
      </PanelSection>

      {warnings.length > 0 && (
        <PanelSection title="Before you export">
          {warnings.map((warning, i) => (
            <p key={i} className={`notice notice--${warning.severity}`}>
              {warning.message}
            </p>
          ))}
        </PanelSection>
      )}

      <PanelSection title="">
        {progress && (
          <div className="export-progress">
            <div className="export-progress__bar">
              <div style={{ width: `${progress.value * 100}%` }} />
            </div>
            <span>
              {progress.phase} · {Math.round(progress.value * 100)}%
            </span>
          </div>
        )}
        <button
          type="button"
          className="button button--accent button--large"
          disabled={busy || duration === 0}
          onClick={async () => {
            await onExport(settings);
            haptic('success');
          }}
        >
          {busy ? 'Exporting…' : 'Export'}
        </button>
        <p className="panel-section__note">
          The reference build records the preview canvas to WebM so the pipeline is end to end. A
          native build encodes to H.264/HEVC with the same render graph.
        </p>
      </PanelSection>
    </>
  );
}

function resolutionLabel(preset: ExportPreset): string {
  return preset.longEdge >= 3840 ? '4K' : preset.longEdge >= 1920 ? '1080p' : `${preset.longEdge}p`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
