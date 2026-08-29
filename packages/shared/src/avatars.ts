import { z } from 'zod';

/**
 * The pictures a parent can put next to a child's name.
 *
 * System emoji, for the same reasons as the narration voices
 * (features/create/VoiceCreature.tsx): rendering text in the platform font is
 * not redistribution, so there is nothing to bundle, nothing to attribute, and
 * no asset that can fail to load. The bundled alternatives both carry a licence
 * obligation — Twemoji is CC BY 4.0 (attribution notice in-app), OpenMoji is
 * CC BY-SA 4.0 (ShareAlike, which nobody wants attached to a commercial kids'
 * product).
 *
 * Eight rather than four: with two children in one family, four options make a
 * collision likely, and two siblings showing the same picture defeats the point
 * of having one. Eight still fits a single row.
 *
 * DECISIONS.md §10: parent-chosen, never derived from the child, and never sent
 * to a provider — it lives beside a display name that already never leaves our
 * own UI.
 */
export const ChildAvatar = z.enum([
  'fox',
  'rabbit',
  'panda',
  'frog',
  'unicorn',
  'octopus',
  'bee',
  'turtle',
]);
export type ChildAvatar = z.infer<typeof ChildAvatar>;

export const CHILD_AVATAR_EMOJI: Record<ChildAvatar, string> = {
  fox: '🦊',
  rabbit: '🐰',
  panda: '🐼',
  frog: '🐸',
  unicorn: '🦄',
  octopus: '🐙',
  bee: '🐝',
  turtle: '🐢',
};

export const CHILD_AVATAR_LIST: ChildAvatar[] = ChildAvatar.options;
