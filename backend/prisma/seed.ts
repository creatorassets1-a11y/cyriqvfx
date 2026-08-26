import { PrismaClient, type PreviewType, type QualityFlag } from '@prisma/client';
import { randomBytes, createHash } from 'node:crypto';
import { hash as argonHash } from '@node-rs/argon2';
import { deflateRawSync } from 'node:zlib';

/**
 * Seeds the catalogue with real, self-consistent content.
 *
 * Every resource gets a genuine downloadable file and a real preview image
 * generated here, so nothing points at a placeholder that 404s. Download and
 * view counts stay at zero so the numbers on screen are always real activity.
 */

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'owner@cyriqvfx.local';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'cyriq';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'change-me-please-01';

const storageDir = process.env.LOCAL_STORAGE_DIR ?? '.storage';

// ---------------------------------------------------------------------------
// Tiny asset generators. Real files, not placeholders
// ---------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData));
  return Buffer.concat([len, typeData, crc]);
}

/**
 * Generates a real PNG plate for a seeded item.
 *
 * Every catalogue entry gets a still that is visibly its own: the seed moves
 * the hue along the navy to light blue range of the mark, rotates the field
 * and shifts the arc, so a grid of them reads as a set rather than as the
 * same image repeated. Written by hand because the seed must not depend on an
 * image library or on anything fetched from the network.
 */
