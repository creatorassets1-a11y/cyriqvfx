import {
  clipGainAt,
  constant,
  constantSpeed,
  describeSpeed,
  dbToLinear,
  defaultAudioParams,
  EFFECT_DEFS,
  evaluateNumber,
  evaluateVec2,
  getEffectDef,
  defaultParams,
  neutralGrade,
  newId,
  reverseClip,
  setClipSpeed,
  setKeyframe,
  slowMoRamp,
  updateClip,
  type Clip,
  type EffectInstance,
  type Ticks,
} from '@apex/edit-engine';
import { haptic, type Editor } from '../../engine-bridge/useEditor.js';
import {
  EmptyState,
  OnlineBadge,
  PanelSection,
  SegmentedControl,
  Slider,
  Toggle,
} from '../controls.js';

/**
 * Clip inspectors.
 *
 * Every control writes through an engine operation rather than mutating a clip
 * directly, so the same clamping and keyframe bookkeeping the timeline gets
 * applies here too. A slider that could produce a state the timeline cannot is
 * a bug waiting to happen.
 */

interface PanelProps {
  editor: Editor;
  clip: Clip | undefined;
}

/** Clip-relative playhead, which is where a keyframe would land. */
function clipTime(editor: Editor, clip: Clip): Ticks {
  return Math.min(Math.max(editor.state.playhead - clip.start, 0), clip.duration);
}

// ---------------------------------------------------------------------------

export function TransformPanel({ editor, clip }: PanelProps) {
  if (!clip) return <EmptyState title="No clip selected" body="Tap a clip to transform it." />;
  const t = clipTime(editor, clip);
  const transform = clip.transform;
  const position = evaluateVec2(transform.position, t);
  const scale = evaluateVec2(transform.scale, t);

  const write = (patch: Partial<Clip['transform']>, label: string, key?: string) =>
    editor.apply((d) => updateClip(d, clip.id, (c) => ({ transform: { ...c.transform, ...patch } })), label, {
      coalesceKey: key,
    });

  const keyed = editor.state.mode === 'pro';

  return (
    <>
      <PanelSection
        title="Position"
        note={keyed ? 'Values are written as keyframes at the playhead.' : undefined}
      >
        <Slider
          label="X"
          value={position.x}
          min={-1}
          max={1}
          onChange={(x) =>
            write(
              {
                position: keyed
                  ? setKeyframe(transform.position, t, { x, y: position.y })
                  : constant({ x, y: position.y }),
              },
              'Move',
              'transform-x',
            )
          }
        />
        <Slider
          label="Y"
          value={position.y}
          min={-1}
          max={1}
          onChange={(y) =>
            write(
              {
                position: keyed
                  ? setKeyframe(transform.position, t, { x: position.x, y })
                  : constant({ x: position.x, y }),
              },
              'Move',
              'transform-y',
            )
          }
        />
      </PanelSection>

      <PanelSection title="Scale & rotation">
        <Slider
          label="Scale"
          value={scale.x}
          min={0.05}
          max={4}
          defaultValue={1}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(s) =>
            write(
              {
                scale: keyed
                  ? setKeyframe(transform.scale, t, { x: s, y: s })
                  : constant({ x: s, y: s }),
              },
              'Scale',
              'transform-scale',
            )
          }
        />
        <Slider
          label="Rotation"
          value={evaluateNumber(transform.rotation, t)}
          min={-180}
          max={180}
          step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={(r) =>
            write(
              { rotation: keyed ? setKeyframe(transform.rotation, t, r) : constant(r) },
              'Rotate',
              'transform-rotate',
            )
          }
        />
        <Slider
          label="Opacity"
          value={evaluateNumber(transform.opacity, t)}
          min={0}
          max={1}
          defaultValue={1}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(o) =>
            write(
              { opacity: keyed ? setKeyframe(transform.opacity, t, o) : constant(o) },
              'Opacity',
              'transform-opacity',
            )
          }
        />
        <Slider
          label="Corner radius"
          value={evaluateNumber(transform.cornerRadius, t)}
          min={0}
          max={0.5}
          onChange={(r) => write({ cornerRadius: constant(r) }, 'Round corners', 'transform-radius')}
        />
      </PanelSection>

      <PanelSection title="Flip">
        <div className="button-row">
          <button type="button" className="button" onClick={() => write({ flipH: !transform.flipH }, 'Flip')}>
            Horizontal
          </button>
          <button type="button" className="button" onClick={() => write({ flipV: !transform.flipV }, 'Flip')}>
            Vertical
          </button>
        </div>
      </PanelSection>

      <PanelSection title="Crop">
        {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
          <Slider
            key={side}
            label={side[0].toUpperCase() + side.slice(1)}
            value={transform.crop[side]}
            min={0}
            max={0.45}
            onChange={(v) =>
              write({ crop: { ...transform.crop, [side]: v } }, 'Crop', `crop-${side}`)
            }
          />
        ))}
      </PanelSection>
    </>
  );
}

