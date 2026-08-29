import { syllableCount } from './syllables.ts';

/**
 * Where in the narration each word, sentence and page falls.
 *
 * The narrator's own pauses are the ground truth. Gemini TTS returns audio and
 * no timings, but it does stop between sentences, and those stops are
 * measurable in the PCM: on a real 68s narration of 18 sentences, thresholding
 * the RMS envelope at 2% of peak found exactly 17 internal silences of 470-890ms
 * with comma pauses landing at 120-330ms, cleanly separated. `services/worker`
 * detects them, aligns them to the text, and stores the boundaries as
 * `SentenceAnchors` on `narrations.word_timings_key`.
 *
 * So there are two levels of confidence here, and they are kept distinct:
 *
 *   - SENTENCE boundaries are MEASURED when anchors exist. A page break is a
 *     sentence break, so page turns are exact.
 *   - WORD positions inside a sentence are always modelled — a syllable count
 *     plus a small pause weight for trailing punctuation, scaled to fit the
 *     sentence. Error is bounded by one sentence, a few seconds at most, and
 *     cannot accumulate.
 *
 * Without anchors the same model spans the whole story instead, pinned only at
 * the ends. That is the fallback for a story narrated before anchoring existed,
 * and `timeline.anchored` says which one you are looking at. The first version
 * of this file only had the fallback, and a couple of seconds of drift by the
 * end of a story is plainly visible when it is a word being highlighted.
 *
 * The reader's two-level highlight is built on the same split: the sentence
 * carries the wash (measured) and the word carries the mark (modelled).
 */

/** Pause after a word, in syllable equivalents. Relative weights, not seconds. */
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
  /** True when sentence boundaries came from the audio, not from the model. */
  anchored: boolean;
}

/**
 * The measured file, stored at `narrations.word_timings_key`.
 *
 * One entry per sentence of the whole story, in reading order, spanning every
 * page. Only the boundaries are stored: word positions are derived from the
 * text, so this file stays small and there is exactly one word model.
 */
export interface SentenceAnchors {
  version: 1;
  kind: 'sentence_anchors';
  /** The measured duration of the narration this was derived from. */
  durationMs: number;
  /** `[startMs, endMs]` per sentence, in reading order across all pages. */
  sentences: { startMs: number; endMs: number }[];
}

