import { SCHEMA_VERSION } from '../model/factory.js';
import { reindex } from '../document/mutate.js';
import { sanitizeParams } from '../effects/registry.js';
import type { EditDocument } from '../model/types.js';

/**
 * Project files.
 *
 * A project is plain JSON. Two rules keep it durable:
 *
 *   1. Derived state is never written. `trackClips` is an index, so it is
 *      rebuilt on load — a file can therefore never contain an index that
 *      disagrees with its clips.
 *   2. Every schema change ships a migration. Loading walks the chain from the
 *      file's version to the current one, so a project made in any released
 *      build opens in any later build.
 *
 * Media is referenced, never embedded. A project file is a few hundred
 * kilobytes regardless of how much footage it uses.
 */

export interface ProjectFile {
  readonly format: 'apexedit-project';
  readonly schemaVersion: number;
  /** Build that wrote the file, for diagnostics on a bad load. */
  readonly writtenBy: string;
  readonly writtenAt: number;
  readonly document: unknown;
}

export interface SerializeOptions {
  readonly writtenBy?: string;
  /** Pretty-print for debugging and for readable diffs in version control. */
  readonly pretty?: boolean;
}

export function serialize(doc: EditDocument, opts: SerializeOptions = {}): string {
  const { trackClips: _index, ...rest } = doc;
  const file: ProjectFile = {
    format: 'apexedit-project',
    schemaVersion: SCHEMA_VERSION,
    writtenBy: opts.writtenBy ?? 'apexedit',
    writtenAt: Date.now(),
    document: { ...rest, schemaVersion: SCHEMA_VERSION },
  };
  return JSON.stringify(file, null, opts.pretty ? 2 : 0);
}

export class ProjectLoadError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ProjectLoadError';
  }
}

export interface LoadResult {
  readonly document: EditDocument;
  /** Non-fatal problems: unknown effects dropped, clips clamped, and so on. */
  readonly warnings: readonly string[];
  readonly migratedFrom: number | null;
}

export function deserialize(text: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ProjectLoadError('The project file is not valid JSON.', error);
  }

  if (!isRecord(parsed) || parsed.format !== 'apexedit-project') {
    throw new ProjectLoadError('This is not an ApexEdit project file.');
  }

  const fileVersion = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0;
  if (fileVersion > SCHEMA_VERSION) {
    throw new ProjectLoadError(
      `This project was made with a newer version of ApexEdit (format ${fileVersion}). Update the app to open it.`,
    );
  }

  const warnings: string[] = [];
  if (!isRecord(parsed.document)) throw new ProjectLoadError('The project file has no document.');
  let raw: Record<string, unknown> = parsed.document;

  for (let v = fileVersion; v < SCHEMA_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) {
      throw new ProjectLoadError(`No migration available from format ${v}.`);
    }
    raw = migrate(raw, warnings);
  }

  const document = reindex(repair(raw as unknown as EditDocument, warnings));
  return {
    document,
    warnings,
    migratedFrom: fileVersion < SCHEMA_VERSION ? fileVersion : null,
  };
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

type Migration = (doc: Record<string, unknown>, warnings: string[]) => Record<string, unknown>;

/**
 * `MIGRATIONS[n]` upgrades a version-`n` document to version `n + 1`.
 *
 * Migrations are append-only and must never be edited once released — a shipped
 * migration is the only description of what an old file means.
 */
const MIGRATIONS: Record<number, Migration> = {
  // 0 → 1: the first public beta stored seconds as floats. Convert to ticks.
  0: (doc, warnings) => {
    const TICKS = 705_600_000;
    const clips = isRecord(doc.clips) ? doc.clips : {};
    const converted: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(clips)) {
      if (!isRecord(value)) continue;
      converted[id] = {
        ...value,
        start: Math.round(num(value.start) * TICKS),
        duration: Math.round(num(value.duration) * TICKS),
        mediaIn: Math.round(num(value.mediaIn) * TICKS),
      };
    }
    warnings.push('Converted legacy second-based timings to frame-accurate ticks.');
    return { ...doc, clips: converted };
  },

  // 1 → 2: clip `volume` (linear 0..2) became an animatable dB envelope.
  1: (doc) => {
    const clips = isRecord(doc.clips) ? doc.clips : {};
    const converted: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(clips)) {
      if (!isRecord(value)) continue;
      const { volume, ...rest } = value;
      const linear = typeof volume === 'number' ? volume : 1;
      converted[id] = {
        ...rest,
        audio: value.audio ?? {
          gainDb: { keyframes: [], base: linear > 0 ? 20 * Math.log10(linear) : -60 },
          pan: { keyframes: [], base: 0 },
          fadeIn: null,
          fadeOut: null,
          muted: linear === 0,
          eq: [],
          noiseReduction: 0,
          pitchSemitones: 0,
          ducking: null,
          reverse: false,
        },
      };
    }
    return { ...doc, clips: converted };
  },

  // 2 → 3: captions moved from a per-clip field to document-level tracks.
  2: (doc, warnings) => {
    if (Array.isArray(doc.captionTracks)) return { ...doc, schemaVersion: 3 };
    const clips = isRecord(doc.clips) ? doc.clips : {};
    const hadInlineCaptions = Object.values(clips).some(
      (c) => isRecord(c) && Array.isArray(c.captions),
    );
    if (hadInlineCaptions) {
      warnings.push('Captions were moved onto their own track.');
    }
    return { ...doc, captionTracks: [], schemaVersion: 3 };
  },
};

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

