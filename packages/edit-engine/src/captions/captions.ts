import { formatTimecode, type FrameRate, type Ticks, TICKS_PER_SECOND } from '../time/time.js';
import { newId } from '../model/factory.js';
import type { CaptionCue, CaptionTrack, CaptionWord, EditDocument, Id } from '../model/types.js';

/**
 * Captions.
 *
 * Word-level timing is the primary representation, not a nicety: caption
 * animation, filler-word removal and "cut to the transcript" all need to know
 * where individual words sit. Cue text is derived from the words so the two can
 * never drift.
 */

export interface CaptionStyle {
  readonly id: string;
  readonly name: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly weight: number;
  readonly color: string;
  readonly activeColor: string;
  readonly background: string | null;
  readonly outlineWidth: number;
  readonly outlineColor: string;
  /** How each word animates in. */
  readonly animation: 'none' | 'fade' | 'pop' | 'slide-up' | 'typewriter' | 'karaoke';
  /** Vertical placement, 0 top to 1 bottom. */
  readonly anchorY: number;
  readonly uppercase: boolean;
  /** Words shown at once; 1 gives the one-word-at-a-time TikTok look. */
  readonly wordsPerCue: number;
}

export const CAPTION_STYLES: readonly CaptionStyle[] = [
  {
    id: 'clean',
    name: 'Clean',
    fontFamily: 'Inter',
    fontSize: 56,
    weight: 600,
    color: '#ffffff',
    activeColor: '#ffffff',
    background: '#00000099',
    outlineWidth: 0,
    outlineColor: '#000000',
    animation: 'fade',
    anchorY: 0.82,
    uppercase: false,
    wordsPerCue: 7,
  },
  {
    id: 'pop',
    name: 'Pop',
    fontFamily: 'Inter',
    fontSize: 78,
    weight: 800,
    color: '#ffffff',
    activeColor: '#22e3c3',
    background: null,
    outlineWidth: 8,
    outlineColor: '#000000',
    animation: 'pop',
    anchorY: 0.72,
    uppercase: true,
    wordsPerCue: 3,
  },
  {
    id: 'karaoke',
    name: 'Karaoke',
    fontFamily: 'Inter',
    fontSize: 64,
    weight: 700,
    color: '#ffffff80',
    activeColor: '#ffe14d',
    background: null,
    outlineWidth: 6,
    outlineColor: '#000000',
    animation: 'karaoke',
    anchorY: 0.78,
    uppercase: false,
    wordsPerCue: 5,
  },
  {
    id: 'single-word',
    name: 'One Word',
    fontFamily: 'Inter',
    fontSize: 110,
    weight: 900,
    color: '#ffffff',
    activeColor: '#ffffff',
    background: null,
    outlineWidth: 10,
    outlineColor: '#000000',
    animation: 'pop',
    anchorY: 0.5,
    uppercase: true,
    wordsPerCue: 1,
  },
  {
    id: 'subtitle',
    name: 'Subtitle',
    fontFamily: 'Inter',
    fontSize: 44,
    weight: 500,
    color: '#ffffff',
    activeColor: '#ffffff',
    background: '#000000cc',
    outlineWidth: 0,
    outlineColor: '#000000',
    animation: 'none',
    anchorY: 0.88,
    uppercase: false,
    wordsPerCue: 12,
  },
];

export const getCaptionStyle = (id: string): CaptionStyle =>
  CAPTION_STYLES.find((s) => s.id === id) ?? CAPTION_STYLES[0];

/** Words the filler-word pass flags. Kept per-language. */
const FILLER_WORDS: Record<string, readonly string[]> = {
  en: ['um', 'uh', 'erm', 'like', 'you know', 'i mean', 'sort of', 'kind of', 'basically', 'literally', 'actually', 'right'],
  es: ['este', 'pues', 'o sea', 'bueno'],
  fr: ['euh', 'ben', 'genre', 'du coup'],
  de: ['äh', 'ähm', 'halt', 'also'],
  pt: ['né', 'tipo', 'então'],
};

