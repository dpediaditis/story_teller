import { syllableCount } from './syllables.ts';

/**
 * Where in the narration each word and each page falls.
 *
 * WHAT THIS IS NOT: these are not the provider's timings. Gemini TTS returns
 * audio and nothing else — `narrations.word_timings_key` is null on every row
 * and `sentence_level_only` is true. So this is a MODEL of the narration,
 * derived from the text and the one hard number we do have: the measured
 * duration of the file (`durationMs`, read off the WAV header, not estimated).
 *
 * That distinction is why `estimated: true` is on the timeline rather than
 * implied. If a provider that reports real timings is ever adopted, this module
 * is what it replaces, and the reader should not have to change.
 *
 * How the model works. The worker narrates the whole story in one pass, pages
 * joined in order with a blank line between them, so the audio is the pages
 * back to back and dividing it up is legitimate. Each word is given a weight in
 * "syllable equivalents" and the weights are scaled so they sum to the measured
 * duration:
 *
 *   - the word itself           its syllable count (floor of 1)
 *   - trailing punctuation      a pause, because a narrator stops there
 *   - the join between pages    a longer pause, it is a paragraph break
 *
 * Only the RATIOS between those weights matter, since the total is pinned to a
 * duration we measured. The absolute values below come from ordinary
 * read-aloud pacing — a sentence-final pause is worth a syllable or so, a comma
 * about half that — and they are guesses, honestly. What keeps a guess from
 * being felt as a bug is where the error can land: the sum is exact, so drift
 * cannot accumulate across the story; it can only wander a little inside a
 * sentence and is pulled back at every stop.
 *
 * The reader is built to match: the current SENTENCE carries the highlight
 * wash and the current WORD carries the stronger mark. A word cursor a beat
 * early or late still sits inside the right sentence, which is the band the eye
 * is actually following.
 */