/**
 * Bring a loaded document back inside its invariants.
 *
 * A project file can be old, hand-edited, or truncated by a crash mid-write.
 * Everything recoverable is recovered with a warning; only a structurally
 * impossible file throws. Losing an effect is annoying, losing the project is
 * not acceptable.
 */
function repair(doc: EditDocument, warnings: string[]): EditDocument {
  if (!doc.project?.settings) {
    throw new ProjectLoadError('The project file is missing its settings.');
  }

  const trackIds = new Set((doc.tracks ?? []).map((t) => t.id));
  const clips: Record<string, EditDocument['clips'][string]> = {};
  let droppedClips = 0;
  let droppedEffects = 0;

  for (const [id, clip] of Object.entries(doc.clips ?? {})) {
    if (!clip || !trackIds.has(clip.trackId)) {
      droppedClips++;
      continue;
    }

    // Negative or zero-length clips cannot be represented on a timeline.
    const start = Math.max(0, Math.round(clip.start));
    const duration = Math.max(1, Math.round(clip.duration));

    const effects = (clip.effects ?? []).filter((e) => {
      const params = sanitizeParams(e.type, e.params ?? {});
      if (Object.keys(params).length === 0 && Object.keys(e.params ?? {}).length > 0) {
        droppedEffects++;
        return false;
      }
      return true;
    });

    clips[id] = {
      ...clip,
      id,
      start,
      duration,
      mediaIn: Math.max(0, Math.round(clip.mediaIn ?? 0)),
      effects,
      masks: clip.masks ?? [],
    };
  }

  if (droppedClips > 0) {
    warnings.push(`${droppedClips} clip(s) referenced a track that no longer exists and were removed.`);
  }
  if (droppedEffects > 0) {
    warnings.push(`${droppedEffects} effect(s) are not supported by this version and were removed.`);
  }

  return {
    ...doc,
    clips,
    tracks: doc.tracks ?? [],
    media: doc.media ?? {},
    markers: doc.markers ?? [],
    captionTracks: doc.captionTracks ?? [],
    schemaVersion: SCHEMA_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Project packages
// ---------------------------------------------------------------------------

export interface PackageManifest {
  readonly format: 'apexedit-package';
  readonly version: 1;
  readonly project: string;
  /** Media id → path inside the package. */
  readonly media: Readonly<Record<string, string>>;
  readonly createdAt: number;
  readonly totalBytes: number;
}

/**
 * Manifest for a self-contained project package — the backup and desktop
 * handoff format. Media keeps its original bytes; only the locators are
 * rewritten to package-relative paths.
 */
export function buildPackageManifest(
  doc: EditDocument,
  mediaSizes: Readonly<Record<string, number>>,
): { manifest: PackageManifest; document: EditDocument } {
  const media: Record<string, string> = {};
  const rewritten: Record<string, EditDocument['media'][string]> = {};
  let totalBytes = 0;

  for (const [id, asset] of Object.entries(doc.media)) {
    const extension = asset.localUri?.split('.').pop() ?? 'bin';
    const path = `media/${id}.${extension}`;
    media[id] = path;
    totalBytes += mediaSizes[id] ?? 0;
    rewritten[id] = { ...asset, localUri: path, proxyUri: null, proxyState: 'none' };
  }

  const document: EditDocument = { ...doc, media: rewritten };
  return {
    manifest: {
      format: 'apexedit-package',
      version: 1,
      project: 'project.apex',
      media,
      createdAt: Date.now(),
      totalBytes,
    },
    document,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
