import type { GenerationStage } from '@papercub/shared';

/**
 * The app owns all copy (CLAUDE.md "Error handling"): the server sends a
 * `copyKey`, never a sentence, and this is where every copyKey resolves.
 * `characterName` is interpolated where the design shows a name — always the
 * user's own free-text Character.name, never a ChildDisplayName.
 */

/** `generation.stage.<value>` — rendered from GenerationStage, never invented. */
export function generationStageCopy(stage: GenerationStage, characterName: string): string {
  switch (stage) {
    case 'queued':
      return 'Getting ready…';
    case 'moderating_input':
      return 'Looking at the drawing…';
    case 'analysing_drawing':
      return 'Looking at the drawing…';
    case 'building_character_refs':
      return `Getting to know ${characterName}…`;
    case 'validating_request':
      return 'Getting ready…';
    case 'writing_story':
      return `Writing ${characterName}'s story`;
    case 'moderating_text':
      return 'Checking the story…';
    case 'illustrating_cover':
      return 'Drawing the cover';
    case 'illustrating_pages':
      return 'Colouring the pages…';
    case 'moderating_images':
      return 'Checking the pictures…';
    case 'narrating':
      return 'Recording the voice';
    case 'assembling':
      return 'Binding the book';
    case 'done':
      return 'Ready.';
    default:
      return 'Working on it…';
  }
}

/** Ordered stage list the Generating screen (C3) renders as done/current/upcoming. */
export const GENERATION_STAGE_ORDER: GenerationStage[] = [
  'queued',
  'moderating_input',
  'analysing_drawing',
  'building_character_refs',
  'validating_request',
  'writing_story',
  'moderating_text',
  'illustrating_cover',
  'illustrating_pages',
  'moderating_images',
  'narrating',
  'assembling',
  'done',
];

/** `error.<code>` — never render ApiError.message. */
const DEFAULT_ERROR_COPY = 'Something went wrong. Let’s try again.';

const ERROR_COPY: Record<string, string> = {
  'error.quota_exceeded.free': "You've used your free story.",
  'error.quota_exceeded.family': "That's all your stories for this period.",
  'error.cost_ceiling_exceeded': "We've hit today's limit — try again shortly.",
  'error.entitlement_required': 'This needs the full plan.',
  'error.rate_limited': 'Too many tries — take a short break and try again.',
  'error.moderation_blocked.input_image': "Let's try a different drawing.",
  'error.moderation_blocked.input_text': "Let's try a different word.",
  'error.moderation_blocked.output_text': "That one didn't finish.",
  'error.moderation_blocked.output_image': "That one didn't finish.",
  'error.upstream_unavailable': "That one didn't finish.",
  'error.service_halted': "We're taking a short break. Try again soon.",
  'error.not_found': "We couldn't find that.",
  'error.validation_failed': "Something wasn't quite right — let's try again.",
  'error.internal': "That one didn't finish.",
};

export function errorCopy(copyKey: string | undefined): string {
  if (!copyKey) return DEFAULT_ERROR_COPY;
  return ERROR_COPY[copyKey] ?? DEFAULT_ERROR_COPY;
}