// ---------------------------------------------------------------------------

export function SpeedPanel({ editor, clip }: PanelProps) {
  if (!clip) return <EmptyState title="No clip selected" body="Tap a clip to change its speed." />;

  const rate = clip.speed.kind === 'constant' ? clip.speed.rate : 1;
  const isRamp = clip.speed.kind === 'curve';

  const setSpeed = (spec: Clip['speed'], label: string, key?: string) =>
    editor.apply(
      (d) => {
        const current = d.clips[clip.id];
        return current ? updateClipWith(d, setClipSpeed(d, current, spec)) : d;
      },
      label,
      { coalesceKey: key },
    );

  return (
    <>
      <PanelSection title="Speed" note={`Currently ${describeSpeed(clip.speed)}.`}>
        <Slider
          label="Rate"
          value={rate}
          min={0.1}
          max={10}
          step={0.05}
          defaultValue={1}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(r) => setSpeed(constantSpeed(r), 'Change speed', 'speed-rate')}
        />
        <div className="button-row button-row--wrap">
          {[0.25, 0.5, 1, 2, 4].map((preset) => (
            <button
              key={preset}
              type="button"
              className={`chip ${!isRamp && Math.abs(rate - preset) < 0.01 ? 'is-on' : ''}`}
              onClick={() => {
                setSpeed(constantSpeed(preset), 'Change speed');
                haptic('light');
              }}
            >
              {preset}×
            </button>
          ))}
        </div>
      </PanelSection>

      <PanelSection
        title="Ramps"
        note="A ramp changes speed over the clip. Splitting or trimming keeps the part of the curve the piece covered."
      >
        <button
          type="button"
          className={`button ${isRamp ? 'is-on' : ''}`}
          onClick={() => setSpeed(slowMoRamp(0.25), 'Apply speed ramp')}
        >
          Slow-motion ramp
        </button>
      </PanelSection>

      <PanelSection title="Options">
        <Toggle
          label="Reverse"
          checked={clip.speed.kind !== 'freeze' && clip.speed.reverse}
          onChange={() =>
            editor.apply(
              (d) => updateClipWith(d, reverseClip(d.clips[clip.id])),
              'Reverse clip',
            )
          }
        />
        <Toggle
          label="Keep pitch natural"
          hint="Corrects formants so a sped-up voice does not sound like a chipmunk."
          checked={clip.speed.kind !== 'freeze' && clip.speed.pitchCorrection}
          onChange={(on) => {
            if (clip.speed.kind === 'freeze') return;
            editor.apply(
              (d) => updateClip(d, clip.id, (c) => ({
                speed: c.speed.kind === 'freeze' ? c.speed : { ...c.speed, pitchCorrection: on },
              })),
              'Pitch correction',
            );
          }}
        />
        {clip.speed.kind !== 'freeze' && (
          <SegmentedControl
            label="Frame blending"
            value={clip.speed.frameBlending}
            options={[
              { value: 'none', label: 'None' },
              { value: 'blend', label: 'Blend' },
              { value: 'optical-flow', label: 'Optical flow' },
            ]}
            onChange={(blending) =>
              editor.apply(
                (d) => updateClip(d, clip.id, (c) => ({
                  speed: c.speed.kind === 'freeze' ? c.speed : { ...c.speed, frameBlending: blending },
                })),
                'Frame blending',
              )
            }
          />
        )}
      </PanelSection>
    </>
  );
}

// ---------------------------------------------------------------------------

