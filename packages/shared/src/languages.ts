import { z } from 'zod';

/**
 * The languages a story can be written and read aloud in.
 *
 * A language is NOT a premium feature. A family whose child speaks German
 * should not have to pay to use the product at all — that is accessibility, not
 * a luxury, and the free story is worthless to them in a language they do not
 * read. Premium stays about the voice CHARACTERS (voices.ts), which work in
 * every language: measured against the live API, one Gemini voice speaks
 * English, Spanish, German and French, so the cast does not change with the
 * locale.
 *
 * Picking a language changes the STORY, not just the narration. `locale`
 * reaches the writer prompt, so the text is composed in that language and the
 * narration follows from it — never an English story read in a French accent.
 */
export const StoryLocale = z.enum(['en-GB', 'es-ES', 'de-DE', 'fr-FR', 'it-IT', 'el-GR', 'nl-NL']);
export type StoryLocale = z.infer<typeof StoryLocale>;

export const DEFAULT_STORY_LOCALE: StoryLocale = 'en-GB';

/**
 * How the reading-level gate has to bend for each language.
 *
 * This exists because the gate was calibrated on English and its verdict is
 * REFUNDABLE — `reading_level_failed` fails the story and gives the quota back.
 * So a mis-calibrated threshold does not merely nag: it makes the product
 * silently impossible in that language, one refunded story at a time.
 *
 * Two signals, treated differently:
 *
 *  - Sentence length travels reasonably well, but not perfectly. Romance
 *    languages spend more words on the same sentence (articles, prepositions,
 *    clitics), so the same idea runs longer in Spanish than in English.
 *  - The long-word ratio does NOT travel. German and Dutch build compounds as a
 *    matter of course, and Greek is richly polysyllabic; the English threshold
 *    of "6% of words have 4+ syllables" is normal prose there, not dense prose.
 *
 * Where the long-word signal is not calibrated it is DISABLED (`null`) rather
 * than guessed at. A disabled check is an honest gap; an invented number is a
 * refund machine. Sentence length still catches the gross failure the gate
 * exists for — adult prose in a book for a five-year-old.
 */
export interface LanguageReadingProfile {
  /** Multiplier on the English mean/longest sentence limits. */
  sentenceLengthFactor: number;
  /** Multiplier on the English long-word ratio, or null when uncalibrated. */
  longWordRatioFactor: number | null;
}

export interface StoryLanguage {
  locale: StoryLocale;
  /** Shown in the picker, in the language itself — never translated. */
  displayName: string;
  /** BCP-47 base, for anything that wants the language without the region. */
  language: string;
  reading: LanguageReadingProfile;
}

export const STORY_LANGUAGES: Record<StoryLocale, StoryLanguage> = {
  'en-GB': {
    locale: 'en-GB',
    displayName: 'English',
    language: 'en',
    // The baseline the thresholds in reading-level.ts were written against.
    reading: { sentenceLengthFactor: 1, longWordRatioFactor: 1 },
  },
  'es-ES': {
    locale: 'es-ES',
    displayName: 'Español',
    language: 'es',
    // More words per sentence than English, and more syllables per word, but
    // both in a way that is at least consistent.
    reading: { sentenceLengthFactor: 1.2, longWordRatioFactor: 2 },
  },
  'fr-FR': {
    locale: 'fr-FR',
    displayName: 'Français',
    language: 'fr',
    reading: { sentenceLengthFactor: 1.2, longWordRatioFactor: 1.8 },
  },
  'it-IT': {
    locale: 'it-IT',
    displayName: 'Italiano',
    language: 'it',
    reading: { sentenceLengthFactor: 1.2, longWordRatioFactor: 2 },
  },
  'de-DE': {
    locale: 'de-DE',
    displayName: 'Deutsch',
    language: 'de',
    // Compounding makes the long-word ratio meaningless as an English-derived
    // number: "Überraschungsgeschichte" is one ordinary word to a German child.
    // Fewer, longer words also means fewer words per sentence.
    reading: { sentenceLengthFactor: 0.9, longWordRatioFactor: null },
  },
  'nl-NL': {
    locale: 'nl-NL',
    displayName: 'Nederlands',
    language: 'nl',
    // Compounds like German.
    reading: { sentenceLengthFactor: 0.95, longWordRatioFactor: null },
  },
  'el-GR': {
    locale: 'el-GR',
    displayName: 'Ελληνικά',
    language: 'el',
    // Richly polysyllabic, and a different script — the syllable heuristic is
    // Unicode-aware now but has never been checked against real Greek prose.
    reading: { sentenceLengthFactor: 1.1, longWordRatioFactor: null },
  },
};

export const STORY_LANGUAGE_LIST: StoryLanguage[] = Object.values(STORY_LANGUAGES);

/** Every language is available on every tier. See the header. */
export function isLocaleAllowedForTier(_locale: StoryLocale, _tier: 'free' | 'family'): boolean {
  return true;
}
