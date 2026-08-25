/**
 * The four moderation gates. Every verdict — pass, flag or block — is written
 * to `moderation_events`. That table is the append-only answer to App Review's
 * safety question, and a gate that only writes its blocks makes it impossible
 * to show later that anything was ever checked.
 *
 *   gate 1  input_image   the cut-out the child uploaded
 *   gate 2  input_text    character names and traits, via asUntrustedText
 *   gate 3  output_text   the generated story, plus reading level vs age_band
 *   gate 4  output_image   every generated illustration, BEFORE it is shown
 *
 * Gate 4 runs on each image the moment it is produced, not at the end. A cover
 * is revealed to the child as soon as it lands (docs/ARCHITECTURE.md
 * "cover reveal fires"), so checking covers at the end of the run would be
 * checking them after the child had already seen them.
 */

import { asUntrustedText } from '@papercub/shared';
import type {
  AgeBand,
  ModerationAction,
  ModerationStage,
  ModerationSubjectType,
  ModerationVerdict,
  PromptSafeCharacter,
  RecordModerationRequest,
  UntrustedText,
} from '@papercub/shared';
import { ModerationBlocked } from './errors';
import type { CharacterRecord, WorkerDb } from './ports';
import { checkReadingLevel } from './reading-level';
import type { ProviderUsage } from './providers/types';

export interface ModerationOutcome {
  verdict: ModerationVerdict;
  categories: string[];
  rawScore: number | null;
  provider: string;
  /** Present when the check was a paid provider call. */
  usage?: ProviderUsage;
}

/**
 * A safety classifier. Deliberately separate from ProviderBundle: moderation
 * must be able to run on a different vendor from generation, so a model that
 * happily produced something unsafe is not also the one asked to judge it.
 */
export interface ContentModerator {
  moderateImage(args: { imageBytes: Uint8Array; context: 'input' | 'output' }): Promise<ModerationOutcome>;
  moderateText(args: { text: string; context: 'input' | 'output' }): Promise<ModerationOutcome>;
}

export interface GateContext {
  db: WorkerDb;
  moderator: ContentModerator;
  parentId: string;
  /** Called with the usage of any paid moderation call, so it is costed. */
  onUsage: (usage: ProviderUsage) => Promise<void>;
}

async function record(
  ctx: GateContext,
  args: {
    subjectType: ModerationSubjectType;
    subjectId: string;
    stage: ModerationStage;
    outcome: ModerationOutcome;
    actionTaken: ModerationAction;
  },
): Promise<void> {
  const req: RecordModerationRequest = {
    parentId: ctx.parentId,
    subjectType: args.subjectType,
    subjectId: args.subjectId,
    stage: args.stage,
    verdict: args.outcome.verdict,
    categories: args.outcome.categories,
    actionTaken: args.actionTaken,
    provider: args.outcome.provider,
    rawScore: args.outcome.rawScore,
  };
  await ctx.db.recordModeration(req);
}

/* ── Gate 1: input image ──────────────────────────────────────────────── */

export async function gateInputImage(
  ctx: GateContext,
  args: { imageBytes: Uint8Array; subjectId: string; subjectType: ModerationSubjectType },
): Promise<void> {
  const outcome = await ctx.moderator.moderateImage({ imageBytes: args.imageBytes, context: 'input' });
  if (outcome.usage) await ctx.onUsage(outcome.usage);

  const blocked = outcome.verdict === 'block';
  await record(ctx, {
    subjectType: args.subjectType,
    subjectId: args.subjectId,
    stage: 'input_image',
    outcome,
    // The user supplied this image, so blocking it fails the story WITHOUT a
    // refund: `moderation_blocked_input_image` is deliberately absent from
    // REFUNDABLE_JOB_ERRORS. Nothing was spent on a provider yet either.
    actionTaken: blocked ? 'blocked_story_failed' : 'none',
  });

  if (blocked) {
    throw new ModerationBlocked({
      code: 'moderation_blocked_input_image',
      stage: 'input_image',
      subjectType: args.subjectType,
      message: `Input image blocked for subject ${args.subjectId}`,
    });
  }
}

/* ── Gate 2: input text ───────────────────────────────────────────────── */