const GRADE_CONTROLS = [
  { key: 'exposure', label: 'Exposure', min: -3, max: 3, format: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV` },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1 },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1 },
  { key: 'vibrance', label: 'Vibrance', min: -1, max: 1 },
  { key: 'temperature', label: 'Temperature', min: -1, max: 1 },
  { key: 'tint', label: 'Tint', min: -1, max: 1 },
  { key: 'highlights', label: 'Highlights', min: -1, max: 1 },
  { key: 'shadows', label: 'Shadows', min: -1, max: 1 },
  { key: 'whites', label: 'Whites', min: -1, max: 1 },
  { key: 'blacks', label: 'Blacks', min: -1, max: 1 },
] as const;

const LOOK_CONTROLS = [
  { key: 'fade', label: 'Fade', min: 0, max: 1 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1 },
  { key: 'grain', label: 'Grain', min: 0, max: 1 },
] as const;

export function ColorPanel({ editor, clip }: PanelProps) {
  if (!clip) return <EmptyState title="No clip selected" body="Tap a clip to grade it." />;
  const grade = clip.grade ?? neutralGrade();
  const t = clipTime(editor, clip);
  const pro = editor.state.mode === 'pro';

  const set = (key: string, value: number) =>
    editor.apply(
      (d) => updateClip(d, clip.id, (c) => {
        const base = c.grade ?? neutralGrade();
        const property = (base as unknown as Record<string, ReturnType<typeof constant<number>>>)[key];
        return {
          grade: {
            ...base,
            [key]: pro ? setKeyframe(property, t, value) : constant(value),
          } as Clip['grade'],
        };
      }),
      'Adjust color',
      { coalesceKey: `grade-${key}` },
    );

  const read = (key: string) =>
    evaluateNumber((grade as unknown as Record<string, ReturnType<typeof constant<number>>>)[key], t);

  const controls = pro ? GRADE_CONTROLS : GRADE_CONTROLS.slice(0, 6);

  return (
    <>
      <PanelSection
        title="Color"
        note={pro ? 'Adjustments are keyframed at the playhead in Pro mode.' : undefined}
      >
        {controls.map((control) => (
          <Slider
            key={control.key}
            label={control.label}
            value={read(control.key)}
            min={control.min}
            max={control.max}
            format={'format' in control ? control.format : undefined}
            onChange={(v) => set(control.key, v)}
          />
        ))}
      </PanelSection>

      <PanelSection title="Look">
        {LOOK_CONTROLS.map((control) => (
          <Slider
            key={control.key}
            label={control.label}
            value={read(control.key)}
            min={control.min}
            max={control.max}
            onChange={(v) => set(control.key, v)}
          />
        ))}
      </PanelSection>

      <PanelSection title="Reset">
        <button
          type="button"
          className="button"
          onClick={() => editor.apply((d) => updateClip(d, clip.id, { grade: null }), 'Reset color')}
        >
          Remove all color adjustments
        </button>
      </PanelSection>
    </>
  );
}

// ---------------------------------------------------------------------------

export function AudioPanel({ editor, clip }: PanelProps) {
  if (!clip) return <EmptyState title="No clip selected" body="Tap a clip to mix it." />;
  const audio = clip.audio ?? defaultAudioParams();
  const t = clipTime(editor, clip);
  const pro = editor.state.mode === 'pro';

  const set = (patch: Partial<typeof audio>, label: string, key?: string) =>
    editor.apply(
      (d) => updateClip(d, clip.id, (c) => ({ audio: { ...(c.audio ?? defaultAudioParams()), ...patch } })),
      label,
      { coalesceKey: key },
    );

  const gain = evaluateNumber(audio.gainDb, t);

  return (
    <>
      <PanelSection title="Level">
        <Slider
          label="Volume"
          value={gain}
          min={-60}
          max={12}
          step={0.5}
          format={(v) => (v <= -60 ? '−∞ dB' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`)}
          onChange={(db) =>
            set(
              { gainDb: pro ? setKeyframe(audio.gainDb, t, db) : constant(db) },
              'Set volume',
              'audio-gain',
            )
          }
        />
        <p className="panel-section__note">
          Linear gain {dbToLinear(gain).toFixed(3)} · playing at{' '}
          {(clipGainAt(audio, t, clip.duration) * 100).toFixed(0)}% here
        </p>
        <Slider
          label="Pan"
          value={evaluateNumber(audio.pan, t)}
          min={-1}
          max={1}
          format={(v) => (Math.abs(v) < 0.01 ? 'Center' : v < 0 ? `${Math.round(-v * 100)}% L` : `${Math.round(v * 100)}% R`)}
          onChange={(p) => set({ pan: constant(p) }, 'Set pan', 'audio-pan')}
        />
        <Toggle label="Mute" checked={audio.muted} onChange={(m) => set({ muted: m }, 'Mute clip')} />
      </PanelSection>

      <PanelSection title="Fades">
        <Slider
          label="Fade in"
          value={(audio.fadeIn?.duration ?? 0) / 705_600_000}
          min={0}
          max={5}
          step={0.1}
          format={(v) => `${v.toFixed(1)}s`}
          onChange={(seconds) =>
            set(
              {
                fadeIn:
                  seconds > 0
                    ? { duration: Math.round(seconds * 705_600_000), shape: 'equal-power' }
                    : null,
              },
              'Fade in',
              'audio-fade-in',
            )
          }
        />
        <Slider
          label="Fade out"
          value={(audio.fadeOut?.duration ?? 0) / 705_600_000}
          min={0}
          max={5}
          step={0.1}
          format={(v) => `${v.toFixed(1)}s`}
          onChange={(seconds) =>
            set(
              {
                fadeOut:
                  seconds > 0
                    ? { duration: Math.round(seconds * 705_600_000), shape: 'equal-power' }
                    : null,
              },
              'Fade out',
              'audio-fade-out',
            )
          }
        />
      </PanelSection>

      <PanelSection title="Cleanup" note="Runs on this device. Nothing is uploaded.">
        <Slider
          label="Noise reduction"
          value={audio.noiseReduction}
          min={0}
          max={1}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set({ noiseReduction: v }, 'Noise reduction', 'audio-nr')}
        />
        {pro && (
          <Slider
            label="Pitch"
            value={audio.pitchSemitones}
            min={-12}
            max={12}
            step={1}
            format={(v) => `${v > 0 ? '+' : ''}${v} st`}
            onChange={(v) => set({ pitchSemitones: v }, 'Pitch shift', 'audio-pitch')}
          />
        )}
      </PanelSection>
    </>
  );
}

