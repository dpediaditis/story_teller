/**
 * Finding the narrator's pauses in the audio.
 *
 * The synthesiser gives us no timings, but it does stop between sentences, and
 * a stop is measurable. Measured on a real 68.4s narration of 18 sentences
 * (`ee9f3d7b`, six pages, Bramble): thresholding a 10ms RMS envelope at 2% of
 * peak found 260ms of lead-in, 300ms of run-out, and internal silences that
 * separate cleanly into two groups — 470-890ms at full stops and 120-330ms at
 * commas. Seventeen of the former, for eighteen sentences. Nothing in between.
 *
 * So the boundaries are there to be read, and reading them is free: the
 * pipeline already holds the PCM at the point it uploads the narration, so this
 * costs no download, no provider call and about 40ms of arithmetic.
 *
 * This half owns the audio. The alignment of pauses to sentences is pure and
 * lives in `@papercub/shared` (`alignSentenceBoundaries`), where it is tested.
 */

import {
  alignSentenceBoundaries,
  splitStorySentences,
  splitStoryWords,
} from '@papercub/shared';
import type { StoryWord, WordTimings } from '@papercub/shared';

/** 2% of peak. See the header — measured, not guessed. */
const SILENCE_FRACTION_OF_PEAK = 0.02;
/** RMS window. Short enough to place a boundary, long enough to be stable. */
const FRAME_MS = 10;
/**
 * The shortest gap that counts as a sentence stop.
 *
 * Sits in the empty band between the two measured groups. Too low and every
 * comma becomes a candidate; too high and a stop the narrator hurried is lost.
 * The alignment is a monotone best-fit rather than a threshold count, so extra
 * candidates cost accuracy but do not break it — this is the safer side to err.
 */
const SENTENCE_GAP_MS = 380;
/** Anything above this is silence at the edges rather than a pause within. */
const EDGE_GAP_MS = 150;
/** The shortest gap that is a deliberate pause rather than a stop consonant. */
const PAUSE_GAP_MS = 120;
/**
 * The shortest gap that can pin a clause inside a sentence.
 *
 * Sentence anchors alone left the highlight drifting within a long sentence —
 * the right band, the wrong word. The comma pauses measured at 120-330ms are
 * the obvious next set of pins, and a clause is short enough that whatever is
 * left over is not visible.
 */
const CLAUSE_GAP_MS = 110;

export interface PcmAudio {
  /** Signed 16-bit little-endian mono samples. */
  samples: Int16Array;
  sampleRate: number;
}

export interface DetectedSilence {
  startMs: number;
  endMs: number;
}

/**
 * Reads a WAV we wrote ourselves, but by walking the RIFF chunks rather than
 * assuming a 44-byte header — an assumption that is right until the day
 * something inserts a LIST chunk and every timing in the story shifts.
 */
