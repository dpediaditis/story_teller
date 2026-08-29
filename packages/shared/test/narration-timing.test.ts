import { describe, expect, it } from 'vitest';
import {
  alignSentenceBoundaries,
  buildNarrationTimeline,
  pageIndexAtMs,
  splitStorySentences,
  wordAtMs,
  type NarrationTimeline,
  type SentenceAnchors,
} from '../src/narration-timing.ts';

/**
 * The reader drives word highlighting and automatic page turns off this, so the
 * properties that matter are the ones a child would notice going wrong: time
 * running backwards, a page that never ends, a highlight that drifts further
 * out the longer the story runs, a page turning a sentence early.
 */

const PAGES = [
  { index: 1, text: 'Pixel is a funny purple monster. Pixel loves the bright galaxy.' },
  { index: 2, text: 'A little yellow star fell down.' },
  { index: 3, text: 'Pixel held the star, and it began to shine again.' },
];

function allWords(timeline: NarrationTimeline) {
  return timeline.pages.flatMap((p) => p.words);
}

describe('buildNarrationTimeline — modelled fallback', () => {
  it('spans exactly the measured duration', () => {
    const timeline = buildNarrationTimeline(PAGES, 40_000);
    expect(timeline.totalMs).toBe(40_000);
    expect(timeline.anchored).toBe(false);
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
    const many = Array.from({ length: 12 }, (_, i) => ({
      index: i + 1,
      text: 'The little star went up and over the quiet hill.',
    }));
    expect(buildNarrationTimeline(many, 90_000).pages[11]!.endMs).toBe(90_000);
  });

  it('gives a longer word more time than a short one', () => {
    const timeline = buildNarrationTimeline([{ index: 1, text: 'a extraordinary a' }], 10_000);
    const [first, long, third] = timeline.pages[0]!.words;
    const lengthOf = (w: { startMs: number; endMs: number }) => w.endMs - w.startMs;
    expect(lengthOf(long!)).toBeGreaterThan(lengthOf(first!));
    expect(lengthOf(long!)).toBeGreaterThan(lengthOf(third!));
  });

  it('holds longer on a word that ends a sentence', () => {
    const timeline = buildNarrationTimeline([{ index: 1, text: 'star star. star' }], 9_000);
    const [plain, terminal] = timeline.pages[0]!.words;
    expect(terminal!.endMs - terminal!.startMs).toBeGreaterThan(plain!.endMs - plain!.startMs);
  });

  it('keeps punctuation on the word, because that is what gets rendered', () => {
    expect(allWords(buildNarrationTimeline(PAGES, 40_000)).map((w) => w.text)).toContain('star,');
  });

  it('sorts pages into reading order before dividing the audio', () => {
    const timeline = buildNarrationTimeline([PAGES[2]!, PAGES[0]!, PAGES[1]!], 40_000);
    expect(timeline.pages.map((p) => p.pageIndex)).toEqual([1, 2, 3]);
  });

  it('survives a duration it could not measure', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const timeline = buildNarrationTimeline(PAGES, bad);
      expect(allWords(timeline).length).toBeGreaterThan(0);
      expect(Number.isFinite(timeline.totalMs)).toBe(true);
      expect(timeline.totalMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('survives an empty story', () => {
    expect(buildNarrationTimeline([], 40_000).pages).toEqual([]);
    expect(buildNarrationTimeline([{ index: 1, text: '   ' }], 40_000).pages[0]!.words).toEqual([]);
  });
});

/**
 * The fixture is a real narration, not an invention: "Pixel's Space Adventure",
 * six pages, eighteen sentences, 68411ms, read by Bramble. The candidate times
 * are the ends of the silences a 10ms RMS envelope at 2% of peak actually found
 * in that file, and the expected page starts were read off the same audio by
 * hand before any of this code existed.
 */
const REAL_PAGES = [
  {
    index: 1,
    text: 'Pixel is a funny purple monster who loves to explore the stars. Pixel wears a suit made of shiny stardust to stay cozy. Today, Pixel flies a round rocket toward the glowing moon.',
  },
  {
    index: 2,
    text: 'The rocket zooms past a field of floating space marbles. Pixel laughs when a marble bonks against the glass window. The rocket wobbles and slows down as it reaches the moon.',
  },
  {
    index: 3,
    text: 'Oh no, a thick cloud of moon dust blocks the landing pad. The rocket cannot see the ground clearly to land safely. Pixel feels a little bit brave and opens the rocket door.',
  },
  {
    index: 4,
    text: 'Pixel has a clever idea to clear the moon dust away. The purple monster shakes those star-shaped flowers very fast. A magical breeze pushes the dusty cloud far into the deep sky.',
  },
  {
    index: 5,
    text: 'The clear ground looks like a smooth silver plate. Pixel dances a little jig on the shiny moon rocks. It feels good to solve a problem with a happy dance.',
  },
  {
    index: 6,
    text: 'Pixel lands the rocket perfectly in the center of the pad. The little explorer snacks on a piece of starlight cake. Being brave is hungry work for a purple monster.',
  },
];
const REAL_CANDIDATES = [
  5110, 9230, 13850, 17950, 21710, 25600, 30180, 33690, 37590, 40980, 44940, 49550, 52780, 55890,
  58980, 62490, 65690,
];
const REAL_SPEECH_START = 260;
const REAL_SPEECH_END = 68110;
const REAL_SILENCE_MS = 13000;
/** Read off the audio by hand. Page N starts when its first sentence does. */
const REAL_PAGE_STARTS = [260, 13850, 25600, 37590, 49550, 58980];

describe('alignSentenceBoundaries', () => {
  const sentences = splitStorySentences(REAL_PAGES);

  it('splits the story into the sentences the narrator read', () => {
    expect(sentences).toHaveLength(18);
  });

  it('places every boundary on the pause the narrator actually took', () => {
    const result = alignSentenceBoundaries(
      sentences,
      REAL_CANDIDATES,
      REAL_SPEECH_START,
      REAL_SPEECH_END,
      REAL_SILENCE_MS,
    );
    expect(result).not.toBeNull();
    expect(result!.anchoredCount).toBe(17);
    expect(result!.spans.map((s) => s.endMs).slice(0, 17)).toEqual(REAL_CANDIDATES);
  });

  /**
   * The regression that made the reader look broken. The residual bows through
   * a story — these candidates run 466ms late at the first boundary and 2680ms
   * late in the middle — and an earlier version scored each boundary on how far
   * it sat from expectation. Skipping one boundary and sliding every later one
   * onto its neighbour's pause scored better, so page four turned a sentence
   * early and never recovered.
   */
  it('does not skip a boundary and slide the rest onto the wrong pauses', () => {
    const result = alignSentenceBoundaries(
      sentences,
      REAL_CANDIDATES,
      REAL_SPEECH_START,
      REAL_SPEECH_END,
      REAL_SILENCE_MS,
    )!;
    const anchors: SentenceAnchors = {
      version: 1,
      kind: 'sentence_anchors',
      durationMs: 68411,
      sentences: result.spans,
    };
    const timeline = buildNarrationTimeline(REAL_PAGES, 68411, anchors);
    expect(timeline.pages.map((p) => p.startMs)).toEqual(REAL_PAGE_STARTS);
  });

  it('tolerates a pause the narrator did not take', () => {
    // Drop the 9th candidate: that sentence has no stop to sit on.
    const missing = REAL_CANDIDATES.filter((_, i) => i !== 8);
    const result = alignSentenceBoundaries(
      sentences,
      missing,
      REAL_SPEECH_START,
      REAL_SPEECH_END,
      REAL_SILENCE_MS,
    )!;
    expect(result.anchoredCount).toBe(16);
    // Every surviving pause still holds its own boundary — the missing one is
    // interpolated rather than dragging its neighbours along.
    const ends = result.spans.map((s) => s.endMs);
    for (const candidate of missing) expect(ends).toContain(candidate);
  });

  it('ignores a breath the detector mistook for a full stop', () => {
    const extra = [...REAL_CANDIDATES, 7000, 34500].sort((a, b) => a - b);
    const result = alignSentenceBoundaries(
      sentences,
      extra,
      REAL_SPEECH_START,
      REAL_SPEECH_END,
      REAL_SILENCE_MS,
    )!;
    expect(result.spans.map((s) => s.endMs).slice(0, 17)).toEqual(REAL_CANDIDATES);
  });

  it('gives up rather than guess when there is almost nothing to go on', () => {
    expect(
      alignSentenceBoundaries(sentences, [], REAL_SPEECH_START, REAL_SPEECH_END, REAL_SILENCE_MS),
    ).toBeNull();
    expect(
      alignSentenceBoundaries(
        sentences,
        [20_000, 40_000],
        REAL_SPEECH_START,
        REAL_SPEECH_END,
        REAL_SILENCE_MS,
      ),
    ).toBeNull();
  });

  it('handles a one-sentence story', () => {
    const one = splitStorySentences([{ index: 1, text: 'Pixel slept.' }]);
    const result = alignSentenceBoundaries(one, [], 100, 2_000, 0)!;
    expect(result.spans).toEqual([{ startMs: 100, endMs: 2_000 }]);
  });
});

describe('buildNarrationTimeline — anchored', () => {
  const sentences = splitStorySentences(REAL_PAGES);
  const anchors: SentenceAnchors = {
    version: 1,
    kind: 'sentence_anchors',
    durationMs: 68411,
    sentences: alignSentenceBoundaries(
      sentences,
      REAL_CANDIDATES,
      REAL_SPEECH_START,
      REAL_SPEECH_END,
      REAL_SILENCE_MS,
    )!.spans,
  };

  it('says which kind of timeline it is', () => {
    expect(buildNarrationTimeline(REAL_PAGES, 68411, anchors).anchored).toBe(true);
    expect(buildNarrationTimeline(REAL_PAGES, 68411).anchored).toBe(false);
  });

  it('turns pages on the measured boundaries', () => {
    const timeline = buildNarrationTimeline(REAL_PAGES, 68411, anchors);
    REAL_PAGE_STARTS.forEach((startMs, i) => {
      expect(pageIndexAtMs(timeline, startMs + 5)).toBe(i + 1);
    });
  });

  it('beats the fallback on every page of a real narration', () => {
    const modelled = buildNarrationTimeline(REAL_PAGES, 68411);
    const measured = buildNarrationTimeline(REAL_PAGES, 68411, anchors);
    for (let i = 0; i < REAL_PAGE_STARTS.length; i += 1) {
      const truth = REAL_PAGE_STARTS[i]!;
      const before = Math.abs(modelled.pages[i]!.startMs - truth);
      const after = Math.abs(measured.pages[i]!.startMs - truth);
      expect(after).toBeLessThanOrEqual(before);
    }
    // The worst page was 2.27 seconds out. Nothing should be out at all now.
    const worst = Math.max(
      ...REAL_PAGE_STARTS.map((truth, i) => Math.abs(measured.pages[i]!.startMs - truth)),
    );
    expect(worst).toBe(0);
  });

  it('keeps words inside their own sentence', () => {
    const timeline = buildNarrationTimeline(REAL_PAGES, 68411, anchors);
    for (const page of timeline.pages) {
      let previousEnd = -1;
      for (const word of page.words) {
        expect(word.startMs).toBeGreaterThanOrEqual(previousEnd);
        expect(word.endMs).toBeGreaterThanOrEqual(word.startMs);
        previousEnd = word.endMs;
      }
    }
  });

  /**
   * Anchors describe one exact text. A story regenerated after its narration
   * would shift every sentence after the mismatch, which is worse than the
   * model it replaced and silent about it.
   */
  it('refuses anchors that do not describe this story', () => {
    const wrong: SentenceAnchors = { ...anchors, sentences: anchors.sentences.slice(0, 5) };
    expect(buildNarrationTimeline(REAL_PAGES, 68411, wrong).anchored).toBe(false);
  });
});

describe('pageIndexAtMs', () => {
  const timeline = buildNarrationTimeline(PAGES, 40_000);

  it('finds the page being read', () => {
    for (const page of timeline.pages) {
      expect(pageIndexAtMs(timeline, (page.startMs + page.endMs) / 2)).toBe(page.pageIndex);
    }
  });

  it('turns the page during the silence, not after the next page has started', () => {
    const gap = (timeline.pages[0]!.endMs + timeline.pages[1]!.startMs) / 2;
    expect(pageIndexAtMs(timeline, gap)).toBe(2);
  });

  it('clamps outside the audio instead of returning null', () => {
    expect(pageIndexAtMs(timeline, -5_000)).toBe(1);
    expect(pageIndexAtMs(timeline, 999_999)).toBe(3);
    expect(pageIndexAtMs({ pages: [], totalMs: 0, anchored: false }, 0)).toBeNull();
  });
});

describe('wordAtMs', () => {
  const timeline = buildNarrationTimeline(PAGES, 40_000);
  const page = timeline.pages[0]!;

  it('returns the word whose span contains the moment', () => {
    for (const word of page.words) {
      expect(wordAtMs(page, (word.startMs + word.endMs) / 2)?.index).toBe(word.index);
    }
  });

  it('highlights nothing while a different page is being read', () => {
    expect(wordAtMs(page, timeline.pages[2]!.startMs + 10)).toBeNull();
    expect(wordAtMs(page, -1)).toBeNull();
  });
});
