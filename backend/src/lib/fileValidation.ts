import { badRequest, tooLarge, unsupportedMedia } from './errors.js';
import { env } from '../config/env.js';

/**
 * Server-side upload validation (PRD §35 step 4, §36, §105).
 *
 * Filename extensions are never trusted on their own: every buffer we can read
 * is checked against its magic bytes. The platform never executes uploaded
 * files. Scripts and extensions are stored and served as opaque bytes.
 */

export type AssetPurpose = 'resource-file' | 'thumbnail' | 'preview' | 'tutorial-media' | 'site-asset';

interface TypeRule {
  extensions: string[];
  mimeTypes: string[];
  maxBytes: number;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'];
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mov'];
const AUDIO_MIMES = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/aac', 'audio/flac'];
const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.aac', '.flac'];

/** Creative-tool payloads the owner distributes. Stored, never executed. */
const RESOURCE_ARCHIVE_MIMES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/gzip',
  'application/x-tar',
  'application/octet-stream',
];

const RESOURCE_EXTS = [
  '.zip', '.7z', '.rar', '.tar', '.gz',
  '.jsx', '.jsxbin', '.ffx', '.aep', '.aet', '.mogrt',
  '.prproj', '.prfpset', '.preset', '.epr', '.lrtemplate', '.xmp',
  '.cube', '.3dl', '.look', '.drx', '.drfx', '.dctl',
  '.zxp', '.aex', '.plugin',
  '.fcpxml', '.motn', '.dfxp',
  '.ttf', '.otf', '.woff', '.woff2',
  '.blend', '.fbx', '.obj', '.glb', '.gltf', '.c4d',
  ...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS,
];

const RULES: Record<AssetPurpose, TypeRule> = {
  'resource-file': {
    extensions: RESOURCE_EXTS,
    mimeTypes: [...RESOURCE_ARCHIVE_MIMES, ...IMAGE_MIMES, ...VIDEO_MIMES, ...AUDIO_MIMES, 'text/plain', 'font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'model/gltf-binary', 'model/gltf+json'],
    maxBytes: Math.min(env.MAX_UPLOAD_BYTES, 5 * GB),
  },
  thumbnail: { extensions: IMAGE_EXTS, mimeTypes: IMAGE_MIMES, maxBytes: 8 * MB },
  preview: {
    extensions: [...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS],
    mimeTypes: [...IMAGE_MIMES, ...VIDEO_MIMES, ...AUDIO_MIMES],
    maxBytes: 512 * MB,
  },
  'tutorial-media': {
    extensions: [...IMAGE_EXTS, ...VIDEO_EXTS],
    mimeTypes: [...IMAGE_MIMES, ...VIDEO_MIMES],
    maxBytes: 2 * GB,
  },
  'site-asset': { extensions: [...IMAGE_EXTS, '.svg'], mimeTypes: [...IMAGE_MIMES, 'image/svg+xml'], maxBytes: 4 * MB },
};

/** Extensions that must never be accepted, whatever the declared MIME type. */
const HARD_DENY = new Set([
  '.exe', '.msi', '.dll', '.bat', '.cmd', '.com', '.scr', '.pif', '.cpl',
  '.sh', '.bash', '.ps1', '.psm1', '.vbs', '.wsf', '.jar', '.app', '.dmg',
  '.pkg', '.deb', '.rpm', '.apk', '.php', '.phtml', '.asp', '.aspx', '.cgi',
  '.html', '.htm', '.svg', '.xhtml',
]);

export function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx).toLowerCase();
}

export interface ValidationInput {
  filename: string;
  contentType: string;
  size: number;
  purpose: AssetPurpose;
}

export function validateUploadRequest(input: ValidationInput): { extension: string } {
  const rule = RULES[input.purpose];
  if (!rule) throw badRequest('Unknown upload purpose.');

  const ext = extensionOf(input.filename);
  if (!ext) throw unsupportedMedia('That file has no extension, so we cannot verify its type.');

  // site-asset intentionally allows SVG (owner-controlled branding), everything
  // else refuses it because SVG can carry script.
  if (HARD_DENY.has(ext) && !(input.purpose === 'site-asset' && ext === '.svg')) {
    throw unsupportedMedia(`${ext} files are not accepted.`);
  }
  if (!rule.extensions.includes(ext)) {
    throw unsupportedMedia(`${ext} files are not accepted for this upload.`);
  }
  const baseType = input.contentType.split(';')[0].trim().toLowerCase();
  if (!rule.mimeTypes.includes(baseType)) {
    throw unsupportedMedia(`Content type "${baseType}" is not accepted for this upload.`);
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    throw badRequest('File size is required and must be greater than zero.');
  }
  if (input.size > rule.maxBytes) {
    throw tooLarge(
      `That file is ${formatBytes(input.size)}. The limit for this upload is ${formatBytes(rule.maxBytes)}.`,
    );
  }
  return { extension: ext };
}