export function decodeWavPcm(wav: Uint8Array): PcmAudio | null {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (at: number) =>
    String.fromCharCode(wav[at]!, wav[at + 1]!, wav[at + 2]!, wav[at + 3]!);
  if (wav.byteLength < 12 || ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE') return null;

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;

  while (offset + 8 <= wav.byteLength) {
    const id = ascii(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === 'fmt ' && size >= 16) {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      if (bitsPerSample !== 16 || channels !== 1 || sampleRate <= 0) return null;
      const count = Math.floor(Math.min(size, wav.byteLength - body) / 2);
      const samples = new Int16Array(count);
      for (let i = 0; i < count; i += 1) samples[i] = view.getInt16(body + i * 2, true);
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/** Every stretch of near-silence at least `minMs` long. */
export function findSilences(audio: PcmAudio, minMs: number): DetectedSilence[] {
  const frame = Math.max(1, Math.round((audio.sampleRate * FRAME_MS) / 1000));
  const frames: number[] = [];
  for (let i = 0; i + frame <= audio.samples.length; i += frame) {
    let sum = 0;
    for (let j = 0; j < frame; j += 1) {
      const v = audio.samples[i + j]!;
      sum += v * v;
    }
    frames.push(Math.sqrt(sum / frame));
  }
  if (frames.length === 0) return [];

  const peak = Math.max(...frames);
  if (peak <= 0) return [];
  const threshold = peak * SILENCE_FRACTION_OF_PEAK;
  const minFrames = Math.max(1, Math.round(minMs / FRAME_MS));

  const out: DetectedSilence[] = [];
  let run = 0;
  for (let f = 0; f <= frames.length; f += 1) {
    const quiet = f < frames.length && frames[f]! < threshold;
    if (quiet) {
      run += 1;
      continue;
    }
    if (run >= minFrames) {
      out.push({ startMs: (f - run) * FRAME_MS, endMs: f * FRAME_MS });
    }
    run = 0;
  }
  return out;
}

/**
 * Cumulative milliseconds of actual speech up to each frame.
 *
 * Spreading words evenly across elapsed time assumes the narrator talks the
 * whole way through, and they do not — a breath, a stop consonant or a hesitation
 * eats clock without moving the words on. Distributing over VOICED time instead
 * removes that, and it is the difference between a highlight that keeps nudging
 * ahead of the voice and one that sits on it.
 */
interface VoicedClock {
  /** Voiced ms elapsed at `ms`. Monotone, saturating at the end. */
  at(ms: number): number;
  /** The time at which `voicedMs` of speech has happened. */
  timeAt(voicedMs: number): number;
}

function buildVoicedClock(audio: PcmAudio): VoicedClock {
  const frame = Math.max(1, Math.round((audio.sampleRate * FRAME_MS) / 1000));
  const frames: number[] = [];
  for (let i = 0; i + frame <= audio.samples.length; i += frame) {
    let sum = 0;
    for (let j = 0; j < frame; j += 1) {
      const v = audio.samples[i + j]!;
      sum += v * v;
    }
    frames.push(Math.sqrt(sum / frame));
  }
  const peak = frames.length > 0 ? Math.max(...frames) : 0;
  const threshold = peak * SILENCE_FRACTION_OF_PEAK;

  // cumulative[f] = voiced ms before frame f.
  const cumulative = new Float64Array(frames.length + 1);
  for (let f = 0; f < frames.length; f += 1) {
    cumulative[f + 1] = cumulative[f]! + (frames[f]! >= threshold ? FRAME_MS : 0);
  }
  const totalVoiced = cumulative[frames.length]!;

  return {
    at(ms) {
      const f = Math.max(0, Math.min(frames.length, Math.round(ms / FRAME_MS)));
      return cumulative[f]!;
    },
    timeAt(voicedMs) {
      const target = Math.max(0, Math.min(totalVoiced, voicedMs));
      let lo = 0;
      let hi = frames.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid]! < target) lo = mid + 1;
        else hi = mid;
      }
      return lo * FRAME_MS;
    },
  };
}

/**
 * How near a word boundary must be to a pause before it is snapped onto it.
 *
 * Measured across seven real narrations, against two metrics — how far a
 * within-sentence pause sits from the nearest word boundary, and whether word
 * durations still look like their syllable counts:
 *
 *   no snapping   156ms   p95 relative duration error 1.48
 *   180ms          105ms   1.49
 *   340ms           63ms   1.51
 *   420ms           49ms   1.51
 *
 * Distortion is flat the whole way, so the snapping is finding real boundaries
 * rather than bending the timeline to fit. It keeps improving past 340ms, and
 * 340 is where it stops being defensible anyway: a word averages about 300ms
 * here, so beyond roughly one word the nearest boundary is no longer obviously
 * the right one. The last 14ms is below anything a reader would see.
 */
const SNAP_TOLERANCE_MS = 340;

/**
 * Place every word between two known times.
 *
 * Two things happen here, and the second is why the first is not enough.
 *
 * Words are laid out on the VOICED clock — time in which the narrator is
 * actually speaking — so a breath or a stop consonant does not push the
 * highlight forward while nothing is being said.
 *
 * Then every pause inside the span pulls the nearest word boundary onto it. On
 * its own the voiced clock does not do this: it removes silence from the budget
 * but leaves boundaries wherever the syllable fractions happen to land, and
 * measured against the narrator's own pauses it was worse than the model it
 * replaced (156ms vs 118ms mean error). A pause is the one moment in a sentence
 * where we know for certain that one word has finished and the next has not
 * started, which makes it the strongest evidence available short of a phoneme
 * model.
 */
function placeWords(
  words: StoryWord[],
  startMs: number,
  endMs: number,
  clock: VoicedClock,
  pauses: DetectedSilence[],
  out: Map<number, { i: number; s: number; e: number }>,
): void {
  if (words.length === 0) return;

  const totalSyllables = words.reduce((sum, w) => sum + w.syllableWeight, 0);
  const voicedStart = clock.at(startMs);
  const voicedSpan = clock.at(endMs) - voicedStart;

  // Boundary k sits between word k and word k+1; there are words.length - 1.
  const boundaries: number[] = [];
  if (totalSyllables > 0 && voicedSpan > 0) {
    let acc = 0;
    for (let k = 0; k < words.length - 1; k += 1) {
      acc += words[k]!.syllableWeight;
      boundaries.push(clock.timeAt(voicedStart + (acc / totalSyllables) * voicedSpan));
    }
  } else {
    const step = (endMs - startMs) / words.length;
    for (let k = 0; k < words.length - 1; k += 1) boundaries.push(startMs + (k + 1) * step);
  }

  /* Snap to the narrator's pauses. Each pause claims the nearest free boundary,
   * nearest pause first, so a boundary is never stolen by a worse match. */
  const inSpan = pauses
    .filter((p) => p.startMs > startMs && p.endMs < endMs)
    .map((p) => ({ ...p, distance: Number.POSITIVE_INFINITY, at: -1 }));
  for (const pause of inSpan) {
    for (let k = 0; k < boundaries.length; k += 1) {
      const distance = Math.abs(boundaries[k]! - pause.startMs);
      if (distance < pause.distance) {
        pause.distance = distance;
        pause.at = k;
      }
    }
  }
  const snapped = new Map<number, DetectedSilence>();
  for (const pause of inSpan.sort((a, b) => a.distance - b.distance)) {
    if (pause.at < 0 || pause.distance > SNAP_TOLERANCE_MS) continue;
    if (snapped.has(pause.at)) continue;
    snapped.set(pause.at, pause);
  }

  let cursor = startMs;
  words.forEach((w, k) => {
    const isLast = k === words.length - 1;
    const pause = snapped.get(k);
    let end: number;
    if (isLast) end = endMs;
    else if (pause) end = pause.startMs;
    else end = boundaries[k]!;
    // Monotone whatever the snapping did.
    end = Math.min(endMs, Math.max(cursor, end));
    out.set(w.index, { i: w.index, s: Math.round(cursor), e: Math.round(end) });
    // A word does not begin during the silence before it.
    cursor = pause ? Math.min(endMs, Math.max(end, pause.endMs)) : end;
  });
}

/**
 * Sentence boundaries for one story's narration, or null if the audio does not
 * support them.
 *
 * Returning null is a real outcome, not a failure: a narration with too few
 * detectable stops is better served by the model in `@papercub/shared` than by
 * an alignment forced onto the wrong pauses. The caller stores nothing and the
 * reader falls back.
 */
export interface NarrationAlignment {
  timings: WordTimings;
  /** Sentence boundaries placed on a measured pause, of `boundaryCount`. */
  anchoredCount: number;
  boundaryCount: number;
  /** Clause boundaries also pinned to a pause inside a sentence. */
  clauseAnchoredCount: number;
}

export function alignNarration(
  wav: Uint8Array,
  pages: { index: number; text: string }[],
  durationMs: number,
): NarrationAlignment | null {
  const audio = decodeWavPcm(wav);
  if (!audio) return null;

  const sentences = splitStorySentences(pages);
  if (sentences.length === 0) return null;

  const edges = findSilences(audio, EDGE_GAP_MS);
  // Lead-in and run-out, so the first word does not start at 0 and the last is
  // not stretched across the tail.
  const first = edges[0];
  const last = edges[edges.length - 1];
  const speechStartMs = first && first.startMs <= 20 ? first.endMs : 0;
  const speechEndMs =
    last && last.endMs >= durationMs - 20 ? last.startMs : durationMs;
  if (speechEndMs <= speechStartMs) return null;

  // A boundary is placed at the END of the pause: the next sentence starts
  // when the voice comes back, and that is when the page should have turned.
  const inside = (s: DetectedSilence) => s.startMs > speechStartMs && s.endMs < speechEndMs;
  const candidates = findSilences(audio, SENTENCE_GAP_MS).filter(inside).map((s) => s.endMs);

  /* How much of this narration is silence, measured. Commas count: the point is
   * to tell the aligner how much of the clock is not speech, so it stops
   * guessing what a pause is worth. */
  const measuredSilenceMs = findSilences(audio, PAUSE_GAP_MS)
    .filter(inside)
    .reduce((total, s) => total + (s.endMs - s.startMs), 0);

  const alignment = alignSentenceBoundaries(
    sentences,
    candidates,
    speechStartMs,
    speechEndMs,
    measuredSilenceMs,
  );
  if (!alignment) return null;

  /* Sentence spans are measured. Now go one level finer.
   *
   * Every comma-length pause inside a sentence is another pin, and between
   * pins the words are laid out on the voiced clock rather than on the wall
   * clock. Sentence anchors alone were audibly better but still drifted within
   * a long sentence, which is exactly the span this closes. */
  const clock = buildVoicedClock(audio);
  const clausePauses = findSilences(audio, CLAUSE_GAP_MS).filter(inside);
  const wordsByPage = splitStoryWords(pages);
  const placed = new Map<number, Map<number, { i: number; s: number; e: number }>>();
  let clauseAnchoredCount = 0;

  sentences.forEach((sentence, sentenceOrder) => {
    const span = alignment.spans[sentenceOrder]!;
    const page = wordsByPage.find((p) => p.pageIndex === sentence.pageIndex);
    if (!page) return;
    const words = page.words.filter((w) => w.sentenceIndex === sentence.sentenceIndex);
    if (words.length === 0) return;
    const out = placed.get(sentence.pageIndex) ?? new Map();
    placed.set(sentence.pageIndex, out);

    // Split the sentence at its clause-ending words, and pin each split to the
    // nearest pause the narrator actually took inside this sentence.
    const clauseEnds: number[] = [];
    words.forEach((w, k) => {
      if (w.endsClause && k < words.length - 1) clauseEnds.push(k);
    });

    const inSentence = clausePauses
      .filter((p) => p.startMs > span.startMs && p.endMs < span.endMs)
      .map((p) => p.endMs);

    let cursorMs = span.startMs;
    let cursorWord = 0;
    for (const endIndex of clauseEnds) {
      // Where the syllable model puts this clause end, then the nearest pause.
      const before = words.slice(cursorWord, endIndex + 1);
      const remaining = words.slice(cursorWord);
      const beforeSyll = before.reduce((sum, w) => sum + w.syllableWeight, 0);
      const remainingSyll = remaining.reduce((sum, w) => sum + w.syllableWeight, 0);
      if (remainingSyll <= 0) break;
      const voicedFrom = clock.at(cursorMs);
      const voicedTo = clock.at(span.endMs);
      const expectedMs = clock.timeAt(
        voicedFrom + (beforeSyll / remainingSyll) * (voicedTo - voicedFrom),
      );

      let pinMs: number | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const pause of inSentence) {
        if (pause <= cursorMs || pause >= span.endMs) continue;
        const distance = Math.abs(pause - expectedMs);
        // Half a clause. Beyond that it is somebody else's pause.
        if (distance < bestDistance && distance < (span.endMs - span.startMs) / 2) {
          bestDistance = distance;
          pinMs = pause;
        }
      }
      if (pinMs === null) continue;

      placeWords(before, cursorMs, pinMs, clock, clausePauses, out);
      cursorMs = pinMs;
      cursorWord = endIndex + 1;
      clauseAnchoredCount += 1;
    }

    placeWords(words.slice(cursorWord), cursorMs, span.endMs, clock, clausePauses, out);
  });

  const timings: WordTimings = {
    version: 2,
    kind: 'word_timings',
    durationMs,
    pages: wordsByPage.map((page) => ({
      p: page.pageIndex,
      w: page.words
        .map((w) => placed.get(page.pageIndex)?.get(w.index))
        .filter((t): t is { i: number; s: number; e: number } => t !== undefined),
    })),
  };

  return {
    timings,
    anchoredCount: alignment.anchoredCount,
    boundaryCount: alignment.boundaryCount,
    clauseAnchoredCount,
  };
}
