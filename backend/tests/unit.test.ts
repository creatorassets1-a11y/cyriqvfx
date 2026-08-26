import { describe, it, expect } from 'vitest';
import {
  validateUploadRequest,
  verifyFileSignature,
  inspectZipEntries,
  extensionOf,
  formatBytes,
} from '../src/lib/fileValidation.js';
import { slugify, generateDownloadToken, generateToken } from '../src/lib/crypto.js';
import { AppError, notFound, gone, badRequest } from '../src/lib/errors.js';
import { siteSettingsSchema, DEFAULT_SETTINGS } from '../src/modules/settings.js';

/** Unit tests (PRD §91): validation, tokens, and the rules around them. */

describe('upload validation', () => {
  const ok = { filename: 'pack.zip', contentType: 'application/zip', size: 1024, purpose: 'resource-file' as const };

  it('accepts a supported resource archive', () => {
    expect(validateUploadRequest(ok)).toEqual({ extension: '.zip' });
  });

  it('refuses executables whatever content type is claimed', () => {
    for (const filename of ['setup.exe', 'run.bat', 'lib.dll', 'app.sh', 'thing.msi']) {
      expect(() =>
        validateUploadRequest({ ...ok, filename, contentType: 'application/zip' }),
      ).toThrow(/not accepted/);
    }
  });

  it('refuses HTML and SVG as resource files, since both can carry script', () => {
    expect(() => validateUploadRequest({ ...ok, filename: 'page.html' })).toThrow();
    expect(() => validateUploadRequest({ ...ok, filename: 'logo.svg' })).toThrow();
  });

  it('allows SVG only for owner-controlled site branding', () => {
    expect(() =>
      validateUploadRequest({
        filename: 'logo.svg',
        contentType: 'image/svg+xml',
        size: 2048,
        purpose: 'site-asset',
      }),
    ).not.toThrow();
  });

  it('refuses a mismatched content type', () => {
    expect(() => validateUploadRequest({ ...ok, contentType: 'text/html' })).toThrow(/not accepted/);
  });

  it('enforces a per-purpose size limit and names it', () => {
    expect(() =>
      validateUploadRequest({
        filename: 'big.png',
        contentType: 'image/png',
        size: 50 * 1024 * 1024,
        purpose: 'thumbnail',
      }),
    ).toThrow(/limit for this upload is/);
  });

  it('requires a real, positive size', () => {
    expect(() => validateUploadRequest({ ...ok, size: 0 })).toThrow(/greater than zero/);
  });

  it('requires an extension it can verify', () => {
    expect(() => validateUploadRequest({ ...ok, filename: 'noextension' })).toThrow(/no extension/);
  });

  it('accepts the creative-tool formats the library actually distributes', () => {
    const cases: Array<[string, string]> = [
      ['tool.jsx', 'text/plain'],
      ['grade.cube', 'application/octet-stream'],
      ['preset.ffx', 'application/zip'],
      ['title.mogrt', 'application/zip'],
      ['panel.zxp', 'application/zip'],
      ['font.otf', 'font/otf'],
    ];
    for (const [filename, contentType] of cases) {
      expect(() =>
        validateUploadRequest({ filename, contentType, size: 2048, purpose: 'resource-file' }),
      ).not.toThrow();
    }
  });
});

describe('file signature verification', () => {
  it('accepts bytes that match the claimed type', () => {
    expect(() => verifyFileSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'a.zip')).not.toThrow();
    expect(() =>
      verifyFileSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'a.png'),
    ).not.toThrow();
  });

  it('rejects bytes that contradict the extension', () => {
    expect(() => verifyFileSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'a.zip')).toThrow(
      /does not look like a valid \.zip/,
    );
  });

  it('rejects executables outright, whatever they are named', () => {
    expect(() => verifyFileSignature(Buffer.from('MZ\x90\x00'), 'tool.jsx')).toThrow(
      /Windows executables/,
    );
    expect(() => verifyFileSignature(Buffer.from('\x7fELF'), 'grade.cube')).toThrow(
      /Linux executables/,
    );
  });

  it('accepts formats with no reliable signature rather than guessing', () => {
    // A .cube LUT is plain text; refusing it would be wrong.
    expect(() => verifyFileSignature(Buffer.from('TITLE "x"\n'), 'grade.cube')).not.toThrow();
    expect(() => verifyFileSignature(Buffer.from('// script\n'), 'tool.jsx')).not.toThrow();
  });

  it('distinguishes WebP from other RIFF containers', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP'),
    ]);
    expect(() => verifyFileSignature(webp, 'a.webp')).not.toThrow();

    const wavPretendingToBeWebp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE'),
    ]);
    expect(() => verifyFileSignature(wavPretendingToBeWebp, 'a.webp')).toThrow();
  });
});

