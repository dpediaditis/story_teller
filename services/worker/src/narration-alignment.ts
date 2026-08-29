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

import { alignSentenceBoundaries, splitStorySentences } from '@papercub/shared';
import type { SentenceAnchors } from '@papercub/shared';

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
 * Sentence boundaries for one story's narration, or null if the audio does not
 * support them.
 *
 * Returning null is a real outcome, not a failure: a narration with too few
 * detectable stops is better served by the model in `@papercub/shared` than by
 * an alignment forced onto the wrong pauses. The caller stores nothing and the
 * reader falls back.
 */
export interface NarrationAlignment {
  anchors: SentenceAnchors;
  /** Boundaries placed on a measured pause, of `boundaryCount` total. */
  anchoredCount: number;
  boundaryCount: number;
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

  return {
    anchors: { version: 1, kind: 'sentence_anchors', durationMs, sentences: alignment.spans },
    anchoredCount: alignment.anchoredCount,
    boundaryCount: alignment.boundaryCount,
  };
}