// ---------------------------------------------------------------------------

export function EffectsPanel({ editor, clip }: PanelProps) {
  if (!clip) return <EmptyState title="No clip selected" body="Tap a clip to add effects." />;

  const add = (type: string) => {
    const instance: EffectInstance = {
      id: newId('fx'),
      type,
      enabled: true,
      params: defaultParams(type),
    };
    editor.apply(
      (d) => updateClip(d, clip.id, (c) => ({ effects: [...c.effects, instance] })),
      `Add ${getEffectDef(type)?.name ?? 'effect'}`,
    );
    haptic('light');
  };

  const remove = (id: string) =>
    editor.apply(
      (d) => updateClip(d, clip.id, (c) => ({ effects: c.effects.filter((e) => e.id !== id) })),
      'Remove effect',
    );

  const setParam = (effectId: string, key: string, value: unknown) =>
    editor.apply(
      (d) => updateClip(d, clip.id, (c) => ({
        effects: c.effects.map((e) =>
          e.id === effectId ? { ...e, params: { ...e.params, [key]: value } } : e,
        ),
      })),
      'Adjust effect',
      { coalesceKey: `fx-${effectId}-${key}` },
    );

  const available = editor.state.mode === 'pro'
    ? EFFECT_DEFS
    : EFFECT_DEFS.filter((d) => d.cost !== 'high');

  return (
    <>
      {clip.effects.length > 0 && (
        <PanelSection title="Applied">
          {clip.effects.map((effect) => {
            const def = getEffectDef(effect.type);
            if (!def) return null;
            return (
              <div key={effect.id} className="effect-card">
                <div className="effect-card__head">
                  <span>{def.name}</span>
                  {def.requiresNetwork && <OnlineBadge />}
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${def.name}`}
                    onClick={() => remove(effect.id)}
                  >
                    ×
                  </button>
                </div>
                {def.params
                  .filter((p) => p.type === 'number' || p.type === 'percent' || p.type === 'angle')
                  .map((param) => (
                    <Slider
                      key={param.key}
                      label={param.label}
                      value={Number(effect.params[param.key] ?? param.default)}
                      min={param.min ?? 0}
                      max={param.max ?? 1}
                      step={param.step ?? 0.01}
                      defaultValue={Number(param.default)}
                      onChange={(v) => setParam(effect.id, param.key, v)}
                    />
                  ))}
              </div>
            );
          })}
        </PanelSection>
      )}

      <PanelSection title="Add an effect">
        <div className="effect-grid">
          {available.map((def) => (
            <button key={def.type} type="button" className="effect-tile" onClick={() => add(def.type)}>
              <span className="effect-tile__name">{def.name}</span>
              <span className="effect-tile__meta">
                {def.requiresNetwork ? 'Online' : def.cost === 'high' ? 'Heavy' : 'On device'}
              </span>
            </button>
          ))}
        </div>
      </PanelSection>
    </>
  );
}

/** Replace a clip wholesale, preserving the track index. */
function updateClipWith(doc: Parameters<typeof updateClip>[0], clip: Clip) {
  return updateClip(doc, clip.id, clip);
}