export function isSentenceAnchors(value: unknown): value is SentenceAnchors {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<SentenceAnchors>;
  return (
    v.version === 1 &&
    v.kind === 'sentence_anchors' &&
    typeof v.durationMs === 'number' &&
    Array.isArray(v.sentences) &&
    v.sentences.every(
      (s) => typeof s?.startMs === 'number' && typeof s?.endMs === 'number',
    )
  );
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

interface WeightedWord {
  index: number;
  text: string;
  sentenceIndex: number;
  weight: number;
  syllableWeight: number;
  pauseWeight: number;
}

interface WeightedPage {
  pageIndex: number;
  words: WeightedWord[];
  breakWeight: number;
}

/**
 * One entry per sentence of the whole story, in reading order.
 *
 * The worker aligns audio against this and the reader lays words out inside it,
 * so both sides must agree on where sentences begin. That is why it is exported
 * and why neither side is allowed its own splitter: a disagreement about the
 * number of sentences silently shifts every anchor after it.
 */
export interface StorySentence {
  pageIndex: number;
  /** Index within the page's sentences, 0-based. */
  sentenceIndex: number;
  text: string;
  /** Sum of both weights below. Used for distributing time within a sentence. */
  weight: number;
  /** Time spent talking: syllables. */
  syllableWeight: number;
  /** Time spent NOT talking: the pauses punctuation asks for. */
  pauseWeight: number;
}

function weighPages(pages: { index: number; text: string }[]): WeightedPage[] {
  const ordered = [...pages].sort((a, b) => a.index - b.index);
  return ordered.map((page, pageOrder) => {
    let sentenceIndex = 0;
    const words = toWords(page.text).map((text, index) => {
      const at = sentenceIndex;
      if (SENTENCE_END.test(text)) sentenceIndex += 1;
      const syllableWeight = syllableCount(text);
      const pauseWeight = pauseWeightFor(text);
      return {
        index,
        text,
        sentenceIndex: at,
        syllableWeight,
        pauseWeight,
        weight: syllableWeight + pauseWeight,
      };
    });
    // The break belongs to the page it follows, so the last word of a page is
    // not stretched to cover a silence it does not fill.
    const breakWeight = pageOrder < ordered.length - 1 ? PAGE_BREAK_WEIGHT : 0;
    return { pageIndex: page.index, words, breakWeight };
  });
}

export function splitStorySentences(
  pages: { index: number; text: string }[],
): StorySentence[] {
  const out: StorySentence[] = [];
  for (const page of weighPages(pages)) {
    const bySentence = new Map<number, WeightedWord[]>();
    for (const word of page.words) {
      const bucket = bySentence.get(word.sentenceIndex);
      if (bucket) bucket.push(word);
      else bySentence.set(word.sentenceIndex, [word]);
    }
    for (const [sentenceIndex, words] of [...bySentence.entries()].sort((a, b) => a[0] - b[0])) {
      out.push({
        pageIndex: page.pageIndex,
        sentenceIndex,
        text: words.map((w) => w.text).join(' '),
        weight: words.reduce((s, w) => s + w.weight, 0),
        syllableWeight: words.reduce((s, w) => s + w.syllableWeight, 0),
        pauseWeight: words.reduce((s, w) => s + w.pauseWeight, 0),
      });
    }
  }
  return out;
}

function emptyTimeline(weighted: WeightedPage[], durationMs: number): NarrationTimeline {
  return {
    // Never pass a non-finite duration on: it reaches the reader's progress
    // bar as a width, and `Infinity%` renders as a bar that is simply gone.
    totalMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0,
    anchored: false,
    pages: weighted.map((p) => ({
      pageIndex: p.pageIndex,
      startMs: 0,
      endMs: 0,
      words: p.words.map((w) => ({
        index: w.index,
        text: w.text,
        sentenceIndex: w.sentenceIndex,
        startMs: 0,
        endMs: 0,
      })),
    })),
  };
}

/**
 * Build the timeline for one story.
 *
 * `pages` must be in reading order and contain exactly the text that was sent
 * to the synthesiser. Pass `anchors` when the narration has measured sentence
 * boundaries; without them the whole story is modelled from the weights alone.
 */
export function buildNarrationTimeline(
  pages: { index: number; text: string }[],
  durationMs: number,
  anchors?: SentenceAnchors | null,
): NarrationTimeline {
  const weighted = weighPages(pages);
  const totalWeight = weighted.reduce(
    (sum, p) => sum + p.breakWeight + p.words.reduce((s, w) => s + w.weight, 0),
    0,
  );

  // A story with no text, or a duration we could not measure. Return the shape
  // rather than nothing, so the reader renders words with no highlight instead
  // of falling back to a different layout.
  if (totalWeight <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
    return emptyTimeline(weighted, durationMs);
  }

  const sentences = splitStorySentences(pages);
  /* Anchors are only usable if they describe THIS text. A story regenerated
   * after its narration, or a file from a different version of the splitter,
   * would otherwise shift every sentence after the mismatch — worse than the
   * model it replaced, and silently so. */
  const usable =
    anchors && anchors.sentences.length === sentences.length && sentences.length > 0;

  if (!usable) return modelWholeStory(weighted, totalWeight, durationMs);

  /* Measured sentence spans; words distributed inside each one by weight. */
  const spanByKey = new Map<string, { startMs: number; endMs: number }>();
  sentences.forEach((s, i) => {
    spanByKey.set(`${s.pageIndex}:${s.sentenceIndex}`, anchors!.sentences[i]!);
  });

  const timedPages: NarratedPage[] = weighted.map((page) => {
    const words: NarratedWord[] = [];
    const bySentence = new Map<number, WeightedWord[]>();
    for (const word of page.words) {
      const bucket = bySentence.get(word.sentenceIndex);
      if (bucket) bucket.push(word);
      else bySentence.set(word.sentenceIndex, [word]);
    }

    for (const [sentenceIndex, group] of [...bySentence.entries()].sort((a, b) => a[0] - b[0])) {
      const span = spanByKey.get(`${page.pageIndex}:${sentenceIndex}`);
      const groupWeight = group.reduce((s, w) => s + w.weight, 0);
      if (!span || groupWeight <= 0) {
        for (const w of group) {
          words.push({ index: w.index, text: w.text, sentenceIndex, startMs: 0, endMs: 0 });
        }
        continue;
      }
      const msPerWeight = (span.endMs - span.startMs) / groupWeight;
      let cursor = span.startMs;
      for (const w of group) {
        const startMs = cursor;
        cursor += w.weight * msPerWeight;
        words.push({
          index: w.index,
          text: w.text,
          sentenceIndex,
          startMs: Math.round(startMs),
          endMs: Math.round(cursor),
        });
      }
    }

    words.sort((a, b) => a.index - b.index);
    return {
      pageIndex: page.pageIndex,
      startMs: words[0]?.startMs ?? 0,
      endMs: words[words.length - 1]?.endMs ?? 0,
      words,
    };
  });

  return { pages: timedPages, totalMs: Math.round(durationMs), anchored: true };
}

/** The fallback: one weight model stretched across the whole narration. */
function modelWholeStory(
  weighted: WeightedPage[],
  totalWeight: number,
  durationMs: number,
): NarrationTimeline {
  const msPerWeight = durationMs / totalWeight;
  let cursor = 0;

  const pages: NarratedPage[] = weighted.map((page) => {
    const pageStart = cursor;
    const words: NarratedWord[] = page.words.map((entry) => {
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
    return { pageIndex: page.pageIndex, startMs: Math.round(pageStart), endMs: Math.round(pageEnd), words };
  });

  return { pages, totalMs: Math.round(durationMs), anchored: false };
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

/**
 * Match measured pauses to sentence boundaries.
 *
 * Both sides are noisy. The detector finds comma pauses and breaths as well as
 * full stops, and it misses a stop the narrator ran through — measured across
 * seven real narrations, one story had 16 usable pauses for 17 boundaries and
 * another had 24 for 29. So this cannot be "take the N longest", and it cannot
 * demand a pause per boundary either. What it can insist on is ORDER.
 *
 * Dynamic programming over (boundary, candidate). Each boundary either takes a
 * candidate, at the cost of the squared distance from where the weight model
 * expected it, or is skipped at a flat penalty. Candidates are used at most
 * once and always in order. Squared distance rather than absolute so one badly
 * placed boundary is preferred over several slightly wrong ones: a single
 * sentence being off is recoverable, a systematic shift is what reads as
 * broken.
 *
 * Skipped boundaries are then interpolated between their neighbouring anchors
 * using the same weights. This is the property that matters — the model still
 * fills gaps, but between measured pins rather than across the whole story, so
 * error stays local and cannot accumulate.
 *
 * The expectations are themselves drawn from the drifting model, so the whole
 * thing runs twice: the second pass scores against expectations interpolated
 * from the first pass's anchors, which are much closer to the truth.
 */

/**
 * What a skipped boundary costs, as a fraction of a mean sentence, squared.
 *
 * Chosen against the alternative it competes with. A boundary with no pause to
 * sit on has to be skipped; a boundary that takes the WRONG pause drags every
 * boundary after it onto the wrong pause too, because the assignment is
 * monotone. Measured on a real narration, that slide costs roughly a full
 * sentence of offset change at each end of the mistake, so a skip is priced
 * below one slide and well above a legitimate wobble in the narrator's pace.
 */
const SKIP_COST_SENTENCES = 0.6;

/** Below this share of boundaries anchored, the fallback model is honest. */
const MIN_ANCHORED_FRACTION = 0.5;

export interface SentenceAlignment {
  spans: SentenceAnchors['sentences'];
  /** How many boundaries were placed on a measured pause. */
  anchoredCount: number;
  boundaryCount: number;
}

/**
 * Assign boundaries to candidates, monotonically, allowing skips.
 *
 * The cost is on how much the offset CHANGES from one matched boundary to the
 * next, not on how large it is. That is the whole trick, and it was arrived at
 * by measuring: even with a calibrated expectation the residual bows through a
 * story — 0.5s late at the first boundary of a real 68s narration, 2.7s late in
 * the middle, 0.7s late at the last — because a narrator does not hold one
 * pace. Penalising the offset itself made that correct, obvious, one-to-one
 * assignment look expensive, and the cheaper answer was to skip a boundary and
 * slide every later one onto its neighbour's pause. Which is precisely the
 * failure the user reported: page turns landing a sentence out.
 *
 * Penalising the change instead means a smoothly drifting alignment is nearly
 * free and a slide is not, because a slide is a sudden jump in offset and then
 * a jump back.
 *
 * Anchored at both ends by virtual matches with zero offset — the expectation
 * is built to start at the first word and finish at the last — so the drift has
 * to begin and end at nothing rather than running off.
 */
function assignMonotone(
  expected: number[],
  candidates: number[],
  skipCost: number,
): (number | null)[] {
  const n = expected.length;
  const m = candidates.length;
  if (n === 0 || m === 0) return new Array<number | null>(n).fill(null);

  /* Virtual boundary -1 at the start of speech and n at the end, both with the
   * expectation exactly on the candidate, i.e. offset zero. */
  const offsetOf = (i: number, j: number) => candidates[j]! - expected[i]!;
  const INF = Number.POSITIVE_INFINITY;

  const cost: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(INF));
  const prevI: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(-2));
  const prevJ: number[][] = Array.from({ length: n }, () => new Array<number>(m).fill(-2));

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      const offset = offsetOf(i, j);
      // From the virtual start: boundaries 0..i-1 all skipped.
      let best = i * skipCost + offset * offset;
      let fromI = -1;
      let fromJ = -1;
      for (let pi = 0; pi < i; pi += 1) {
        for (let pj = 0; pj < j; pj += 1) {
          const base = cost[pi]![pj]!;
          if (base === INF) continue;
          const change = offset - offsetOf(pi, pj);
          const value = base + (i - pi - 1) * skipCost + change * change;
          if (value < best) {
            best = value;
            fromI = pi;
            fromJ = pj;
          }
        }
      }
      cost[i]![j] = best;
      prevI[i]![j] = fromI;
      prevJ[i]![j] = fromJ;
    }
  }

  // Close on the virtual end boundary: offset zero again, plus any trailing
  // skips.
  let best = n * skipCost; // everything skipped
  let endI = -1;
  let endJ = -1;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      const base = cost[i]![j]!;
      if (base === INF) continue;
      const change = -offsetOf(i, j);
      const value = base + (n - i - 1) * skipCost + change * change;
      if (value < best) {
        best = value;
        endI = i;
        endJ = j;
      }
    }
  }

  const out = new Array<number | null>(n).fill(null);
  let i = endI;
  let j = endJ;
  while (i >= 0 && j >= 0) {
    out[i] = candidates[j]!;
    const pi = prevI[i]![j]!;
    const pj = prevJ[i]![j]!;
    i = pi;
    j = pj;
  }
  return out;
}

