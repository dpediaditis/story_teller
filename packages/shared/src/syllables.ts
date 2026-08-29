/**
 * Vowel-group syllable count. Crude, and adequate: it is used only as a
 * relative signal — "is this word long" for the reading-level gate, "how long
 * does this word take to say" for the narration timeline — and never reported
 * as a linguistic fact.
 *
 * Unicode-aware. Stripping to `[a-z]` would turn "más" into "ms" and count it
 * as one syllable, and would erase a Greek word entirely, so every accented
 * language would look artificially simple. NFD decomposition splits an accented
 * letter into its base plus a combining mark, so removing marks leaves the base
 * vowel behind and the count survives.
 *
 * Lives here rather than in `services/worker` because two packages now need it
 * and CLAUDE.md's import rule means shared code goes through the package root.
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