/** Magic-byte signatures, checked against the bytes actually stored. */
const SIGNATURES: Array<{ ext: string[]; offset: number; bytes: number[] }> = [
  { ext: ['.zip', '.zxp', '.ffx', '.mogrt', '.drfx', '.aet'], offset: 0, bytes: [0x50, 0x4b] },
  { ext: ['.7z'], offset: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { ext: ['.rar'], offset: 0, bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] },
  { ext: ['.gz'], offset: 0, bytes: [0x1f, 0x8b] },
  { ext: ['.png'], offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: ['.jpg', '.jpeg'], offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { ext: ['.gif'], offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: ['.mp4', '.mov'], offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
  { ext: ['.webm'], offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { ext: ['.wav'], offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  { ext: ['.flac'], offset: 0, bytes: [0x66, 0x4c, 0x61, 0x43] },
  { ext: ['.ogg'], offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53] },
  { ext: ['.ttf'], offset: 0, bytes: [0x00, 0x01, 0x00, 0x00] },
  { ext: ['.otf'], offset: 0, bytes: [0x4f, 0x54, 0x54, 0x4f] },
  { ext: ['.woff'], offset: 0, bytes: [0x77, 0x4f, 0x46, 0x46] },
  { ext: ['.woff2'], offset: 0, bytes: [0x77, 0x4f, 0x46, 0x32] },
];

/** RIFF containers also cover WebP; JPEG/WebP share no prefix so check both. */
function matchesSignature(buf: Buffer, ext: string): boolean | 'unknown' {
  if (ext === '.webp') {
    return (
      buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  const rules = SIGNATURES.filter((s) => s.ext.includes(ext));
  if (rules.length === 0) return 'unknown';
  return rules.some((rule) => {
    if (buf.length < rule.offset + rule.bytes.length) return false;
    return rule.bytes.every((b, i) => buf[rule.offset + i] === b);
  });
}

/**
 * Verifies stored bytes match the claimed extension. Formats with no reliable
 * signature (plain-text .jsx scripts, .cube LUTs) return `unknown` and are
 * accepted. We still refuse anything whose signature actively contradicts it.
 */
export function verifyFileSignature(head: Buffer, filename: string): void {
  const ext = extensionOf(filename);
  const result = matchesSignature(head, ext);
  if (result === false) {
    throw unsupportedMedia(
      `That file does not look like a valid ${ext} file. It may be corrupted or renamed.`,
    );
  }
  // Reject text-ish uploads that are secretly executables.
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) {
    throw unsupportedMedia('Windows executables are not accepted.');
  }
  if (head.length >= 4 && head[0] === 0x7f && head.subarray(1, 4).toString('ascii') === 'ELF') {
    throw unsupportedMedia('Linux executables are not accepted.');
  }
}

/**
 * Lightweight ZIP central-directory scan for path traversal and absolute paths
 * (PRD §36). Deliberately cheap: it reads entry names, never extracts.
 */
export function inspectZipEntries(buf: Buffer): { entries: string[]; suspicious: string[] } {
  const entries: string[] = [];
  const suspicious: string[] = [];
  const SIG = 0x02014b50; // central directory file header
  for (let i = 0; i + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== SIG) continue;
    const nameLen = buf.readUInt16LE(i + 28);
    const extraLen = buf.readUInt16LE(i + 30);
    const commentLen = buf.readUInt16LE(i + 32);
    const start = i + 46;
    if (start + nameLen > buf.length) break;
    const name = buf.subarray(start, start + nameLen).toString('utf8');
    entries.push(name);
    if (name.includes('../') || name.includes('..\\') || name.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(name)) {
      suspicious.push(name);
    }
    i = start + nameLen + extraLen + commentLen - 1;
  }
  return { entries, suspicious };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function maxBytesFor(purpose: AssetPurpose): number {
  return RULES[purpose].maxBytes;
}

export function allowedExtensionsFor(purpose: AssetPurpose): string[] {
  return RULES[purpose].extensions;
}