/**
 * Validates every user string that will reach a prompt and returns the
 * prompt-safe view of each character.
 *
 * `asUntrustedText` is the gate: a name that fails it is REJECTED and the story
 * fails, because a name is load-bearing — silently substituting one would ship
 * a book starring the wrong character. A trait that fails is DROPPED, because a
 * trait is decoration and losing one is better than losing the book.
 * Both outcomes are recorded (`name_rejected` / `trait_dropped`).
 */
export async function gateInputText(
  ctx: GateContext,
  args: { characters: CharacterRecord[] },
): Promise<PromptSafeCharacter[]> {
  const safe: PromptSafeCharacter[] = [];

  for (const character of args.characters) {
    const name = asUntrustedText(character.name);
    if (!name.ok) {
      await record(ctx, {
        subjectType: 'character_name',
        subjectId: character.id,
        stage: 'input_text',
        outcome: { verdict: 'block', categories: [name.reason], rawScore: null, provider: 'papercub_prompt_safety' },
        actionTaken: 'name_rejected',
      });
      throw new ModerationBlocked({
        code: 'moderation_blocked_input_text',
        stage: 'input_text',
        subjectType: 'character_name',
        message: `Character name rejected (${name.reason}) for character ${character.id}`,
      });
    }

    await record(ctx, {
      subjectType: 'character_name',
      subjectId: character.id,
      stage: 'input_text',
      outcome: { verdict: 'pass', categories: [], rawScore: null, provider: 'papercub_prompt_safety' },
      actionTaken: 'none',
    });

    let characterType: UntrustedText | null = null;
    if (character.characterType !== null && character.characterType.length > 0) {
      const parsed = asUntrustedText(character.characterType);
      if (parsed.ok) {
        characterType = parsed.value;
      } else {
        await record(ctx, {
          subjectType: 'character_traits',
          subjectId: character.id,
          stage: 'input_text',
          outcome: {
            verdict: 'flag',
            categories: [parsed.reason],
            rawScore: null,
            provider: 'papercub_prompt_safety',
          },
          actionTaken: 'trait_dropped',
        });
      }
    }

    const traits: UntrustedText[] = [];
    for (const raw of character.personalityTraits) {
      const parsed = asUntrustedText(raw);
      if (parsed.ok) {
        traits.push(parsed.value);
      } else {
        await record(ctx, {
          subjectType: 'character_traits',
          subjectId: character.id,
          stage: 'input_text',
          outcome: {
            verdict: 'flag',
            categories: [parsed.reason],
            rawScore: null,
            provider: 'papercub_prompt_safety',
          },
          actionTaken: 'trait_dropped',
        });
      }
    }

    safe.push({
      characterId: character.id,
      name: name.value,
      characterType,
      personalityTraits: traits,
      featureAnchor: character.featureAnchor ?? '',
      palette: character.palette,
      referenceAssetKeys: character.referenceAssets.map((a) => a.storageKey),
    });
  }

  return safe;
}

/* ── Gate 3: output text ──────────────────────────────────────────────── */

export interface OutputTextPage {
  index: number;
  text: string;
}

export async function gateOutputText(
  ctx: GateContext,
  args: { storyId: string; pages: OutputTextPage[]; ageBand: AgeBand },
): Promise<void> {
  for (const page of args.pages) {
    const subjectId = `${args.storyId}:${page.index}`;
    const outcome = await ctx.moderator.moderateText({ text: page.text, context: 'output' });
    if (outcome.usage) await ctx.onUsage(outcome.usage);

    const blocked = outcome.verdict === 'block';
    await record(ctx, {
      subjectType: 'story_page_text',
      subjectId,
      stage: 'output_text',
      outcome,
      // WE produced this text, so a block is our failure, not the user's:
      // `moderation_blocked_output_text` IS in REFUNDABLE_JOB_ERRORS.
      actionTaken: blocked ? 'blocked_and_refunded' : 'none',
    });

    if (blocked) {
      throw new ModerationBlocked({
        code: 'moderation_blocked_output_text',
        stage: 'output_text',
        subjectType: 'story_page_text',
        message: `Generated text blocked on page ${page.index} of story ${args.storyId}`,
      });
    }
  }

  // Reading level, over the whole story: one long sentence is noise, a story
  // written at the wrong level is not.
  const wholeStory = args.pages.map((p) => p.text).join(' ');
  const level = checkReadingLevel(wholeStory, args.ageBand);

  await record(ctx, {
    subjectType: 'story_page_text',
    subjectId: `${args.storyId}:reading_level`,
    stage: 'output_text',
    outcome: {
      verdict: level.ok ? 'pass' : 'block',
      categories: level.failures,
      rawScore: level.meanWordsPerSentence,
      provider: 'papercub_reading_level',
    },
    actionTaken: level.ok ? 'none' : 'blocked_and_refunded',
  });

  if (!level.ok) {
    throw new ModerationBlocked({
      code: 'reading_level_failed',
      stage: 'output_text',
      subjectType: 'story_page_text',
      message:
        `Story ${args.storyId} failed the ${args.ageBand} reading level: ` +
        level.failures.join(', '),
    });
  }
}