/** Fill unanchored boundaries proportionally between the anchors around them. */
function interpolate(
  assigned: (number | null)[],
  sentences: StorySentence[],
  speechStartMs: number,
  speechEndMs: number,
): number[] {
  const n = assigned.length;
  const out = new Array<number>(n);
  let cursorIdx = -1;
  let cursorMs = speechStartMs;

  for (let i = 0; i < n; i += 1) {
    if (assigned[i] === null) continue;
    // Sentences cursorIdx+1 .. i share the span between the two anchors.
    let weight = 0;
    for (let k = cursorIdx + 1; k <= i; k += 1) weight += sentences[k]!.weight;
    const span = assigned[i]! - cursorMs;
    let acc = 0;
    for (let k = cursorIdx + 1; k <= i; k += 1) {
      acc += sentences[k]!.weight;
      out[k] = weight > 0 ? cursorMs + (acc / weight) * span : assigned[i]!;
    }
    cursorIdx = i;
    cursorMs = assigned[i]!;
  }

  // The tail, between the last anchor and the end of speech.
  if (cursorIdx < n - 1) {
    let weight = 0;
    for (let k = cursorIdx + 1; k <= n; k += 1) weight += sentences[k]!.weight;
    const span = speechEndMs - cursorMs;
    let acc = 0;
    for (let k = cursorIdx + 1; k < n; k += 1) {
      acc += sentences[k]!.weight;
      out[k] = weight > 0 ? cursorMs + (acc / weight) * span : speechEndMs;
    }
  }
  return out;
}