const normalise = (word: string) => word.toLowerCase().replace(/[.,!?;:'"]/g, '').trim();

/** Flag filler words in place so the UI can offer one-tap removal. */
export function markFillerWords(track: CaptionTrack): CaptionTrack {
  const language = track.language.split('-')[0];
  const fillers = new Set(FILLER_WORDS[language] ?? FILLER_WORDS.en);
  return {
    ...track,
    cues: track.cues.map((cue) => ({
      ...cue,
      words: cue.words.map((w) => ({ ...w, filler: fillers.has(normalise(w.text)) })),
    })),
  };
}

/** Time ranges occupied by flagged filler words — the input to a ripple delete. */
export function fillerRanges(track: CaptionTrack): { start: Ticks; duration: Ticks }[] {
  const out: { start: Ticks; duration: Ticks }[] = [];
  for (const cue of track.cues) {
    for (const word of cue.words) {
      if (word.filler) out.push({ start: word.start, duration: word.end - word.start });
    }
  }
  return mergeAdjacent(out);
}

function mergeAdjacent(
  ranges: { start: Ticks; duration: Ticks }[],
  gapTolerance = TICKS_PER_SECOND / 20,
): { start: Ticks; duration: Ticks }[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: { start: Ticks; duration: Ticks }[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.start - (last.start + last.duration) <= gapTolerance) {
      const end = Math.max(last.start + last.duration, range.start + range.duration);
      out[out.length - 1] = { start: last.start, duration: end - last.start };
    } else {
      out.push(range);
    }
  }
  return out;
}

/**
 * Regroup a transcript's words into cues of at most `wordsPerCue`, breaking
 * early at sentence ends and at pauses so a cue never straddles a natural
 * break. This is what makes switching caption style re-flow the text correctly.
 */
export function regroupCues(
  words: readonly CaptionWord[],
  wordsPerCue: number,
  pauseTolerance = TICKS_PER_SECOND * 0.6,
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let buffer: CaptionWord[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    cues.push({
      id: newId('cue'),
      start: buffer[0].start,
      end: buffer[buffer.length - 1].end,
      text: buffer.map((w) => w.text).join(' '),
      words: buffer,
    });
    buffer = [];
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    buffer.push(word);

    const next = words[i + 1];
    const sentenceEnd = /[.!?]$/.test(word.text);
    const longPause = next ? next.start - word.end > pauseTolerance : false;

    if (buffer.length >= wordsPerCue || sentenceEnd || longPause) flush();
  }
  flush();
  return cues;
}

export function createCaptionTrack(
  words: readonly CaptionWord[],
  opts: {
    language?: string;
    name?: string;
    styleId?: string;
    source?: CaptionTrack['source'];
  } = {},
): CaptionTrack {
  const style = getCaptionStyle(opts.styleId ?? 'clean');
  return {
    id: newId('cap'),
    language: opts.language ?? 'en',
    name: opts.name ?? 'Captions',
    cues: regroupCues(words, style.wordsPerCue),
    styleId: style.id,
    enabled: true,
    source: opts.source ?? 'on-device',
  };
}

/** Re-flow an existing track for a different style. */
export function applyCaptionStyle(track: CaptionTrack, styleId: string): CaptionTrack {
  const style = getCaptionStyle(styleId);
  const words = track.cues.flatMap((c) => c.words);
  return { ...track, styleId: style.id, cues: regroupCues(words, style.wordsPerCue) };
}

/** Edit a cue's text, redistributing timing across the new words proportionally. */
export function editCueText(track: CaptionTrack, cueId: Id, text: string): CaptionTrack {
  return {
    ...track,
    cues: track.cues.map((cue) => {
      if (cue.id !== cueId) return cue;
      const tokens = text.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) return { ...cue, text: '', words: [] };

      const span = cue.end - cue.start;
      const per = Math.floor(span / tokens.length);
      const words: CaptionWord[] = tokens.map((token, i) => ({
        text: token,
        start: cue.start + per * i,
        end: i === tokens.length - 1 ? cue.end : cue.start + per * (i + 1),
        // Hand-typed words are certain by definition.
        confidence: 1,
      }));
      return { ...cue, text: tokens.join(' '), words };
    }),
  };
}

