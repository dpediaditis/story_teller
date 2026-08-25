/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  STRUCTURAL PRIVACY BOUNDARY — DECISIONS.md §10. Read before editing.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two rules are enforced by TYPES here, not by discipline:
 *
 *  1. A child's display name must NEVER reach an AI provider prompt.
 *     `StoryPromptInput` / `IllustrationPromptInput` have no field capable of
 *     carrying it. `ChildDisplayName` is branded and structurally incompatible
 *     with every field here, so passing one near a prompt is a COMPILE ERROR,
 *     not a code-review catch.
 *
 *  2. A character name is user free text that DOES reach a prompt. It is
 *     therefore `UntrustedText` and may only be interpolated via
 *     `renderUntrusted()`, which emits it inside a delimited data block the
 *     system prompt declares inert.
 *
 * DO NOT add a `childName`, `displayName`, `kidName` or free-form `notes` field
 * to any type in this file. If you need one, you have misunderstood the product.
 */

import type { AgeBand, StoryTheme, StoryMood, StoryLength, RenderTechnique } from './enums.ts';

declare const CHILD_NAME_BRAND: unique symbol;
declare const UNTRUSTED_BRAND: unique symbol;

/**
 * A child's display name. Stored in our DB, rendered in OUR UI only
 * ("A STORY BY MIA"). Branded so it cannot be assigned to any prompt field.
 */
export type ChildDisplayName = string & { readonly [CHILD_NAME_BRAND]: true };

export function asChildDisplayName(raw: string): ChildDisplayName {
  return raw as ChildDisplayName;
}

/** The ONLY sanctioned way to turn a child name back into a renderable string. */
export function renderInOurUiOnly(name: ChildDisplayName): string {
  return name as string;
}

/** User-supplied free text that will reach a model. Data, never instruction. */
export type UntrustedText = string & { readonly [UNTRUSTED_BRAND]: true };

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)/i,
  /disregard\s+(the\s+)?(instructions|rules|system)/i,
  /system\s*(prompt|message|role)\s*[:=]/i,
  /\byou\s+are\s+now\b/i,
  /<\/?\s*(system|assistant|user|instruction)s?\s*>/i,
  /[`]{3}/,
  /\[\[?\s*\/?\s*(inst|sys)\b/i,
];

export const UNTRUSTED_TEXT_MAX_LENGTH = 40;

export type UntrustedTextResult =
  | { ok: true; value: UntrustedText }
  | { ok: false; reason: 'too_long' | 'empty' | 'injection_pattern' | 'disallowed_characters' };

/**
 * Control characters, zero-width and bidi-override characters, and markup
 * delimiters are never legitimate in a character name. Bidi overrides matter
 * specifically: they can make a rendered name differ from the bytes we send to
 * a provider. Written as code-point checks rather than a regex character class
 * so no control character ever appears literally in this source file.
 */
function hasDisallowedChars(value: string): boolean {
  for (const ch of value) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || c === 0x7f) return true;      // C0 controls + DEL
    if (c >= 0x200b && c <= 0x200f) return true;  // zero-width + LTR/RTL marks
    if (c >= 0x2028 && c <= 0x202e) return true;  // line/para sep + bidi overrides
    if (c >= 0x2066 && c <= 0x2069) return true;  // bidi isolates
    if (ch === '<' || ch === '>' || ch === '{' || ch === '}') return true;
  }
  return false;
}

/**
 * Normalise + validate a user string before it may be used in a prompt.
 * Rejection here is a `name_rejected` ModerationEvent, not a silent strip.
 */
export function asUntrustedText(raw: string): UntrustedTextResult {
  const value = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (value.length === 0) return { ok: false, reason: 'empty' };
  if (value.length > UNTRUSTED_TEXT_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  if (hasDisallowedChars(value)) return { ok: false, reason: 'disallowed_characters' };
  if (INJECTION_PATTERNS.some((p) => p.test(value))) {
    return { ok: false, reason: 'injection_pattern' };
  }
  return { ok: true, value: value as UntrustedText };
}

/**
 * The ONLY permitted way to place untrusted text into a prompt. The system
 * prompt must carry the matching instruction (SYSTEM_DATA_RULE in the worker's
 * prompt-builder).
 */
export function renderUntrusted(label: string, value: UntrustedText): string {
  return `<papercub:data field="${label}">${value}</papercub:data>`;
}

/* ── Prompt inputs. Note the absence of any child-identifying field. ────── */

export interface PromptSafeCharacter {
  /** Stable id for reference-asset lookup and logging. Not sent verbatim. */
  characterId: string;
  /** User free text. Data, never instruction. */
  name: UntrustedText;
  characterType: UntrustedText | null;
  /** Parent-approved trait strings. */
  personalityTraits: UntrustedText[];
  /** Textual feature anchor from the vision pass. */
  featureAnchor: string;
  /** Hex colours extracted on-device from the cut-out. */
  palette: string[];
  /** storage_keys of the CharacterAssets to pass as image references. */
  referenceAssetKeys: string[];
}

/**
 * Complete input to the story writer. There is no field here — and there must
 * never be a field here — that can carry a child's display name.
 */
export interface StoryPromptInput {
  readonly kind: 'story';
  /** Drives vocabulary and sentence length only. Never a birth date. */
  ageBand: AgeBand;
  theme: StoryTheme;
  mood: StoryMood;
  length: StoryLength;
  pageCount: number;
  characters: PromptSafeCharacter[];
  /** v1.2 canon injection. Empty array in MVP. */
  worldFacts: readonly string[];
  locale: string;
}

export interface IllustrationPromptInput {
  readonly kind: 'illustration';
  technique: RenderTechnique;
  /** Self-contained: no pronoun references to other pages. */
  sceneDescription: string;
  characters: PromptSafeCharacter[];
  aspectRatio: string;
  seed: number | null;
  isCover: boolean;
}

export type PromptInput = StoryPromptInput | IllustrationPromptInput;