/* ── Gate 4: output image ─────────────────────────────────────────────── */

/**
 * Runs on every generated image before it is stored or shown. Returns the
 * verdict so the caller can stamp it on the page_illustrations row.
 */
export async function gateOutputImage(
  ctx: GateContext,
  args: { imageBytes: Uint8Array; storyId: string; pageIndex: number },
): Promise<ModerationVerdict> {
  const subjectId = `${args.storyId}:${args.pageIndex}`;
  const outcome = await ctx.moderator.moderateImage({ imageBytes: args.imageBytes, context: 'output' });
  if (outcome.usage) await ctx.onUsage(outcome.usage);

  const blocked = outcome.verdict === 'block';
  await record(ctx, {
    subjectType: 'page_illustration',
    subjectId,
    stage: 'output_image',
    outcome,
    // Ours, so refundable — DECISIONS-driven: fail the story cleanly and give
    // the quota back rather than ship an unreviewed image to a child.
    actionTaken: blocked ? 'blocked_and_refunded' : 'none',
  });

  if (blocked) {
    throw new ModerationBlocked({
      code: 'moderation_blocked_output_image',
      stage: 'output_image',
      subjectType: 'page_illustration',
      message: `Generated illustration blocked at page ${args.pageIndex} of story ${args.storyId}`,
    });
  }

  return outcome.verdict;
}

/**
 * The `moderating_images` stage. Every image was already checked inline by
 * gate 4 at the moment it was produced — this is the set-level close-out that
 * turns those per-image verdicts into a decision about the finished book, and
 * it is real work rather than a decorative progress ping: it verifies the set
 * is complete and that nothing merely *flagged* accumulated into a book that
 * should not ship.
 *
 * A story is blocked here if any image is missing (an incomplete book must not
 * reach `ready`) or if flagged images outnumber the tolerance.
 */
export async function gateImageSetCloseOut(
  ctx: GateContext,
  args: {
    storyId: string;
    expectedPageIndexes: number[];
    verdicts: Map<number, ModerationVerdict>;
  },
): Promise<void> {
  const missing = args.expectedPageIndexes.filter((i) => !args.verdicts.has(i));
  const flagged = [...args.verdicts.entries()].filter(([, v]) => v === 'flag').map(([i]) => i);
  const ok = missing.length === 0 && flagged.length === 0;

  await record(ctx, {
    subjectType: 'page_illustration',
    subjectId: `${args.storyId}:set`,
    stage: 'output_image',
    outcome: {
      verdict: ok ? 'pass' : 'block',
      categories: [
        ...missing.map((i) => `missing_page_${i}`),
        ...flagged.map((i) => `flagged_page_${i}`),
      ],
      rawScore: null,
      provider: 'papercub_image_set',
    },
    actionTaken: ok ? 'none' : 'blocked_and_refunded',
  });

  if (!ok) {
    throw new ModerationBlocked({
      code: 'moderation_blocked_output_image',
      stage: 'output_image',
      subjectType: 'page_illustration',
      message:
        `Image set incomplete or flagged for story ${args.storyId}: ` +
        `missing=[${missing.join(',')}] flagged=[${flagged.join(',')}]`,
    });
  }
}
