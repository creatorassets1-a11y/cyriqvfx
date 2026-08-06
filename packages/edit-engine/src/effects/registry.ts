/**
 * Effect registry.
 *
 * Effects declare their parameters as data, so the inspector UI is generated
 * rather than hand-written per effect, and a renderer can validate that it
 * knows how to execute an effect before the user applies it. Adding an effect
 * means adding a definition here and a shader on each platform — no UI work.
 */

export type ParamType = 'number' | 'percent' | 'angle' | 'color' | 'bool' | 'enum' | 'point';

export interface ParamDef {
  readonly key: string;
  readonly label: string;
  readonly type: ParamType;
  readonly default: unknown;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Whether the inspector offers a keyframe toggle for this parameter. */
  readonly animatable: boolean;
  readonly options?: readonly { value: string; label: string }[];
  readonly hint?: string;
}

export type EffectCategory =
  | 'stylize'
  | 'blur-sharpen'
  | 'distort'
  | 'light'
  | 'retro'
  | 'transition'
  | 'ai'
  | 'utility';

export interface EffectDef {
  readonly type: string;
  readonly name: string;
  readonly category: EffectCategory;
  /** Server-backed effects are gated behind connectivity and credits. */
  readonly requiresNetwork: boolean;
  /**
   * Rough per-frame cost on a mid-range device, used to warn before applying a
   * stack the device cannot play back in real time.
   */
  readonly cost: 'low' | 'medium' | 'high';
  readonly params: readonly ParamDef[];
}

const pct = (key: string, label: string, def = 0.5): ParamDef => ({
  key,
  label,
  type: 'percent',
  default: def,
  min: 0,
  max: 1,
  step: 0.01,
  animatable: true,
});