/** Shift every cue, e.g. after a ripple edit earlier in the timeline. */
export function shiftCaptions(track: CaptionTrack, delta: Ticks): CaptionTrack {
  return {
    ...track,
    cues: track.cues.map((cue) => ({
      ...cue,
      start: cue.start + delta,
      end: cue.end + delta,
      words: cue.words.map((w) => ({ ...w, start: w.start + delta, end: w.end + delta })),
    })),
  };
}

/**
 * Remove a time range from a caption track and pull later cues back, keeping
 * captions in sync with a ripple delete on the timeline.
 */
export function rippleCaptions(
  track: CaptionTrack,
  start: Ticks,
  duration: Ticks,
): CaptionTrack {
  const end = start + duration;
  const shift = (t: Ticks) => (t >= end ? t - duration : t > start ? start : t);

  const cues = track.cues
    .map((cue) => ({
      ...cue,
      start: shift(cue.start),
      end: shift(cue.end),
      words: cue.words
        .filter((w) => !(w.start >= start && w.end <= end))
        .map((w) => ({ ...w, start: shift(w.start), end: shift(w.end) })),
    }))
    .filter((cue) => cue.end > cue.start && cue.words.length > 0)
    .map((cue) => ({ ...cue, text: cue.words.map((w) => w.text).join(' ') }));

  return { ...track, cues };
}

/** Cues whose confidence is low enough to be worth the user's review. */
export function lowConfidenceCues(track: CaptionTrack, threshold = 0.7): CaptionCue[] {
  return track.cues.filter((cue) =>
    cue.words.some((w) => w.confidence < threshold),
  );
}

// ---------------------------------------------------------------------------
// Interchange
// ---------------------------------------------------------------------------

const srtTime = (ticks: Ticks): string => {
  const total = Math.max(0, ticks / TICKS_PER_SECOND);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = Math.floor(total) % 60;
  const ms = Math.round((total % 1) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
};

export function toSrt(track: CaptionTrack): string {
  return track.cues
    .map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`)
    .join('\n');
}

export function toVtt(track: CaptionTrack): string {
  const body = track.cues
    .map(
      (cue) =>
        `${srtTime(cue.start).replace(',', '.')} --> ${srtTime(cue.end).replace(',', '.')}\n${cue.text}\n`,
    )
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

/** Parse SRT back into a track, deriving even word timings within each cue. */
export function fromSrt(text: string, language = 'en'): CaptionTrack {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/).filter((b) => b.trim());
  const words: CaptionWord[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const timeLine = lines.find((l) => l.includes('-->'));
    if (!timeLine) continue;
    const [fromText, toText] = timeLine.split('-->').map((s) => s.trim());
    const start = parseSrtTime(fromText);
    const end = parseSrtTime(toText);
    if (start === null || end === null) continue;

    const content = lines.slice(lines.indexOf(timeLine) + 1).join(' ').trim();
    const tokens = content.split(/\s+/).filter(Boolean);
    const per = tokens.length > 0 ? Math.floor((end - start) / tokens.length) : 0;
    tokens.forEach((token, i) => {
      words.push({
        text: token,
        start: start + per * i,
        end: i === tokens.length - 1 ? end : start + per * (i + 1),
        confidence: 1,
      });
    });
  }

  return createCaptionTrack(words, { language, source: 'imported', name: 'Imported' });
}

function parseSrtTime(text: string): Ticks | null {
  const m = /^(\d+):(\d+):(\d+)[,.](\d+)$/.exec(text.trim());
  if (!m) return null;
  const [, h, min, s, ms] = m;
  const seconds =
    parseInt(h, 10) * 3600 + parseInt(min, 10) * 60 + parseInt(s, 10) + parseInt(ms, 10) / 1000;
  return Math.round(seconds * TICKS_PER_SECOND);
}

/** Transcript view with timecode, for the "edit by transcript" screen. */
export function transcriptLines(
  track: CaptionTrack,
  rate: FrameRate,
): { time: string; text: string; cueId: Id }[] {
  return track.cues.map((cue) => ({
    time: formatTimecode(cue.start, rate),
    text: cue.text,
    cueId: cue.id,
  }));
}

/** Caption tracks referenced by a document, for the export dialogue. */
export const captionTracksOf = (doc: EditDocument): readonly CaptionTrack[] => doc.captionTracks;
