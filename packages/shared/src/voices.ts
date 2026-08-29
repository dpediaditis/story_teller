import { z } from 'zod';

/**
 * The narration voices, and which tier each one belongs to.
 *
 * Papercub voice ids are OUR ids, never a provider's. A narration is generated
 * once and cached forever (docs/ARCHITECTURE.md), so the id stored on
 * `narrations.voice_id` outlives any particular vendor — services/worker maps
 * these to whatever the current provider calls them, and swapping provider must
 * not rewrite a single stored row. That mapping lives in the adapters
 * (`GEMINI_VOICE_IDS`, `OPENAI_VOICE_IDS`), not here: this file is contract, and
 * `packages/shared` may not know a provider exists.
 *
 * `tier` is the ENTITLEMENT, and it is declared here so the client can render a
 * lock — NOT so the client can enforce one. DECISIONS.md §8: "Client never
 * asserts entitlement." `claim_story_quota` re-checks the tier in SQL, exactly
 * as it already does for story length, and that check is the real gate.
 *
 * Names are deliberately not real-person names and carry no gender: a voice a
 * child hears every night should be a character in the product, not an
 * impersonation of somebody.
 */
export const NarrationVoiceId = z.enum([
  'papercub_default',
  'papercub_bramble',
  'papercub_pip',
  'papercub_juniper',
  'papercub_marlow',
  'papercub_fig',
]);
export type NarrationVoiceId = z.infer<typeof NarrationVoiceId>;

export interface NarrationVoice {
  id: NarrationVoiceId;
  /** What the app shows. The provider's codename never reaches a screen. */
  displayName: string;
  /** One short line, for the picker. Describes the READING, not the person. */
  description: string;
  /** 'free' is available to everyone. 'family' needs an active subscription. */
  tier: 'free' | 'family';
}

/**
 * Exactly ONE free voice, deliberately. The free tier is a single short story
 * (DECISIONS.md §1), so a voice picker on it would be choice without
 * consequence — and the premium voices are worth more as something a family
 * unlocks than as something they sampled once and forgot.
 */
export const NARRATION_VOICES: Record<NarrationVoiceId, NarrationVoice> = {
  papercub_default: {
    id: 'papercub_default',
    displayName: 'Ivy',
    description: 'Warm and steady',
    tier: 'free',
  },
  papercub_bramble: {
    id: 'papercub_bramble',
    displayName: 'Bramble',
    description: 'Gentle, for winding down',
    tier: 'family',
  },
  papercub_pip: {
    id: 'papercub_pip',
    displayName: 'Pip',
    description: 'Bright and playful',
    tier: 'family',
  },
  papercub_juniper: {
    id: 'papercub_juniper',
    displayName: 'Juniper',
    description: 'Soft and hushed',
    tier: 'family',
  },
  papercub_marlow: {
    id: 'papercub_marlow',
    displayName: 'Marlow',
    description: 'Smooth, an old-fashioned storyteller',
    tier: 'family',
  },
  papercub_fig: {
    id: 'papercub_fig',
    displayName: 'Fig',
    description: 'Quick and funny',
    tier: 'family',
  },
};

/** The voice used when none is chosen, and the only one the free tier allows. */
export const DEFAULT_NARRATION_VOICE_ID: NarrationVoiceId = 'papercub_default';

export const NARRATION_VOICE_LIST: NarrationVoice[] = Object.values(NARRATION_VOICES);

/**
 * Is this voice available on this tier?
 *
 * Used by the client to draw a lock and by the server to refuse one. Both call
 * the same function so they can never disagree about which voices are free —
 * a disagreement there is either a paywall that leaks or a lock the user cannot
 * explain.
 */
export function isVoiceAllowedForTier(
  voiceId: NarrationVoiceId,
  tier: 'free' | 'family',
): boolean {
  return tier === 'family' || NARRATION_VOICES[voiceId].tier === 'free';
}
