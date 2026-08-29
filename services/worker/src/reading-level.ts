/**
 * The reading-level half of moderation gate 3.
 *
 * docs/ARCHITECTURE.md: `moderating_text` is "gate 3 + reading level vs
 * age_band". A story that is safe but written at the wrong level is still a
 * failed story for a 4-year-old, and the whole point of carrying an AgeBand
 * (DECISIONS.md §10 — a band, never a birth date) is that it changes the text.
 *
 * Deterministic on purpose: this runs on every page of every story, so it must
 * not be a paid model call, and its verdict must be reproducible when someone
 * asks why a story failed.
 *
 * The thresholds are generous. This is a guard against the writer model
 * ignoring the age instruction wholesale — long dense adult prose in a book for
 * a five-year-old — not a style critic. A false positive here costs a real
 * story and a refund, so it is tuned to catch the gross failure only.
 */

import type { AgeBand, StoryLocale } from '@papercub/shared';
import { DEFAULT_STORY_LOCALE, STORY_LANGUAGES } from '@papercub/shared';

export interface ReadingLevelThresholds {
  /** Mean words per sentence across the page. */
  maxMeanWordsPerSentence: number;
  /** Longest single sentence, in words. */
  maxWordsInAnySentence: number;
  /** Share of words with 4+ syllables. Long words are the strongest signal. */
  maxLongWordRatio: number;
}

export const READING_LEVEL: Record<AgeBand, ReadingLevelThresholds> = {
  '4_5': { maxMeanWordsPerSentence: 12, maxWordsInAnySentence: 18, maxLongWordRatio: 0.06 },
  '6_7': { maxMeanWordsPerSentence: 16, maxWordsInAnySentence: 24, maxLongWordRatio: 0.1 },
  '8_plus': { maxMeanWordsPerSentence: 21, maxWordsInAnySentence: 32, maxLongWordRatio: 0.16 },
};

export interface ReadingLevelResult {
  ok: boolean;
  meanWordsPerSentence: number;
  longestSentenceWords: number;
  longWordRatio: number;
  failures: string[];
}

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?…]+[\s"'”’)\]]*/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function words(text: string): string[] {
  return text.split(/[^\p{L}\p{N}'’-]+/u).filter((w) => w.length > 0);
}

/**
 * Vowel-group syllable count. Crude, and adequate: it is used only as a
 * relative "is this word long" signal, never reported as a linguistic fact.
 *
 * Unicode-aware, which it was not. It used to strip to `[a-z]`, so "más"
 * became "ms" and counted as one syllable, and a Greek word was erased
 * entirely and counted as one. Every accented language therefore looked
 * artificially SIMPLE — the opposite of the failure the gate guards against,
 * and invisible because the number it produced was still plausible.
 *
 * NFD decomposition splits an accented letter into its base plus a combining
 * mark, so stripping marks leaves the base vowel behind and the count survives.
 */
const VOWELS = /[aeiouyαεηιουω]+/g;

export function syllableCount(word: string): number {
  const w = word
    .toLowerCase()
    .normalize('NFD')
    // Strip combining marks (accents, tonos, diaeresis) but keep the letters.
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}]/gu, '');
  if (w.length === 0) return 1;
  const groups = w.match(VOWELS);
  let n = groups ? groups.length : 1;
  // English silent-e. Harmless elsewhere: a trailing 'e' that follows a
  // consonant is not a syllable in French either.
  if (w.length > 2 && w.endsWith('e') && !/[aeiouy]e$/.test(w)) n -= 1;
  return Math.max(1, n);
}

export function checkReadingLevel(
  text: string,
  ageBand: AgeBand,
  locale: StoryLocale = DEFAULT_STORY_LOCALE,
): ReadingLevelResult {
  const base = READING_LEVEL[ageBand];
  const profile = (STORY_LANGUAGES[locale] ?? STORY_LANGUAGES[DEFAULT_STORY_LOCALE]).reading;
  const limits: ReadingLevelThresholds = {
    maxMeanWordsPerSentence: base.maxMeanWordsPerSentence * profile.sentenceLengthFactor,
    maxWordsInAnySentence: base.maxWordsInAnySentence * profile.sentenceLengthFactor,
    maxLongWordRatio: base.maxLongWordRatio * (profile.longWordRatioFactor ?? 1),
  };
  const sentences = splitSentences(text);
  const allWords = words(text);
  const failures: string[] = [];

  if (sentences.length === 0 || allWords.length === 0) {
    return {
      ok: false,
      meanWordsPerSentence: 0,
      longestSentenceWords: 0,
      longWordRatio: 0,
      failures: ['empty_text'],
    };
  }

  const sentenceLengths = sentences.map((s) => words(s).length);
  const meanWordsPerSentence = allWords.length / sentences.length;
  const longestSentenceWords = Math.max(...sentenceLengths);
  const longWords = allWords.filter((w) => syllableCount(w) >= 4).length;
  const longWordRatio = longWords / allWords.length;

  if (meanWordsPerSentence > limits.maxMeanWordsPerSentence) failures.push('mean_sentence_length');
  if (longestSentenceWords > limits.maxWordsInAnySentence) failures.push('longest_sentence');
  /* Only where the threshold means something. In a compounding language the
   * English-derived number is ordinary prose, not dense prose, and this verdict
   * is REFUNDABLE — a wrong threshold here does not nag, it makes the product
   * quietly impossible in that language, one refunded story at a time. A
   * disabled check is an honest gap; an invented number is a refund machine. */
  if (profile.longWordRatioFactor !== null && longWordRatio > limits.maxLongWordRatio) {
    failures.push('long_word_ratio');
  }

  return {
    ok: failures.length === 0,
    meanWordsPerSentence,
    longestSentenceWords,
    longWordRatio,
    failures,
  };
}
