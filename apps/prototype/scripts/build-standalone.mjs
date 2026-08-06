/**
 * Bundle the built editor into one self-contained HTML file.
 *
 * The app already has no network dependencies — no fonts, no CDN, no backend —
 * so inlining the single JS chunk and stylesheet produces a file that runs from
 * file:// with nothing else beside it. Useful for handing the editor to someone
 * without a toolchain, and as a smoke test that the offline-first claim holds
 * literally rather than approximately.
 *
 * Run after `vite build`:  node scripts/build-standalone.mjs
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const html = await readFile(join(dist, 'index.html'), 'utf8');
const assets = await readdir(join(dist, 'assets'));

const jsFile = assets.find((f) => f.endsWith('.js'));
const cssFile = assets.find((f) => f.endsWith('.css'));
if (!jsFile) throw new Error('No JS bundle in dist/assets — run `vite build` first.');

const js = await readFile(join(dist, 'assets', jsFile), 'utf8');
const css = cssFile ? await readFile(join(dist, 'assets', cssFile), 'utf8') : '';

let out = html
  .replace(
    new RegExp(`\\s*<script[^>]*src="[^"]*${jsFile}"[^>]*>\\s*</script>`),
    '',
  )
  .replace(new RegExp(`\\s*<link[^>]*href="[^"]*${cssFile}"[^>]*>`), '');

if (css) out = out.replace('</head>', `<style>\n${css}\n</style>\n</head>`);

// The bundle contains no import statements, so an inline module executes
// correctly from file:// where an external module script would be blocked.
out = out.replace(
  '</body>',
  `<script type="module">\n${js}\n</script>\n</body>`,
);

// Guard against a chunk being silently left behind by a future config change.
if (/<script[^>]*\ssrc=/.test(out) || /<link[^>]*stylesheet/.test(out)) {
  throw new Error('An external asset reference survived inlining — the file would not work offline.');
}

const target = join(root, 'dist-standalone', 'apexedit.html');
await writeFile(target, out).catch(async (error) => {
  if (error.code !== 'ENOENT') throw error;
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, 'dist-standalone'), { recursive: true });
  await writeFile(target, out);
});

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`Wrote ${target} (${kb} KB, fully self-contained)`);