export const EFFECT_DEFS: readonly EffectDef[] = [
  {
    type: 'gaussian-blur',
    name: 'Blur',
    category: 'blur-sharpen',
    requiresNetwork: false,
    cost: 'medium',
    params: [
      {
        key: 'radius',
        label: 'Radius',
        type: 'number',
        default: 8,
        min: 0,
        max: 200,
        step: 1,
        animatable: true,
      },
    ],
  },
  {
    type: 'motion-blur',
    name: 'Motion Blur',
    category: 'blur-sharpen',
    requiresNetwork: false,
    cost: 'high',
    params: [
      { key: 'angle', label: 'Angle', type: 'angle', default: 0, min: -180, max: 180, animatable: true },
      { key: 'distance', label: 'Distance', type: 'number', default: 12, min: 0, max: 200, animatable: true },
    ],
  },
  {
    type: 'sharpen',
    name: 'Sharpen',
    category: 'blur-sharpen',
    requiresNetwork: false,
    cost: 'low',
    params: [pct('amount', 'Amount', 0.3)],
  },
  {
    type: 'glitch',
    name: 'Glitch',
    category: 'retro',
    requiresNetwork: false,
    cost: 'medium',
    params: [
      pct('intensity', 'Intensity', 0.4),
      pct('blockiness', 'Blockiness', 0.3),
      {
        key: 'seed',
        label: 'Seed',
        type: 'number',
        default: 0,
        min: 0,
        max: 999,
        step: 1,
        animatable: false,
      },
    ],
  },
  {
    type: 'chromatic-aberration',
    name: 'Chromatic Aberration',
    category: 'retro',
    requiresNetwork: false,
    cost: 'low',
    params: [pct('amount', 'Amount', 0.2)],
  },
  {
    type: 'film-grain',
    name: 'Film Grain',
    category: 'retro',
    requiresNetwork: false,
    cost: 'low',
    params: [pct('amount', 'Amount', 0.25), pct('size', 'Size', 0.5)],
  },
  {
    type: 'light-leak',
    name: 'Light Leak',
    category: 'light',
    requiresNetwork: false,
    cost: 'low',
    params: [
      pct('intensity', 'Intensity', 0.5),
      { key: 'angle', label: 'Angle', type: 'angle', default: 45, min: -180, max: 180, animatable: true },
      { key: 'color', label: 'Color', type: 'color', default: '#ffb570', animatable: false },
    ],
  },
  {
    type: 'bloom',
    name: 'Bloom',
    category: 'light',
    requiresNetwork: false,
    cost: 'medium',
    params: [pct('threshold', 'Threshold', 0.7), pct('intensity', 'Intensity', 0.4)],
  },
  {
    type: 'vhs',
    name: 'VHS',
    category: 'retro',
    requiresNetwork: false,
    cost: 'medium',
    params: [pct('intensity', 'Intensity', 0.5), pct('wobble', 'Wobble', 0.3)],
  },
  {
    type: 'pixelate',
    name: 'Pixelate',
    category: 'stylize',
    requiresNetwork: false,
    cost: 'low',
    params: [
      { key: 'size', label: 'Cell Size', type: 'number', default: 12, min: 2, max: 200, animatable: true },
    ],
  },
  {
    type: 'mirror',
    name: 'Mirror',
    category: 'distort',
    requiresNetwork: false,
    cost: 'low',
    params: [
      {
        key: 'axis',
        label: 'Axis',
        type: 'enum',
        default: 'vertical',
        animatable: false,
        options: [
          { value: 'vertical', label: 'Vertical' },
          { value: 'horizontal', label: 'Horizontal' },
          { value: 'quad', label: 'Four-way' },
        ],
      },
    ],
  },
  {
    type: 'shake',
    name: 'Camera Shake',
    category: 'distort',
    requiresNetwork: false,
    cost: 'low',
    params: [pct('intensity', 'Intensity', 0.3), pct('frequency', 'Frequency', 0.5)],
  },
  {
    type: 'background-removal',
    name: 'Remove Background',
    category: 'ai',
    requiresNetwork: false,
    cost: 'high',
    params: [
      pct('feather', 'Edge Feather', 0.2),
      {
        key: 'quality',
        label: 'Quality',
        type: 'enum',
        default: 'balanced',
        animatable: false,
        options: [
          { value: 'fast', label: 'Fast' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'precise', label: 'Precise' },
        ],
        hint: 'Runs on-device. Precise costs roughly 2× the battery of Fast.',
      },
    ],
  },
  {
    type: 'object-removal',
    name: 'Remove Object',
    category: 'ai',
    requiresNetwork: true,
    cost: 'high',
    params: [
      { key: 'maskId', label: 'Region', type: 'enum', default: '', animatable: false },
      pct('propagation', 'Track Strength', 0.7),
    ],
  },
  {
    type: 'super-resolution',
    name: 'Upscale',
    category: 'ai',
    requiresNetwork: true,
    cost: 'high',
    params: [
      {
        key: 'factor',
        label: 'Factor',
        type: 'enum',
        default: '2',
        animatable: false,
        options: [
          { value: '2', label: '2×' },
          { value: '4', label: '4×' },
        ],
      },
    ],
  },
  {
    type: 'style-transfer',
    name: 'Style Transfer',
    category: 'ai',
    requiresNetwork: true,
    cost: 'high',
    params: [
      { key: 'styleId', label: 'Style', type: 'enum', default: 'anime', animatable: false },
      pct('strength', 'Strength', 0.8),
    ],
  },
] as const;

const BY_TYPE = new Map(EFFECT_DEFS.map((d) => [d.type, d]));

export const getEffectDef = (type: string): EffectDef | undefined => BY_TYPE.get(type);

export const effectsByCategory = (category: EffectCategory): readonly EffectDef[] =>
  EFFECT_DEFS.filter((d) => d.category === category);

/** Parameter map for a freshly applied effect. */
export function defaultParams(type: string): Record<string, unknown> {
  const def = getEffectDef(type);
  if (!def) return {};
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

/**
 * Drop unknown keys and clamp numerics into range. Runs on load so a project
 * authored by a newer build degrades instead of feeding garbage to a shader.
 */
export function sanitizeParams(
  type: string,
  params: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const def = getEffectDef(type);
  if (!def) return {};
  const out: Record<string, unknown> = {};
  for (const p of def.params) {
    const value = params[p.key];
    if (value === undefined) {
      out[p.key] = p.default;
      continue;
    }
    if ((p.type === 'number' || p.type === 'percent' || p.type === 'angle') && typeof value === 'number') {
      const min = p.min ?? -Infinity;
      const max = p.max ?? Infinity;
      out[p.key] = Math.min(max, Math.max(min, value));
    } else {
      out[p.key] = value;
    }
  }
  return out;
}

/** Effects in a stack that cannot run without a connection. */
export function networkGatedEffects(types: readonly string[]): string[] {
  return types.filter((t) => getEffectDef(t)?.requiresNetwork);
}
