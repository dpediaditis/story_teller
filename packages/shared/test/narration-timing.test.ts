import { describe, expect, it } from 'vitest';
import {
  buildNarrationTimeline,
  pageIndexAtMs,
  wordAtMs,
  type NarrationTimeline,
} from '../src/narration-timing.ts';

/**
 * The reader drives word highlighting and automatic page turns off this, so the
 * properties that matter are the ones a child would notice going wrong: time
 * running backwards, a page that never ends, a highlight that drifts further
 * out the longer the story runs.
 */

const PAGES = [
  { index: 1, text: 'Pixel is a funny purple monster. Pixel loves the bright galaxy.' },
  { index: 2, text: 'A little yellow star fell down.' },
  { index: 3, text: 'Pixel held the star, and it began to shine again.' },
];

function allWords(timeline: NarrationTimeline) {
  return timeline.pages.flatMap((p) => p.words);
}

describe('buildNarrationTimeline', () => {
  it('spans exactly the measured duration', () => {
    const timeline = buildNarrationTimeline(PAGES, 40_000);
    expect(timeline.totalMs).toBe(40_000);
    // The last page ends at the last word; the trailing page break is dropped.
    const last = timeline.pages[timeline.pages.length - 1]!;
    expect(last.endMs).toBe(40_000);
  });

  it('never runs backwards, and leaves no gap inside a page', () => {
    const timeline = buildNarrationTimeline(PAGES, 40_000);
    for (const page of timeline.pages) {
      let previousEnd = page.startMs;
      for (const word of page.words) {
        expect(word.startMs).toBe(previousEnd);
        expect(word.endMs).toBeGreaterThan(word.startMs);
        previousEnd = word.endMs;
      }
      expect(page.endMs).toBe(previousEnd);
    }
  });

  it('puts silence between pages, not inside them', () => {
    const timeline = buildNarrationTimeline(PAGES, 40_000);
    for (let i = 0; i < timeline.pages.length - 1; i += 1) {
      expect(timeline.pages[i + 1]!.startMs).toBeGreaterThan(timeline.pages[i]!.endMs);
    }
  });

  it('does not accumulate drift — total error stays at zero, not per-page', () => {
    // The failure this guards against is a model that is 2% fast per page and
    // therefore a whole sentence out by page six.
    const many = Array.from({ length: 12 }, (_, i) => ({
      index: i + 1,
      text: 'The little star went up and over the quiet hill.',
    }));
    const timeline = buildNarrationTimeline(many, 90_000);
    expect(timeline.pages[11]!.endMs).toBe(90_000);
  });

  it('gives a longer word more time than a short one', () => {
    const timeline = buildNarrationTimeline(
      [{ index: 1, text: 'a extraordinary a' }],
      10_000,
    );
    const [first, long, third] = timeline.pages[0]!.words;
    const lengthOf = (w: { startMs: number; endMs: number }) => w.endMs - w.startMs;
    expect(lengthOf(long!)).toBeGreaterThan(lengthOf(first!));
    expect(lengthOf(long!)).toBeGreaterThan(lengthOf(third!));
  });

  it('holds longer on a word that ends a sentence than the same word mid-sentence', () => {
    const timeline = buildNarrationTimeline([{ index: 1, text: 'star star. star' }], 9_000);
    const [plain, terminal] = timeline.pages[0]!.words;
    expect(terminal!.endMs - terminal!.startMs).toBeGreaterThan(plain!.endMs - plain!.startMs);
  });

  it('numbers sentences within the page', () => {
    const timeline = buildNarrationTimeline(PAGES, 40_000);
    const page1 = timeline.pages[0]!;
    expect(page1.words[0]!.sentenceIndex).toBe(0);
    // "monster." closes the first sentence, so the next word starts the second.
    const monster = page1.words.findIndex((w) => w.text === 'monster.');
    expect(page1.words[monster]!.sentenceIndex).toBe(0);
    expect(page1.words[monster + 1]!.sentenceIndex).toBe(1);
  });

  it('keeps punctuation on the word, because that is what gets rendered', () => {
    const timeline = buildNarrationTimeline(PAGES, 40_000);
    expect(allWords(timeline).map((w) => w.text)).toContain('star,');
  });

  it('sorts pages into reading order before dividing the audio', () => {
    const shuffled = [PAGES[2]!, PAGES[0]!, PAGES[1]!];
    const timeline = buildNarrationTimeline(shuffled, 40_000);
    expect(timeline.pages.map((p) => p.pageIndex)).toEqual([1, 2, 3]);
  });

  it('survives a duration it could not measure', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const timeline = buildNarrationTimeline(PAGES, bad);
      // Still the full text, so the reader renders prose with no highlight
      // rather than an empty page.
      expect(allWords(timeline).length).toBeGreaterThan(0);
      expect(timeline.totalMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(timeline.totalMs)).toBe(true);
    }
  });

  it('survives an empty story', () => {
    expect(buildNarrationTimeline([], 40_000).pages).toEqual([]);
    const blank = buildNarrationTimeline([{ index: 1, text: '   ' }], 40_000);
    expect(blank.pages[0]!.words).toEqual([]);
  });

  it('is marked as estimated, never as provider truth', () => {
    expect(buildNarrationTimeline(PAGES, 40_000).estimated).toBe(true);
  });
});

describe('pageIndexAtMs', () => {
  const timeline = buildNarrationTimeline(PAGES, 40_000);

  it('finds the page being read', () => {
    for (const page of timeline.pages) {
      const middle = (page.startMs + page.endMs) / 2;
      expect(pageIndexAtMs(timeline, middle)).toBe(page.pageIndex);
    }
  });

  it('turns the page during the silence, not after the next page has started', () => {
    const gap = (timeline.pages[0]!.endMs + timeline.pages[1]!.startMs) / 2;
    expect(pageIndexAtMs(timeline, gap)).toBe(2);
  });

  it('clamps outside the audio instead of returning null', () => {
    expect(pageIndexAtMs(timeline, -5_000)).toBe(1);
    expect(pageIndexAtMs(timeline, 999_999)).toBe(3);
    expect(pageIndexAtMs({ pages: [], totalMs: 0, estimated: true }, 0)).toBeNull();
  });
});

describe('wordAtMs', () => {
  const timeline = buildNarrationTimeline(PAGES, 40_000);
  const page = timeline.pages[0]!;

  it('returns the word whose span contains the moment', () => {
    for (const word of page.words) {
      const middle = (word.startMs + word.endMs) / 2;
      expect(wordAtMs(page, middle)?.index).toBe(word.index);
    }
  });

  it('highlights nothing while a different page is being read', () => {
    expect(wordAtMs(page, timeline.pages[2]!.startMs + 10)).toBeNull();
    expect(wordAtMs(page, -1)).toBeNull();
  });
});