/** Pause after a word, in syllable equivalents. See the header. */
const PAUSE_WEIGHT: { pattern: RegExp; weight: number }[] = [
  { pattern: /[…]$|\.\.\.$/u, weight: 1.6 },
  { pattern: /[.!?]["'”’)\]]*$/u, weight: 1.4 },
  { pattern: /[;:]["'”’)\]]*$/u, weight: 0.9 },
  { pattern: /[,—–]["'”’)\]]*$/u, weight: 0.7 },
];

/** The blank line between two pages. A page turn is a longer breath. */
const PAGE_BREAK_WEIGHT = 2;

/** A word ending in one of these closes a sentence. */
const SENTENCE_END = /[.!?…]["'”’)\]]*$/u;

export interface NarratedWord {
  /** Position in the page's own word list, 0-based. */
  index: number;
  /** The word as written, punctuation attached — this is what gets rendered. */
  text: string;
  /** Which sentence of this page the word belongs to, 0-based. */
  sentenceIndex: number;
  /** Media time from the start of the whole narration, in ms. */
  startMs: number;
  endMs: number;
}

export interface NarratedPage {
  /** 1-based, matching `StoryPageDto.index`. */
  pageIndex: number;
  startMs: number;
  endMs: number;
  words: NarratedWord[];
}

export interface NarrationTimeline {
  pages: NarratedPage[];
  totalMs: number;
  /** False only if a provider ever gives us real timings. See the header. */
  estimated: boolean;
}

/** Splits on whitespace and keeps punctuation attached to its word. */
function toWords(text: string): string[] {
  return text.split(/\s+/u).filter((w) => w.length > 0);
}

function pauseWeightFor(word: string): number {
  for (const { pattern, weight } of PAUSE_WEIGHT) {
    if (pattern.test(word)) return weight;
  }
  return 0;
}

/**
 * Build the timeline for one story.
 *
 * `pages` must be in reading order and contain exactly the text that was sent
 * to the synthesiser — a page the reader hides, or text it trims, would shift
 * everything after it.
 */
export function buildNarrationTimeline(
  pages: { index: number; text: string }[],
  durationMs: number,
): NarrationTimeline {
  const ordered = [...pages].sort((a, b) => a.index - b.index);

  const weighted = ordered.map((page, pageOrder) => {
    const words = toWords(page.text);
    let sentenceIndex = 0;
    const entries = words.map((text, index) => {
      const at = sentenceIndex;
      if (SENTENCE_END.test(text)) sentenceIndex += 1;
      return {
        index,
        text,
        sentenceIndex: at,
        weight: syllableCount(text) + pauseWeightFor(text),
      };
    });
    // The break belongs to the page it follows, so the last word of a page is
    // not stretched to cover a silence it does not fill.
    const breakWeight = pageOrder < ordered.length - 1 ? PAGE_BREAK_WEIGHT : 0;
    return { pageIndex: page.index, entries, breakWeight };
  });

  const totalWeight = weighted.reduce(
    (sum, p) => sum + p.breakWeight + p.entries.reduce((s, e) => s + e.weight, 0),
    0,
  );

  // A story with no text, or a duration we could not measure. Return the shape
  // rather than nothing, so the reader renders words with no highlight instead
  // of falling back to a different layout.
  if (totalWeight <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
    return {
      // Never pass a non-finite duration on: it reaches the reader's progress
      // bar as a width, and `Infinity%` renders as a bar that is simply gone.
      totalMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0,
      estimated: true,
      pages: weighted.map((p) => ({
        pageIndex: p.pageIndex,
        startMs: 0,
        endMs: 0,
        words: p.entries.map((e) => ({
          index: e.index,
          text: e.text,
          sentenceIndex: e.sentenceIndex,
          startMs: 0,
          endMs: 0,
        })),
      })),
    };
  }

  const msPerWeight = durationMs / totalWeight;
  let cursor = 0;

  const timedPages: NarratedPage[] = weighted.map((page) => {
    const pageStart = cursor;
    const words: NarratedWord[] = page.entries.map((entry) => {
      const startMs = cursor;
      cursor += entry.weight * msPerWeight;
      return {
        index: entry.index,
        text: entry.text,
        sentenceIndex: entry.sentenceIndex,
        startMs: Math.round(startMs),
        endMs: Math.round(cursor),
      };
    });
    // The page ends where its last word ends; the break that follows is silence
    // between pages and belongs to neither.
    const pageEnd = cursor;
    cursor += page.breakWeight * msPerWeight;
    return {
      pageIndex: page.pageIndex,
      startMs: Math.round(pageStart),
      endMs: Math.round(pageEnd),
      words,
    };
  });

  return { pages: timedPages, totalMs: Math.round(durationMs), estimated: true };
}

/**
 * Which page is being read at `ms`.
 *
 * Returns the page whose span contains `ms`, and during the silence between two
 * pages returns the one about to start — the turn should happen while nobody is
 * speaking, not a beat into the next page's first word.
 */
export function pageIndexAtMs(timeline: NarrationTimeline, ms: number): number | null {
  if (timeline.pages.length === 0) return null;
  const first = timeline.pages[0]!;
  if (ms < first.startMs) return first.pageIndex;
  for (let i = 0; i < timeline.pages.length; i += 1) {
    const page = timeline.pages[i]!;
    if (ms < page.endMs) return page.pageIndex;
    const next = timeline.pages[i + 1];
    if (next && ms < next.startMs) return next.pageIndex;
  }
  return timeline.pages[timeline.pages.length - 1]!.pageIndex;
}

/** The word being spoken at `ms`, or null when `ms` falls outside this page. */
export function wordAtMs(page: NarratedPage, ms: number): NarratedWord | null {
  if (page.words.length === 0) return null;
  if (ms < page.startMs || ms >= page.endMs) return null;
  for (const word of page.words) {
    if (ms < word.endMs) return word;
  }
  return page.words[page.words.length - 1] ?? null;
}
