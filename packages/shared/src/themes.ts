import type { StoryTheme } from './enums.ts';

/**
 * A picture for each place a story can go.
 *
 * The picker showed six flat colour squares with a word underneath — legible to
 * a parent, meaningless to the four-year-old who is supposed to be choosing.
 * "Where should Pixel go?" answered with a navy rectangle is not a choice a
 * child can make.
 *
 * System emoji for the same reasons as the narration voices (VoiceCreature.tsx)
 * and the child avatars (avatars.ts): rendering the platform font is not
 * redistribution, so there is no bundled asset, no licence to carry, and
 * nothing that can fail to load. Colour still carries the theme — this sits ON
 * the existing tile fill rather than replacing it.
 */
export const STORY_THEME_EMOJI: Record<StoryTheme, string> = {
  space: '\u{1F680}',
  dinosaurs: '\u{1F996}',
  underwater: '\u{1F420}',
  magic: '\u2728',
  pirates: '\u{1F3F4}\u200D\u2620\uFE0F',
  jungle: '\u{1F334}',
};