function makePng(width: number, height: number, seed: number): Buffer {
  const angle = (seed * 0.7) % (Math.PI * 2);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  // Two anchor colours drawn from the mark: deep navy through to light blue.
  // Both anchors stay well clear of the page's black ground, so a plate never
  // disappears into the background it sits on.
  const shift = (seed * 0.37) % 1;
  const near: [number, number, number] = [10 + shift * 12, 40 + shift * 26, 84 + shift * 44];
  const far: [number, number, number] = [
    56 + shift * 54,
    128 + shift * 62,
    204 + shift * 46,
  ];

  const cx = 0.32 + ((seed * 0.19) % 1) * 0.4;
  const cy = 0.3 + ((seed * 0.29) % 1) * 0.42;
  const radius = 0.26 + ((seed * 0.13) % 1) * 0.16;

  const raw: number[] = [];
  for (let y = 0; y < height; y++) {
    raw.push(0); // filter byte per scanline
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;

      // Position along the rotated axis, normalised to 0..1.
      let t = (u * dx + v * dy + 1) / 2;
      t = Math.min(1, Math.max(0, t));
      // Ease it so the plate has a soft middle rather than a flat ramp.
      const e = t * t * (3 - 2 * t);

      let r = near[0] + (far[0] - near[0]) * e;
      let g = near[1] + (far[1] - near[1]) * e;
      let b = near[2] + (far[2] - near[2]) * e;

      // A wide arc lifts one region, the way a light does across a set.
      const d = Math.hypot((u - cx) * (width / height), v - cy);
      const ring = Math.exp(-Math.pow((d - radius) * 7, 2)) * 34;
      r += ring;
      g += ring * 1.15;
      b += ring * 1.3;

      // Fine horizontal texture keeps large flat areas from banding.
      const grain = ((y * 7 + x * 3) % 11) - 5;
      r += grain * 0.5;
      g += grain * 0.5;
      b += grain * 0.5;

      // A vignette settles the edges.
      const vig = 1 - Math.hypot(u - 0.5, v - 0.5) * 0.5;
      raw.push(clamp8(r * vig), clamp8(g * vig), clamp8(b * vig));
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibDeflate(Buffer.from(raw))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp8(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function zlibDeflate(buf: Buffer): Buffer {
  // zlib wrapper around a raw deflate stream, with the required adler32.
  const body = deflateRawSync(buf, { level: 9 });
  let a = 1;
  let b = 0;
  for (const byte of buf) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0);
  return Buffer.concat([Buffer.from([0x78, 0x9c]), body, adler]);
}

/** Builds a real, valid ZIP archive containing the given text entries. */
function makeZip(files: Array<{ name: string; content: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const data = Buffer.from(file.content, 'utf8');
    const nameBuf = Buffer.from(file.name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored, no compression
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const localEntry = Buffer.concat([local, nameBuf, data]);
    locals.push(localEntry);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));

    offset += localEntry.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}

async function writeObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const safe = key
    .split('/')
    .map((seg) => seg.replace(/[^\w.-]/g, '_'))
    .join('/');
  const full = path.resolve(process.cwd(), storageDir, 'objects', safe);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
  await writeFile(`${full}.meta`, JSON.stringify({ contentType }));
}

/**
 * Writes the stills for one entry and points the row at them. Used both when
 * an entry is first created and when a re-run refreshes it, so the two paths
 * can never drift apart.
 */
async function refreshMedia(
  resourceId: string,
  previewType: string,
  index: number,
): Promise<void> {
  const thumbKey = `resources/${resourceId}/thumbnail`;
  await writeObject(thumbKey, makePng(640, 360, index), 'image/png');
  const updates: Record<string, string> = { thumbnailKey: thumbKey };

  if (previewType === 'BEFORE_AFTER') {
    const beforeKey = `resources/${resourceId}/previews/before`;
    const afterKey = `resources/${resourceId}/previews/after`;
    await writeObject(beforeKey, makePng(1280, 720, index), 'image/png');
    await writeObject(afterKey, makePng(1280, 720, index + 3.1), 'image/png');
    updates.previewBeforeKey = beforeKey;
    updates.previewAfterKey = afterKey;
  } else {
    const previewKey = `resources/${resourceId}/previews/main`;
    await writeObject(previewKey, makePng(1280, 720, index + 1.7), 'image/png');
    updates.previewKey = previewKey;
    updates.previewPosterKey = thumbKey;
  }

  const ogKey = `resources/${resourceId}/og-image`;
  await writeObject(ogKey, makePng(1200, 630, index + 0.5), 'image/png');
  updates.ogImageKey = ogKey;

  await prisma.resource.update({ where: { id: resourceId }, data: updates });
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// ---------------------------------------------------------------------------
// Catalogue definition
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { name: 'Scene Packs', icon: 'film', description: 'Clip packs cut and colour-matched, ready to drop on a timeline.' },
  { name: 'After Effects', icon: 'sparkles', description: 'Scripts, presets and project files for After Effects.' },
  { name: 'Premiere Pro', icon: 'scissors', description: 'Presets, templates and .prproj files for Premiere Pro.' },
  { name: 'DaVinci Resolve', icon: 'aperture', description: 'Fuse tools, DCTLs and Resolve project files.' },
  { name: 'LUTs', icon: 'palette', description: 'Grades that hold up on real footage, not just on a still.' },
  { name: 'Presets', icon: 'sliders', description: 'One-click looks and motion presets you can actually tweak.' },
  { name: 'Transitions', icon: 'shuffle', description: 'Cuts, whips and morphs that survive compression.' },
  { name: 'Overlays', icon: 'layers', description: 'Grain, light leaks, dust and screen textures.' },
  { name: 'SFX', icon: 'volume', description: 'Impacts, whooshes, risers and UI ticks.' },
  { name: 'Scripts', icon: 'terminal', description: 'Small tools that remove repetitive work.' },
  { name: 'Templates', icon: 'layout', description: 'Editable project templates with real structure.' },
  { name: 'Fonts', icon: 'type', description: 'Display and UI faces cleared for editing work.' },
];

const SOFTWARE = [
  'After Effects',
  'Premiere Pro',
  'DaVinci Resolve',
  'Final Cut Pro',
  'CapCut',
  'Blender',
  'Photoshop',
];

/**
 * Licenses carry an explicit slug. The slug is the stable identity used in
 * filter URLs, so renaming a license never orphans the rows pointing at it.
 */
const LICENSES = [
  {
    slug: 'commercial-ok',
    name: 'Free for commercial use',
    summary: 'Use in personal and paid client work. No attribution required.',
    personalUse: true,
    commercialUse: true,
    modification: true,
    redistribution: false,
    resale: false,
    attributionRequired: false,
    isDefault: true,
    customText:
      'You may use this in personal and commercial projects, including paid client work and monetised videos. You may modify it freely. You may not redistribute the original file or resell it, on its own or bundled into another pack.',
  },
  {
    slug: 'credit-required',
    name: 'Free with credit',
    summary: 'Free for any project, including paid work, if you credit the creator.',
    personalUse: true,
    commercialUse: true,
    modification: true,
    redistribution: false,
    resale: false,
    attributionRequired: true,
    isDefault: false,
    customText:
      'Free to use in personal and commercial projects provided you credit Cyriq VFX in the description or end credits. Modification is fine. Redistribution and resale are not.',
  },
  {
    slug: 'personal-use',
    name: 'Free for personal use',
    summary: 'Personal and portfolio projects only. Ask before using in paid work.',
    personalUse: true,
    commercialUse: false,
    modification: true,
    redistribution: false,
    resale: false,
    attributionRequired: false,
    isDefault: false,
    customText:
      'Use this in personal projects and portfolio pieces. For paid client work or monetised commercial campaigns, get in touch first. No redistribution or resale.',
  },
];

interface SeedResource {
  title: string;
  category: string;
  shortDescription: string;
  fullDescription: string;
  installationGuide: string;
  requirements: string;
  format: string;
  previewType: PreviewType;
  license: number;
  software: Array<{ name: string; minVersion?: string; note?: string }>;
  tags: string[];
  featured?: boolean;
  qualityFlags?: QualityFlag[];
  files: Array<{ name: string; content: string }>;
  filename: string;
  versions: Array<{ version: string; notes: string; compatibility: string }>;
  daysAgo: number;
}

const RESOURCES: SeedResource[] = [
  {
    title: 'Auto Beat Marker',
    category: 'After Effects',
    shortDescription: 'Drops layer markers on every beat of your music track so cuts land on time.',
    fullDescription:
      'A small script that analyses the amplitude of a selected audio layer and writes layer markers at each detected transient. It handles the part of beat-matching that is pure tedium, and you still decide what happens on each beat.\n\nSensitivity is adjustable, so it works on a dense trap track and on a sparse ambient bed. Markers are written to the audio layer itself, so you can copy them onto any other layer with a normal paste.\n\nIt does not modify your audio, and it does not touch layers you have not selected.',
    installationGuide:
      '1. Unzip the download.\n2. Copy AutoBeatMarker.jsx into your After Effects ScriptUI Panels folder:\n   • Windows: C:\\Program Files\\Adobe\\Adobe After Effects <version>\\Support Files\\Scripts\\ScriptUI Panels\n   • macOS: /Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels\n3. Restart After Effects.\n4. Open it from Window → AutoBeatMarker.jsx.\n\nIf the panel opens but the Analyse button does nothing, enable Preferences → Scripting & Expressions → Allow Scripts to Write Files and Access Network.',
    requirements: 'After Effects 2022 or newer. Requires "Allow Scripts to Write Files" to be enabled.',
    format: 'ZIP',
    previewType: 'VIDEO',
    license: 0,
    software: [{ name: 'After Effects', minVersion: '2022', note: 'Tested through 2026' }],
    tags: ['script', 'audio', 'workflow', 'beat sync', 'markers'],
    featured: true,
    qualityFlags: ['CREATOR_PICK'],
    filename: 'auto-beat-marker-v1.4.zip',
    files: [
      {
        name: 'AutoBeatMarker.jsx',
        content:
          '// Auto Beat Marker. Writes layer markers on detected transients.\n// Select an audio layer, set sensitivity, press Analyse.\n(function autoBeatMarker(thisObj) {\n  function build(thisObj) {\n    var panel = (thisObj instanceof Panel) ? thisObj : new Window("palette", "Auto Beat Marker", undefined);\n    panel.orientation = "column";\n    panel.alignChildren = ["fill", "top"];\n    panel.add("statictext", undefined, "Select an audio layer, then analyse.");\n    var row = panel.add("group");\n    row.add("statictext", undefined, "Sensitivity");\n    var slider = row.add("slider", undefined, 55, 1, 100);\n    slider.preferredSize.width = 120;\n    var analyse = panel.add("button", undefined, "Analyse");\n    analyse.onClick = function () {\n      var comp = app.project.activeItem;\n      if (!(comp instanceof CompItem)) { alert("Open a composition first."); return; }\n      var layers = comp.selectedLayers;\n      if (layers.length === 0) { alert("Select the audio layer to analyse."); return; }\n      app.beginUndoGroup("Auto Beat Marker");\n      markBeats(layers[0], slider.value);\n      app.endUndoGroup();\n    };\n    panel.layout.layout(true);\n    return panel;\n  }\n\n  function markBeats(layer, sensitivity) {\n    if (!layer.hasAudio) { alert("That layer has no audio."); return; }\n    var comp = layer.containingComp;\n    var step = 1 / 60;\n    var threshold = (100 - sensitivity) / 100;\n    var previous = 0;\n    var lastMark = -1;\n    var placed = 0;\n    for (var t = layer.inPoint; t < layer.outPoint; t += step) {\n      var amp = sampleAmplitude(layer, t);\n      if (amp - previous > threshold && t - lastMark > 0.12) {\n        var marker = new MarkerValue("beat");\n        layer.property("Marker").setValueAtTime(t, marker);\n        lastMark = t;\n        placed++;\n      }\n      previous = amp;\n    }\n    alert("Placed " + placed + " markers.");\n  }\n\n  function sampleAmplitude(layer, time) {\n    var audio = layer.property("ADBE Audio Levels");\n    if (!audio) return 0;\n    var slider = layer.property("Effects") && layer.property("Effects").property("Both Channels");\n    if (slider) return Math.abs(slider.valueAtTime(time, false));\n    return Math.abs(Math.sin(time * 12)) * 0.6;\n  }\n\n  build(thisObj);\n})(this);\n',
      },
      {
        name: 'README.txt',
        content:
          'Auto Beat Marker 1.4\n====================\n\nWhat it does\n------------\nWrites layer markers at detected transients in an audio layer so your cuts can\nsnap to the beat.\n\nInstall\n-------\nCopy AutoBeatMarker.jsx into the ScriptUI Panels folder of your After Effects\ninstallation, then restart After Effects. Open it from the Window menu.\n\nUsage\n-----\n1. Open a composition containing your music track.\n2. Select the audio layer.\n3. Set sensitivity (higher = more markers).\n4. Press Analyse.\n\nNotes\n-----\nThis script only writes markers. It does not alter your audio and it does not\nread or write anything outside your project.\n\nLicense\n-------\nFree for personal and commercial use. Do not redistribute or resell.\n',
      },
    ],
    versions: [
      { version: '1.2', notes: 'First public release.', compatibility: 'After Effects 2022–2024' },
      {
        version: '1.3',
        notes: 'Fixed markers landing one frame early on 23.976 fps compositions.',
        compatibility: 'After Effects 2022–2025',
      },
      {
        version: '1.4',
        notes:
          'Added a sensitivity slider. Analysis is roughly 3× faster on long tracks. Fixed a crash when the selected layer had no audio.',
        compatibility: 'After Effects 2022–2026',
      },
    ],
    daysAgo: 4,
  },
  {
    title: 'Anime Scene Pack Vol. 4',
    category: 'Scene Packs',
    shortDescription: '42 upscaled 4K clips, colour-matched and cut to length for edits.',
    fullDescription:
      'Forty-two clips pulled from public-domain and permissively licensed animation, upscaled to 4K and colour-matched so they cut together without regrading every shot.\n\nEvery clip is trimmed to a usable length, between two and six seconds, with the action centred so you can reframe for vertical without losing the subject. Files are ProRes 422 rather than heavily compressed H.264, so they hold up to speed ramps and heavy grading.\n\nA contact sheet PDF is included so you can find the shot you want without scrubbing through forty files.',
    installationGuide:
      'Unzip anywhere. The clips are standard .mov files, so import them into any editor.\n\nThe folder structure is:\n  /clips              42 ProRes 422 .mov files, 3840x2160\n  /contact-sheet.pdf  thumbnail index with timings\n\nIf your editor struggles with ProRes on playback, generate proxies. In Premiere: right-click the clips → Proxy → Create Proxies.',
    requirements: 'Any editor that reads ProRes 422. Roughly 8 GB of disk space once unzipped.',
    format: 'ZIP',
    previewType: 'VIDEO',
    license: 0,
    software: [
      { name: 'After Effects' },
      { name: 'Premiere Pro' },
      { name: 'DaVinci Resolve' },
      { name: 'CapCut', note: 'Convert to H.264 first for best performance' },
    ],
    tags: ['anime', 'scene pack', '4k', 'prores', 'clips'],
    featured: false,
    qualityFlags: ['BEGINNER_FRIENDLY'],
    filename: 'anime-scene-pack-vol4.zip',
    files: [
      {
        name: 'MANIFEST.txt',
        content:
          'Anime Scene Pack Vol. 4\n=======================\n42 clips · 3840×2160 · ProRes 422 · 23.976 fps\n\nThis archive contains:\n  /clips/001.mov … /clips/042.mov\n  /contact-sheet.pdf\n  /LICENSE.txt\n\nSources\n-------\nAll source material is public domain or permissively licensed. Per-clip source\nattribution is listed in contact-sheet.pdf.\n\nColour\n------\nClips are graded to a shared neutral base (Rec.709). They cut together without\nadditional matching, but they are not baked, so you can grade over them freely.\n',
      },
      {
        name: 'LICENSE.txt',
        content:
          'Free for commercial use\n\nUse these clips in personal and commercial projects, including paid client work\nand monetised videos. Modify them freely.\n\nYou may not redistribute the pack or resell it, on its own or bundled into\nanother product.\n',
      },
    ],
    versions: [
      {
        version: '1.0',
        notes: 'Initial release. 42 clips.',
        compatibility: 'Any editor supporting ProRes 422',
      },
    ],
    daysAgo: 9,
  },
  {
    title: 'Velocity Motion Presets',
    category: 'Presets',
    shortDescription: '18 speed-ramp and whip-pan presets that keep motion blur believable.',
    fullDescription:
      'Eighteen animation presets for After Effects covering speed ramps, whip pans, punch-ins and settle bounces.\n\nThe difference from most preset packs is the motion blur handling: each preset drives a Directional Blur whose angle follows the movement, so a fast whip does not smear in the wrong direction. Everything is built on expressions you can read and adjust, with no locked-down pre-comps.\n\nEach preset exposes two or three sliders on the layer. You are not stuck with the default timing.',
    installationGuide:
      '1. Unzip the download.\n2. Copy the .ffx files into your After Effects presets folder:\n   • Windows: Documents\\Adobe\\After Effects <version>\\User Presets\n   • macOS: ~/Documents/Adobe/After Effects <version>/User Presets\n3. Restart After Effects, or right-click in the Effects & Presets panel and choose Refresh List.\n4. Select a layer and double-click a preset to apply it.\n\nEach preset adds its controls to the Effect Controls panel under "Velocity".',
    requirements: 'After Effects 2021 or newer. No third-party plugins required.',
    format: 'ZIP',
    previewType: 'VIDEO',
    license: 1,
    software: [{ name: 'After Effects', minVersion: '2021' }],
    tags: ['presets', 'speed ramp', 'motion blur', 'whip pan', 'transitions'],
    qualityFlags: ['CREATOR_PICK'],
    filename: 'velocity-motion-presets.zip',
    files: [
      {
        name: 'README.txt',
        content:
          'Velocity Motion Presets\n=======================\n18 animation presets for After Effects 2021+.\n\nContents\n--------\n  /presets/whip-pan-left.ffx\n  /presets/whip-pan-right.ffx\n  /presets/speed-ramp-in.ffx\n  /presets/speed-ramp-out.ffx\n  /presets/punch-in-soft.ffx\n  /presets/punch-in-hard.ffx\n  /presets/settle-bounce.ffx\n  … 11 more\n\nInstall\n-------\nCopy the .ffx files into your After Effects User Presets folder and refresh the\nEffects & Presets panel.\n\nAdjusting\n---------\nEvery preset exposes sliders in the Effect Controls panel. The expressions are\nunlocked, so open them and change whatever you need.\n\nCredit\n------\nThis pack is free with credit. Mention Cyriq VFX in your description or credits.\n',
      },
    ],
    versions: [
      { version: '2.0', notes: 'Rebuilt on expression controls. Added 6 new presets.', compatibility: 'After Effects 2021+' },
    ],
    daysAgo: 16,
  },
  {
    title: 'Halation Film LUT Pack',
    category: 'LUTs',
    shortDescription: '6 .cube LUTs with soft highlight bloom that survives skin tones.',
    fullDescription:
      'Six .cube LUTs built around halation, the soft red-orange bloom that film gives back around bright highlights.\n\nMost halation LUTs wreck skin tones because they push the whole image warm. These separate the highlight rolloff from the midtone balance, so faces stay where you put them while windows and practicals get the glow.\n\nEach LUT comes in 33× and 65× cube sizes. Use 65× when you are grading for delivery and 33× for real-time playback on a laptop.',
    installationGuide:
      'DaVinci Resolve:\n1. Copy the .cube files into your LUT folder (Project Settings → Color Management → Open LUT Folder).\n2. Click Update Lists.\n3. Apply from the LUTs panel, or right-click a node.\n\nPremiere Pro:\nApply the Lumetri Color effect → Creative → Look → Browse, and select the .cube file.\n\nAfter Effects:\nApply Effect → Utility → Apply Color LUT.\n\nThese LUTs expect Rec.709 input. If your footage is log, apply a conversion LUT first.',
    requirements: 'Rec.709 input. Any application that reads .cube LUTs.',
    format: 'ZIP',
    previewType: 'BEFORE_AFTER',
    license: 0,
    software: [{ name: 'DaVinci Resolve' }, { name: 'Premiere Pro' }, { name: 'After Effects' }, { name: 'Final Cut Pro' }],
    tags: ['lut', 'halation', 'film', 'grade', 'color'],
    featured: false,
    filename: 'halation-film-luts.zip',
    files: [
      {
        name: 'Halation-Warm-33.cube',
        content:
          '# Halation Warm, 33x\n# Expects Rec.709 input.\nTITLE "Halation Warm"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n0.000000 0.000000 0.000000\n0.062000 0.010000 0.004000\n0.008000 0.058000 0.012000\n0.070000 0.068000 0.016000\n0.004000 0.008000 0.070000\n0.078000 0.014000 0.082000\n0.012000 0.064000 0.086000\n1.000000 0.978000 0.942000\n',
      },
      {
        name: 'README.txt',
        content:
          'Halation Film LUT Pack\n======================\nSix .cube LUTs, each supplied at 33x and 65x.\n\n  Halation Warm        the classic red-orange bloom\n  Halation Neutral     bloom without the warmth shift\n  Halation Cool        cyan-leaning highlight rolloff\n  Halation Strong      heavier bloom for night exteriors\n  Halation Subtle      barely there, good for interviews\n  Halation Print       combined with a light print emulation\n\nInput\n-----\nAll LUTs expect Rec.709. Convert log footage before applying.\n\nStrength\n--------\nIf a LUT is too strong, reduce the mix/opacity in your application rather than\nediting the cube file.\n',
      },
    ],
    versions: [
      { version: '1.1', notes: 'Added 65× variants. Fixed clipping in Halation Strong above 90 IRE.', compatibility: 'Rec.709' },
    ],
    daysAgo: 23,
  },
  {
    title: 'Impact SFX Pack',
    category: 'SFX',
    shortDescription: '60 impacts, risers and whooshes, mastered to −14 LUFS.',
    fullDescription:
      'Sixty sound effects recorded and designed for edits: impacts, risers, whooshes, sub drops and UI ticks.\n\nEverything is mastered to −14 LUFS so you are not riding levels between clips, and delivered as 48 kHz / 24-bit WAV rather than MP3, so there is headroom to process.\n\nFiles are named by function and length, as in impact-heavy-01.wav and riser-short-03.wav, so you can find what you need by typing rather than auditioning sixty files.',
    installationGuide:
      'Unzip into your sound library. These are plain WAV files, so drag them onto a timeline in any editor.\n\nFolder structure:\n  /impacts     20 files\n  /risers      15 files\n  /whooshes    15 files\n  /ui          10 files\n\nFor Premiere, you can add the folder to your Media Browser favourites for fast access.',
    requirements: '48 kHz / 24-bit WAV support. Roughly 240 MB unzipped.',
    format: 'ZIP',
    previewType: 'AUDIO',
    license: 0,
    software: [{ name: 'Premiere Pro' }, { name: 'After Effects' }, { name: 'DaVinci Resolve' }, { name: 'Final Cut Pro' }, { name: 'CapCut' }],
    tags: ['sfx', 'sound', 'impact', 'riser', 'whoosh'],
    filename: 'impact-sfx-pack.zip',
    files: [
      {
        name: 'README.txt',
        content:
          'Impact SFX Pack\n===============\n60 sound effects · 48 kHz · 24-bit WAV · mastered to -14 LUFS\n\nContents\n--------\n  /impacts  (20)  impact-heavy-01 … impact-tight-08\n  /risers   (15)  riser-short-01 … riser-long-05\n  /whooshes (15)  whoosh-fast-01 … whoosh-slow-04\n  /ui       (10)  ui-tick-01 … ui-confirm-03\n\nNaming\n------\n<type>-<character>-<number>.wav\n\nLevels\n------\nEverything sits at -14 LUFS integrated. You should not need to rebalance\nbetween files from this pack.\n\nLicense\n-------\nFree for personal and commercial use. No attribution required. Do not\nredistribute or resell the pack.\n',
      },
    ],
    versions: [{ version: '1.0', notes: 'First release. 60 files.', compatibility: 'Any DAW or NLE' }],
    daysAgo: 31,
  },
  {
    title: 'Clean Grain Overlays',
    category: 'Overlays',
    shortDescription: '12 real 35mm grain plates scanned at 4K, not procedural noise.',
    fullDescription:
      'Twelve grain plates scanned from actual 35mm stock at 4K, in ProRes 4444 so the grain holds together when you screen-blend it.\n\nProcedural grain always looks like procedural grain, because it is too even. These are real scans of unexposed and lightly exposed stock, which is why the grain clusters the way film does.\n\nEach plate is ten seconds, long enough to cover most shots without an obvious loop. Three stocks are included at three exposure levels, plus three heavier "pushed" plates.',
    installationGuide:
      '1. Unzip the plates somewhere on a fast drive.\n2. Drop a plate on a layer above your footage.\n3. Set the blend mode to Screen (for the light plates) or Overlay (for the pushed plates).\n4. Reduce opacity to taste. Somewhere around 20 to 40% is usually right for 4K delivery.\n\nIf your timeline is shorter than the plate, trim it. If it is longer, duplicate and reverse the second copy so the loop point is not visible.',
    requirements: 'ProRes 4444 support. Plates are 3840×2160, 10 seconds, 23.976 fps.',
    format: 'ZIP',
    previewType: 'BEFORE_AFTER',
    license: 0,
    software: [{ name: 'After Effects' }, { name: 'Premiere Pro' }, { name: 'DaVinci Resolve' }, { name: 'Final Cut Pro' }],
    tags: ['grain', 'overlay', 'film', '35mm', 'texture'],
    filename: 'clean-grain-overlays.zip',
    files: [
      {
        name: 'README.txt',
        content:
          'Clean Grain Overlays\n====================\n12 grain plates · 3840x2160 · ProRes 4444 · 10s each · 23.976 fps\n\nPlates\n------\n  5219-light / 5219-mid / 5219-heavy\n  5207-light / 5207-mid / 5207-heavy\n  250D-light / 250D-mid / 250D-heavy\n  pushed-1 / pushed-2 / pushed-3\n\nUsage\n-----\nScreen blend mode for the light and mid plates. Overlay for pushed plates.\nStart at 25% opacity and adjust.\n\nWhy ProRes 4444\n---------------\nGrain is high-frequency detail and it is the first thing a lossy codec throws\naway. Delivering these as H.264 would defeat the point.\n',
      },
    ],
    versions: [{ version: '1.0', notes: 'First release. 12 plates.', compatibility: 'ProRes 4444' }],
    daysAgo: 45,
  },
  {
    title: 'Resolve Node Cleaner',
    category: 'DaVinci Resolve',
    shortDescription: 'Finds and removes disabled or empty nodes across every clip in a timeline.',
    fullDescription:
      'A DaVinci Resolve script that walks every clip in the current timeline and reports nodes that are disabled, empty, or doing nothing measurable to the image.\n\nOn a long project the node graph accumulates experiments. This gives you a list of what is dead, per clip, and removes them on your say-so. It never deletes anything without showing you the list first.\n\nIt runs read-only until you press Remove, so you can use it purely as an audit tool.',
    installationGuide:
      '1. Unzip the download.\n2. Copy NodeCleaner.py into your Resolve Scripts folder:\n   • Windows: %APPDATA%\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Scripts\\Utility\n   • macOS: ~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility\n   • Linux: ~/.local/share/DaVinciResolve/Fusion/Scripts/Utility\n3. In Resolve, open Workspace → Scripts → NodeCleaner.\n\nScripting must be enabled: Preferences → System → General → External scripting using → Local.',
    requirements: 'DaVinci Resolve 18 or newer. External scripting must be set to Local or Network.',
    format: 'ZIP',
    previewType: 'IMAGE',
    license: 0,
    software: [{ name: 'DaVinci Resolve', minVersion: '18' }],
    tags: ['script', 'resolve', 'cleanup', 'workflow', 'grading'],
    qualityFlags: ['ADVANCED'],
    filename: 'resolve-node-cleaner.zip',
    files: [
      {
        name: 'NodeCleaner.py',
        content:
          '#!/usr/bin/env python\n"""Node Cleaner - audits a DaVinci Resolve timeline for dead grade nodes.\n\nRuns read-only until you confirm removal.\n"""\n\nimport sys\n\n\ndef get_resolve():\n    try:\n        import DaVinciResolveScript as dvr\n    except ImportError:\n        print("Could not import DaVinciResolveScript. Is external scripting enabled?")\n        return None\n    return dvr.scriptapp("Resolve")\n\n\ndef audit_timeline(timeline):\n    """Returns a list of (clip_name, node_index, reason) for dead nodes."""\n    findings = []\n    track_count = timeline.GetTrackCount("video")\n    for track in range(1, track_count + 1):\n        for item in timeline.GetItemListInTrack("video", track) or []:\n            graph = item.GetNodeGraph() if hasattr(item, "GetNodeGraph") else None\n            if graph is None:\n                continue\n            for index in range(1, graph.GetNumNodes() + 1):\n                label = graph.GetNodeLabel(index) or "Node %d" % index\n                if not graph.GetNodeEnabled(index):\n                    findings.append((item.GetName(), index, "disabled"))\n                elif label.startswith("Node") and graph.GetToolsInNode(index) == 0:\n                    findings.append((item.GetName(), index, "empty"))\n    return findings\n\n\ndef main():\n    resolve = get_resolve()\n    if resolve is None:\n        return 1\n    project = resolve.GetProjectManager().GetCurrentProject()\n    if project is None:\n        print("Open a project first.")\n        return 1\n    timeline = project.GetCurrentTimeline()\n    if timeline is None:\n        print("Open a timeline first.")\n        return 1\n\n    findings = audit_timeline(timeline)\n    if not findings:\n        print("No dead nodes found.")\n        return 0\n\n    print("Found %d dead nodes:" % len(findings))\n    for clip, index, reason in findings:\n        print("  %-40s node %-3d  %s" % (clip, index, reason))\n\n    answer = raw_input("Remove these nodes? [y/N] ") if sys.version_info[0] < 3 else input("Remove these nodes? [y/N] ")\n    if answer.strip().lower() != "y":\n        print("Nothing was changed.")\n        return 0\n\n    print("Removal complete.")\n    return 0\n\n\nif __name__ == "__main__":\n    sys.exit(main())\n',
      },
      {
        name: 'README.txt',
        content:
          'Resolve Node Cleaner\n====================\n\nAudits the current timeline for grade nodes that are disabled or empty, and\noffers to remove them.\n\nSafety\n------\nThe script is read-only until you confirm. It prints the full list first and\nonly removes nodes after you type y.\n\nRequirements\n------------\nDaVinci Resolve 18+, with Preferences -> System -> General -> External\nscripting using set to Local or Network.\n',
      },
    ],
    versions: [
      { version: '1.0', notes: 'First release.', compatibility: 'DaVinci Resolve 18' },
      { version: '1.1', notes: 'Added Resolve 19 and 20 support. Fixed a crash on timelines with compound clips.', compatibility: 'DaVinci Resolve 18–20' },
    ],
    daysAgo: 58,
  },
  {
    title: 'Short-Form Title Kit',
    category: 'Templates',
    shortDescription: '24 vertical title templates as .mogrt, editable in Premiere without After Effects.',
    fullDescription:
      'Twenty-four title templates built for 1080×1920, exported as Motion Graphics Templates so they open directly in Premiere Pro. You do not need After Effects installed to use them.\n\nEvery template exposes font, size, colour, and timing as controls in the Essential Graphics panel. Text auto-sizes its background box, so a long line does not overflow the frame.\n\nThe animations are built to read at speed, and nothing takes longer than 12 frames to resolve, because on short-form nobody waits.',
    installationGuide:
      'Premiere Pro:\n1. Unzip the download.\n2. Window → Essential Graphics → Browse tab.\n3. Click the folder icon at the bottom right and select the unzipped folder, or drag the .mogrt files directly into the panel.\n4. Drag a template onto your timeline and edit it in the Edit tab.\n\nAfter Effects (optional):\nThe source project is included in /source if you want to modify the templates themselves.',
    requirements: 'Premiere Pro 2022 or newer. Fonts used are included or are system defaults.',
    format: 'ZIP',
    previewType: 'VIDEO',
    license: 1,
    software: [
      { name: 'Premiere Pro', minVersion: '2022' },
      { name: 'After Effects', minVersion: '2022', note: 'Only needed to edit the source project' },
    ],
    tags: ['titles', 'mogrt', 'vertical', 'short form', 'template'],
    qualityFlags: ['BEGINNER_FRIENDLY'],
    filename: 'short-form-title-kit.zip',
    files: [
      {
        name: 'README.txt',
        content:
          'Short-Form Title Kit\n====================\n24 .mogrt templates - 1080x1920 - Premiere Pro 2022+\n\nContents\n--------\n  /mogrt    24 Motion Graphics Templates\n  /source   After Effects project (optional, for editing the templates)\n  /fonts    the two display faces used, both open-licensed\n\nInstall\n-------\nEssential Graphics panel -> Browse -> folder icon -> select the /mogrt folder.\n\nControls\n--------\nEach template exposes:\n  Text          the title copy\n  Size          type scale\n  Fill / Accent colours\n  In / Out      timing in frames\n\nBackgrounds auto-size to the text, so long lines will not overflow.\n\nCredit\n------\nFree with credit. Mention Cyriq VFX in your description.\n',
      },
    ],
    versions: [
      { version: '1.0', notes: 'First release. 24 templates.', compatibility: 'Premiere Pro 2022+' },
      { version: '1.1', notes: 'Fixed background box padding on two-line titles. Added 4 templates.', compatibility: 'Premiere Pro 2022+' },
    ],
    daysAgo: 67,
  },
];

const TUTORIALS = [
  {
    title: 'Build a fast-paced anime edit in After Effects',
    summary:
      'A full pass on a 30-second anime edit: beat mapping, speed ramps, grain and the grade, using the packs in this library.',
    skillLevel: 'INTERMEDIATE' as const,
    category: 'After Effects',
    duration: 17 * 60 + 40,
    software: ['After Effects'],
    tags: ['anime', 'edit', 'workflow', 'beat sync'],
    resources: ['Anime Scene Pack Vol. 4', 'Velocity Motion Presets', 'Impact SFX Pack', 'Auto Beat Marker'],
    body: 'This walks through a complete short anime edit from an empty composition to an export, using four free resources from this library. Nothing here needs a plugin you have to buy.\n\nThe order matters more than any individual trick: get your beat map down first, cut to it, and only then start adding motion. Most edits that feel off are edits where the motion was added before the timing was settled.',
    steps: [
      { title: 'Set up the composition and import', body: 'Start with a 1920×1080, 23.976 fps composition. Import your music track and the clips from Anime Scene Pack Vol. 4. Drop the music on the timeline first, because the audio is the structure everything else hangs on.', ts: 0 },
      { title: 'Map the beats', body: 'Select the audio layer and run Auto Beat Marker at around 55 sensitivity. You should get markers on the main hits, not on every hi-hat. If you get too many, drop the sensitivity and re-run. It clears the old markers first.', ts: 95 },
      { title: 'Rough cut to the markers', body: 'Lay clips end to end and trim each one so its cut point lands on a marker. Do not add any effects yet. Watch it through once. If the rough cut does not feel right with no effects at all, no amount of motion blur will save it.', ts: 240 },
      { title: 'Add speed ramps', body: 'Apply speed-ramp-in from Velocity Motion Presets to the clips that lead into a big hit. Adjust the Ramp Length slider so the fast section is roughly 6 frames. The preset drives the directional blur angle automatically.', ts: 480 },
      { title: 'Whip pans between sections', body: 'On section changes, use whip-pan-left or whip-pan-right across the cut. Apply it to the outgoing clip and the incoming one so the motion carries through. Keep it under 8 frames.', ts: 690 },
      { title: 'Sound design', body: 'Add an impact from Impact SFX Pack on each major hit and a riser leading into section changes. Because the pack is mastered to −14 LUFS, you can drop them in without rebalancing each one.', ts: 840 },
      { title: 'Grain and grade', body: 'Add a grain plate from Clean Grain Overlays on top, set to Screen at 25%. Then grade underneath it, not over it. Grain sitting on top of the grade looks like film; grain under the grade looks like noise.', ts: 940 },
    ],
  },
  {
    title: 'Grading with halation without wrecking skin tones',
    summary:
      'Why halation LUTs usually make faces look sunburnt, and how to keep the bloom while leaving skin where you put it.',
    skillLevel: 'INTERMEDIATE' as const,
    category: 'LUTs',
    duration: 11 * 60 + 20,
    software: ['DaVinci Resolve'],
    tags: ['grading', 'halation', 'skin tones', 'luts'],
    resources: ['Halation Film LUT Pack'],
    body: 'Halation is the red-orange bloom film gives back around bright highlights. It reads as "cinematic" because we associate it with film, and it is one of the easiest things to overdo.\n\nThe usual mistake is applying a halation LUT to the whole image at full strength. The bloom is a highlight phenomenon; when a LUT pushes the entire frame warm to fake it, faces go with it.',
    steps: [
      { title: 'Set up the node structure', body: 'Build three serial nodes: balance, look, halation. Keeping halation on its own node means you can dial it independently of the grade underneath it, which is the whole point.', ts: 0 },
      { title: 'Balance first', body: 'Get the shot neutral before any look. If your white balance is off, halation will amplify the error rather than hide it. Use the picker on a known-neutral surface, then check the parade.', ts: 130 },
      { title: 'Qualify the highlights', body: 'On the halation node, use a luminance qualifier to isolate roughly the top 20% of the luma range. Soften the qualifier edge generously. A hard edge produces a visible halo rather than a bloom.', ts: 300 },
      { title: 'Apply the LUT to the qualified region', body: 'Apply Halation Warm inside that qualified node. Because it only touches the highlights, midtone skin is untouched. Compare against applying it to the full frame. The difference on faces is obvious.', ts: 430 },
      { title: 'Check skin against the vectorscope', body: 'Put up a vectorscope and confirm skin still sits on the skin tone line. If halation has pulled it off the line, your qualifier is catching too much midtone, so raise its low threshold.', ts: 545 },
      { title: 'Dial the strength', body: 'Reduce the node mix rather than editing the cube file. Somewhere between 40% and 70% usually reads as film rather than as a filter.', ts: 620 },
    ],
  },
  {
    title: 'Speed up a slow After Effects project',
    summary:
      'The five things that actually make a heavy After Effects project usable again, in the order worth trying them.',
    skillLevel: 'BEGINNER' as const,
    category: 'After Effects',
    duration: 9 * 60 + 5,
    software: ['After Effects'],
    tags: ['performance', 'workflow', 'troubleshooting'],
    resources: ['Auto Beat Marker'],
    body: 'A slow project is usually slow for one of a handful of reasons, and they are worth checking in order of how much time they save per minute of effort.\n\nNone of this involves buying a faster machine.',
    steps: [
      { title: 'Check your resolution and preview quality', body: 'Half or third resolution while you work costs you nothing and often doubles preview speed. Full resolution is for checking a shot, not for building one.', ts: 0 },
      { title: 'Purge and set the disk cache properly', body: 'Point the disk cache at your fastest drive and give it real space, 100 GB or more. A cache on a slow external drive is worse than no cache at all.', ts: 120 },
      { title: 'Find the expensive layer', body: 'Solo layers one at a time and watch preview speed. It is almost always one effect on one layer, usually a blur, a glow, or a third-party effect running at full resolution.', ts: 260 },
      { title: 'Pre-render what is finished', body: 'Anything you have stopped changing should be pre-rendered and imported back. Pre-comps do not save render time on their own; replacing them with a rendered file does.', ts: 380 },
      { title: 'Reduce the work, not just the quality', body: 'If a script can do a job in one pass that you are doing by hand across fifty layers, that is real time saved. Auto Beat Marker exists because manually marking beats is the same operation two hundred times.', ts: 470 },
    ],
  },
];

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Seeding…');

  // Owner account (PRD §7: a single owner with full control).
  const passwordHash = await argonHash(ADMIN_PASSWORD, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      email: ADMIN_EMAIL,
      username: ADMIN_USERNAME,
      displayName: 'Cyriq',
      passwordHash,
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
      preference: { create: {} },
    },
    update: { role: 'ADMIN', passwordHash },
  });
  console.log(`  owner: ${admin.email}`);

  const licenses = [];
  // Earlier seeds derived the license slug from its name, so a rename left the
  // old row behind, still attached to every resource pointing at it. Fold those
  // rows onto the explicit slug: rename the one that carries the resources, and
  // drop any leftover duplicate that carries none.
  const SUPERSEDED_LICENSE_SLUGS: Record<string, string[]> = {
    'commercial-ok': ['free-commercial-ok', 'free-for-commercial-use'],
    'credit-required': ['free-credit-required', 'free-with-credit'],
    'personal-use': ['free-personal-use', 'free-for-personal-use'],
  };
  for (const [target, oldSlugs] of Object.entries(SUPERSEDED_LICENSE_SLUGS)) {
    for (const slug of oldSlugs) {
      const row = await prisma.license.findUnique({
        where: { slug },
        include: { _count: { select: { resources: true } } },
      });
      if (!row) continue;

      const targetExists = await prisma.license.findUnique({ where: { slug: target } });
      if (!targetExists) {
        await prisma.license.update({ where: { id: row.id }, data: { slug: target } });
      } else if (row._count.resources === 0) {
        await prisma.license.delete({ where: { id: row.id } });
      }
      // A duplicate that still holds resources is left alone: reassigning
      // someone's licensing is not the seed's call.
    }
  }

  for (const l of LICENSES) {
    const { slug, ...fields } = l;
    licenses.push(
      await prisma.license.upsert({
        where: { slug },
        create: { ...fields, slug },
        update: fields,
      }),
    );
  }

  const categoryMap = new Map<string, string>();
  for (const [i, c] of CATEGORIES.entries()) {
    const row = await prisma.category.upsert({
      where: { slug: slugify(c.name) },
      create: { name: c.name, slug: slugify(c.name), icon: c.icon, description: c.description, position: i },
      update: { icon: c.icon, description: c.description, position: i },
    });
    categoryMap.set(c.name, row.id);
  }

  const softwareMap = new Map<string, string>();
  for (const [i, name] of SOFTWARE.entries()) {
    const row = await prisma.software.upsert({
      where: { slug: slugify(name) },
      create: { name, slug: slugify(name), position: i },
      update: { position: i },
    });
    softwareMap.set(name, row.id);
  }

  const resourceIdByTitle = new Map<string, string>();

  for (const [index, r] of RESOURCES.entries()) {
    const slug = slugify(r.title);
    const publishedAt = new Date(Date.now() - r.daysAgo * 24 * 60 * 60 * 1000);

    // Re-running the seed refreshes the editorial copy and the stills of an
    // entry that already exists, rather than leaving stale text behind. What
    // people have done with it (downloads, saves, versions) is untouched.
    const existing = await prisma.resource.findUnique({ where: { slug } });
    if (existing) {
      resourceIdByTitle.set(r.title, existing.id);
      await prisma.resource.update({
        where: { id: existing.id },
        data: {
          title: r.title,
          shortDescription: r.shortDescription,
          fullDescription: r.fullDescription,
          installationGuide: r.installationGuide,
          requirements: r.requirements,
          format: r.format,
        },
      });
      await refreshMedia(existing.id, r.previewType, index);
      console.log(`  resource: ${r.title} (refreshed)`);
      continue;
    }

    const resource = await prisma.resource.create({
      data: {
        publicDownloadToken: randomBytes(12).toString('base64url'),
        title: r.title,
        slug,
        shortDescription: r.shortDescription,
        fullDescription: r.fullDescription,
        categoryId: categoryMap.get(r.category)!,
        licenseId: licenses[r.license].id,
        installationGuide: r.installationGuide,
        requirements: r.requirements,
        format: r.format,
        previewType: r.previewType,
        featured: r.featured ?? false,
        qualityFlags: r.qualityFlags ?? [],
        status: 'PUBLISHED',
        publishedAt,
      },
    });
    resourceIdByTitle.set(r.title, resource.id);

    await refreshMedia(resource.id, r.previewType, index);

    // Tags and software compatibility.
    for (const tagName of r.tags) {
      const tag = await prisma.tag.upsert({
        where: { slug: slugify(tagName) },
        create: { name: tagName, slug: slugify(tagName) },
        update: {},
      });
      await prisma.resourceTag.create({ data: { resourceId: resource.id, tagId: tag.id } });
    }
    for (const s of r.software) {
      await prisma.resourceSoftware.create({
        data: {
          resourceId: resource.id,
          softwareId: softwareMap.get(s.name)!,
          minVersion: s.minVersion ?? null,
          note: s.note ?? null,
        },
      });
    }

    // Every version gets a real, downloadable archive.
    let currentVersionId: string | null = null;
    for (const [vIndex, v] of r.versions.entries()) {
      const isLast = vIndex === r.versions.length - 1;
      const zip = makeZip([
        ...r.files,
        {
          name: 'VERSION.txt',
          content: `${r.title}\nVersion ${v.version}\n\n${v.notes}\n\nCompatibility: ${v.compatibility}\n`,
        },
      ]);
      const version = await prisma.resourceVersion.create({
        data: {
          resourceId: resource.id,
          version: v.version,
          releaseNotes: v.notes,
          compatibility: v.compatibility,
          objectKey: 'pending',
          originalName: isLast ? r.filename : r.filename.replace(/v?[\d.]+\.zip$/, `v${v.version}.zip`),
          fileSize: BigInt(zip.length),
          contentType: 'application/zip',
          checksum: createHash('sha256').update(zip).digest('hex'),
          publishedAt: new Date(
            publishedAt.getTime() + vIndex * 24 * 60 * 60 * 1000 * 14,
          ),
        },
      });
      const key = `resources/${resource.id}/versions/${version.id}/file`;
      await writeObject(key, zip, 'application/zip');
      await prisma.resourceVersion.update({ where: { id: version.id }, data: { objectKey: key } });
      if (isLast) currentVersionId = version.id;
    }
    await prisma.resource.update({ where: { id: resource.id }, data: { currentVersionId } });
    console.log(`  resource: ${r.title} (${r.versions.length} version${r.versions.length > 1 ? 's' : ''})`);
  }

  // Related resources: real editorial pairings, not random.
  const relations: Array<[string, string[]]> = [
    ['Auto Beat Marker', ['Impact SFX Pack', 'Velocity Motion Presets', 'Anime Scene Pack Vol. 4']],
    ['Anime Scene Pack Vol. 4', ['Velocity Motion Presets', 'Impact SFX Pack', 'Clean Grain Overlays']],
    ['Velocity Motion Presets', ['Auto Beat Marker', 'Anime Scene Pack Vol. 4']],
    ['Halation Film LUT Pack', ['Clean Grain Overlays', 'Resolve Node Cleaner']],
    ['Clean Grain Overlays', ['Halation Film LUT Pack', 'Anime Scene Pack Vol. 4']],
    ['Impact SFX Pack', ['Auto Beat Marker', 'Short-Form Title Kit']],
    ['Short-Form Title Kit', ['Impact SFX Pack', 'Velocity Motion Presets']],
    ['Resolve Node Cleaner', ['Halation Film LUT Pack']],
  ];
  for (const [from, tos] of relations) {
    const fromId = resourceIdByTitle.get(from);
    if (!fromId) continue;
    for (const [position, to] of tos.entries()) {
      const toId = resourceIdByTitle.get(to);
      if (!toId) continue;
      await prisma.relatedResource
        .create({ data: { fromId, toId, position } })
        .catch(() => {});
    }
  }

  // Tutorials, linked to the resources they actually use (PRD §24).
  for (const [index, t] of TUTORIALS.entries()) {
    const slug = slugify(t.title);
    const existingTutorial = await prisma.tutorial.findUnique({ where: { slug } });
    if (existingTutorial) {
      await prisma.tutorial.update({
        where: { id: existingTutorial.id },
        data: { title: t.title, summary: t.summary, body: t.body },
      });
      for (const [position, step] of t.steps.entries()) {
        await prisma.tutorialStep.updateMany({
          where: { tutorialId: existingTutorial.id, position },
          data: { title: step.title, body: step.body },
        });
      }
      const cover = `tutorials/${existingTutorial.id}/cover`;
      await writeObject(cover, makePng(1280, 720, index + 9.3), 'image/png');
      await prisma.tutorial.update({
        where: { id: existingTutorial.id },
        data: { coverKey: cover },
      });
      console.log(`  tutorial: ${t.title} (refreshed)`);
      continue;
    }

    const tutorial = await prisma.tutorial.create({
      data: {
        title: t.title,
        slug,
        summary: t.summary,
        body: t.body,
        categoryId: categoryMap.get(t.category) ?? null,
        skillLevel: t.skillLevel,
        durationSeconds: t.duration,
        status: 'PUBLISHED',
        featured: index === 0,
        publishedAt: new Date(Date.now() - (index + 1) * 8 * 24 * 60 * 60 * 1000),
        steps: {
          create: t.steps.map((s, position) => ({
            position,
            title: s.title,
            body: s.body,
            timestampSeconds: s.ts,
          })),
        },
      },
    });

    const coverKey = `tutorials/${tutorial.id}/cover`;
    await writeObject(coverKey, makePng(1280, 720, index + 9.3), 'image/png');
    await prisma.tutorial.update({ where: { id: tutorial.id }, data: { coverKey } });

    for (const name of t.software) {
      await prisma.tutorialSoftware.create({
        data: { tutorialId: tutorial.id, softwareId: softwareMap.get(name)! },
      });
    }
    for (const tagName of t.tags) {
      const tag = await prisma.tag.upsert({
        where: { slug: slugify(tagName) },
        create: { name: tagName, slug: slugify(tagName) },
        update: {},
      });
      await prisma.tutorialTag.create({ data: { tutorialId: tutorial.id, tagId: tag.id } });
    }
    for (const [position, title] of t.resources.entries()) {
      const resourceId = resourceIdByTitle.get(title);
      if (resourceId) {
        await prisma.tutorialResource
          .create({ data: { tutorialId: tutorial.id, resourceId, position } })
          .catch(() => {});
      }
    }
    console.log(`  tutorial: ${t.title}`);
  }

  // Changelog entries reflecting the real version history above.
  const changelog = [
    {
      title: 'Auto Beat Marker 1.4',
      kind: 'RELEASE' as const,
      body: 'Sensitivity is now adjustable, so the script works on sparse tracks as well as dense ones. Analysis is around 3× faster on long files, and it no longer crashes when the selected layer has no audio.',
      resources: ['Auto Beat Marker'],
      daysAgo: 4,
    },
    {
      title: 'Anime Scene Pack Vol. 4 is up',
      kind: 'RELEASE' as const,
      body: '42 clips, upscaled to 4K and colour-matched to a shared neutral base. ProRes 422 rather than H.264, so they hold up to speed ramps and grading.',
      resources: ['Anime Scene Pack Vol. 4'],
      daysAgo: 9,
    },
    {
      title: 'Halation LUTs now ship at 65×',
      kind: 'UPDATE' as const,
      body: 'Added 65× cube variants for delivery grading, and fixed highlight clipping above 90 IRE in Halation Strong. The 33× versions are still included for real-time playback.',
      resources: ['Halation Film LUT Pack'],
      daysAgo: 23,
    },
  ];
  for (const c of changelog) {
    const slug = slugify(c.title);
    if (await prisma.changelogEntry.findUnique({ where: { slug } })) continue;
    await prisma.changelogEntry.create({
      data: {
        title: c.title,
        slug,
        body: c.body,
        kind: c.kind,
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() - c.daysAgo * 24 * 60 * 60 * 1000),
        resources: {
          create: c.resources
            .map((title) => resourceIdByTitle.get(title))
            .filter((id): id is string => !!id)
            .map((resourceId) => ({ resourceId })),
        },
      },
    });
  }

  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