describe('archive inspection', () => {
  /** Builds a central-directory entry with the given name. */
  function zipWithEntry(name: string): Buffer {
    const nameBuf = Buffer.from(name, 'utf8');
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(nameBuf.length, 28);
    return Buffer.concat([header, nameBuf]);
  }

  it('flags path traversal', () => {
    const { suspicious } = inspectZipEntries(zipWithEntry('../../etc/passwd'));
    expect(suspicious).toContain('../../etc/passwd');
  });

  it('flags absolute paths, POSIX and Windows', () => {
    expect(inspectZipEntries(zipWithEntry('/etc/shadow')).suspicious).toHaveLength(1);
    expect(inspectZipEntries(zipWithEntry('C:\\Windows\\System32\\x')).suspicious).toHaveLength(1);
  });

  it('leaves ordinary entries alone', () => {
    const { entries, suspicious } = inspectZipEntries(zipWithEntry('presets/whip-pan.ffx'));
    expect(entries).toEqual(['presets/whip-pan.ffx']);
    expect(suspicious).toEqual([]);
  });
});

describe('slugs and tokens', () => {
  it('makes URL-safe slugs', () => {
    expect(slugify('Anime Scene Pack Vol. 4')).toBe('anime-scene-pack-vol-4');
    expect(slugify('  Halation / Film LUTs!  ')).toBe('halation-film-luts');
    expect(slugify('---')).toBe('');
  });

  it('caps slug length so a long title cannot break a URL', () => {
    expect(slugify('x'.repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it('generates unguessable, URL-safe download tokens', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateDownloadToken()));
    expect(tokens.size).toBe(500);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates session tokens with real entropy', () => {
    const a = generateToken(32);
    const b = generateToken(32);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });
});

describe('error surface', () => {
  it('marks client errors as safe to show and server errors as not', () => {
    expect(notFound().expose).toBe(true);
    expect(badRequest('bad').expose).toBe(true);
    expect(new AppError(500, 'internal_error', 'db exploded').expose).toBe(false);
  });

  it('uses 410 for something that existed and is now retired', () => {
    expect(gone().status).toBe(410);
  });

  it('carries field details for form errors', () => {
    const err = badRequest('nope', [{ field: 'email', message: 'bad' }]);
    expect(err.details).toEqual([{ field: 'email', message: 'bad' }]);
  });
});

describe('site settings', () => {
  it('accepts the defaults it ships with', () => {
    expect(() => siteSettingsSchema.parse(DEFAULT_SETTINGS)).not.toThrow();
  });

  it('refuses an invalid contact address', () => {
    expect(() =>
      siteSettingsSchema.parse({ ...DEFAULT_SETTINGS, contactEmail: 'not-an-email' }),
    ).toThrow();
  });

  it('allows an empty contact address, meaning "do not show one"', () => {
    expect(() => siteSettingsSchema.parse({ ...DEFAULT_SETTINGS, contactEmail: '' })).not.toThrow();
  });
});

describe('formatting', () => {
  it('formats byte sizes the way a person reads them', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
  });

  it('reads extensions case-insensitively', () => {
    expect(extensionOf('PACK.ZIP')).toBe('.zip');
    expect(extensionOf('archive.tar.gz')).toBe('.gz');
    expect(extensionOf('noext')).toBe('');
  });
});