export function alignSentenceBoundaries(
  sentences: StorySentence[],
  candidateMs: number[],
  speechStartMs: number,
  speechEndMs: number,
  /** Total silence the detector found inside the speech. See below. */
  measuredSilenceMs: number,
): SentenceAlignment | null {
  if (sentences.length === 0) return null;
  const boundaries = sentences.length - 1;
  if (boundaries === 0) {
    return {
      spans: [{ startMs: Math.round(speechStartMs), endMs: Math.round(speechEndMs) }],
      anchoredCount: 0,
      boundaryCount: 0,
    };
  }

  const candidates = candidateMs
    .filter((ms) => ms > speechStartMs && ms < speechEndMs)
    .sort((a, b) => a - b);
  if (candidates.length === 0) return null;

  const totalSyllables = sentences.reduce((s, x) => s + x.syllableWeight, 0);
  const totalPauses = sentences.reduce((s, x) => s + x.pauseWeight, 0);
  if (totalSyllables <= 0) return null;

  /* Where the model puts each boundary, CALIBRATED against this narration.
   *
   * The uncalibrated version was the reason this failed on the first story it
   * was tried against. Guessing what a pause is worth relative to a syllable
   * biases the whole timeline one way, and the bias grows through the story —
   * measured at up to 2.3s by the fourth page. Every candidate then looked like
   * a bad match, and skipping every boundary scored better than matching any.
   *
   * But the split does not have to be guessed. The detector already knows how
   * much of this narration is silence, so the talking time and the pausing time
   * are both measured, and only their distribution across sentences is
   * modelled. */
  const span = speechEndMs - speechStartMs;
  const silenceMs = Math.min(Math.max(measuredSilenceMs, 0), span);
  const msPerSyllable = (span - silenceMs) / totalSyllables;
  const msPerPause = totalPauses > 0 ? silenceMs / totalPauses : 0;

  const expectedFrom = (fromMs: number): number[] => {
    const out: number[] = [];
    let cursor = fromMs;
    for (let i = 0; i < boundaries; i += 1) {
      cursor += sentences[i]!.syllableWeight * msPerSyllable;
      cursor += sentences[i]!.pauseWeight * msPerPause;
      out.push(cursor);
    }
    return out;
  };

  const meanSentenceMs = span / sentences.length;
  const skipCost = (meanSentenceMs * SKIP_COST_SENTENCES) ** 2;

  let expected = expectedFrom(speechStartMs);
  let assigned = assignMonotone(expected, candidates, skipCost);

  /* Second pass, against expectations interpolated between the anchors the
   * first pass found rather than against the bowed model. A boundary the first
   * pass could not place can be picked up once its neighbours are known. */
  expected = interpolate(assigned, sentences, speechStartMs, speechEndMs);
  assigned = assignMonotone(expected, candidates, skipCost);

  const anchoredCount = assigned.filter((x) => x !== null).length;
  if (anchoredCount < Math.ceil(boundaries * MIN_ANCHORED_FRACTION)) return null;

  const times = interpolate(assigned, sentences, speechStartMs, speechEndMs);
  const spans: SentenceAnchors['sentences'] = [];
  let start = speechStartMs;
  for (let i = 0; i < boundaries; i += 1) {
    const end = Math.max(start, times[i]!);
    spans.push({ startMs: Math.round(start), endMs: Math.round(end) });
    start = end;
  }
  spans.push({ startMs: Math.round(start), endMs: Math.round(Math.max(start, speechEndMs)) });
  return { spans, anchoredCount, boundaryCount: boundaries };
}
