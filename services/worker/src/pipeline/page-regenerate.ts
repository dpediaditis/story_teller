/**
 * The page_regenerate pipeline. One page, redrawn.
 *
 * FREE_PAGE_REGENS_PER_STORY (2) free per story, then it consumes budget — so
 * the regen counter is checked here, in the worker, and not only at the edge.
 * The edge check is the fast path for a good client; this one is the honest
 * one, because by the time a job reaches the worker the money is about to be
 * spent.
 *
 * A regen is always FAST tier. A page that is being redrawn is still an
 * interior page, and the premium tier is reserved for the one cover per story
 * that the unit economics in DECISIONS.md §2 allow.
 */

import { FREE_PAGE_REGENS_PER_STORY, PAGE_ASPECT_RATIO, buildStorageKey } from '@papercub/shared';
import type { IllustrationPromptInput, PageRegenerateJobPayload } from '@papercub/shared';
import type { CostLedger } from '../cost';
import { JobFailure } from '../errors';
import type { GateContext } from '../moderation';
import { gateInputText, gateOutputImage } from '../moderation';
import type { ProgressReporter } from '../progress';
import type { PipelineDeps } from './context';

export interface PageRegenerateRunArgs {
  job: PageRegenerateJobPayload;
  deps: PipelineDeps;
  ledger: CostLedger;
  progress: ProgressReporter;
}

export async function runPageRegenerate(args: PageRegenerateRunArgs): Promise<void> {
  const { job, deps, ledger, progress } = args;
  const { db, providers, logger } = deps;

  const gates: GateContext = {
    db,
    moderator: deps.moderator,
    parentId: job.parentId,
    onUsage: (usage) => ledger.recordProviderCall(progress.currentStage, usage),
  };

  await progress.enterStage('validating_request');

  const story = await db.loadStory(job.storyId);
  const page = story.pages.find((p) => p.index === job.pageIndex);
  if (!page) {
    throw new JobFailure('internal', `Page ${job.pageIndex} not found on story ${job.storyId}`);
  }

  // The budget check. `regen_budget_exhausted` IS in REFUNDABLE_JOB_ERRORS, so
  // a user who hits it does not lose anything for having asked.
  if (page.regenCount >= FREE_PAGE_REGENS_PER_STORY) {
    throw new JobFailure(
      'regen_budget_exhausted',
      `Page ${job.pageIndex} of story ${job.storyId} has used all ` +
        `${FREE_PAGE_REGENS_PER_STORY} free regenerations`,
    );
  }

  const characters = await db.loadCharacters(story.characterIds);
  const safeCharacters = await gateInputText(gates, { characters });

  const referenceImages: Uint8Array[] = [];
  const referenceAssetIds: string[] = [];
  for (const character of characters) {
    for (const asset of character.referenceAssets) {
      referenceImages.push(await db.downloadObject(asset.storageKey));
      referenceAssetIds.push(asset.id);
    }
  }

  await progress.enterStage('illustrating_pages');

  await db.setStoryPageStatus(job.storyId, job.pageIndex, 'illustrating');

  const input: IllustrationPromptInput = {
    kind: 'illustration',
    technique: story.renderTechnique,
    sceneDescription: page.sceneDescription,
    characters: safeCharacters,
    aspectRatio: PAGE_ASPECT_RATIO,
    // A fresh seed is the point of a regeneration: same scene, different draw.
    seed: null,
    isCover: false,
  };

  const illustration = await providers.image.generateIllustration({
    input,
    referenceImages,
    tier: 'fast',
  });
  await ledger.recordProviderCall('illustrating_pages', illustration.usage);

  await progress.enterStage('moderating_images');

  await gateOutputImage(gates, {
    imageBytes: illustration.value.imageBytes,
    storyId: job.storyId,
    pageIndex: job.pageIndex,
  });

  const regenCount = await db.incrementPageRegenCount(job.storyId, job.pageIndex);

  const key = buildStorageKey({
    bucket: 'illustrations',
    ownerUid: job.parentId,
    scope: job.storyId,
    id: `page-${job.pageIndex}-v${regenCount}`,
    ext: 'png',
  });
  await db.uploadObject(key, illustration.value.imageBytes, 'image/png');

  const illustrationId = await db.replaceIllustration({
    storyId: job.storyId,
    pageIndex: job.pageIndex,
    storageKey: key,
    width: 1024,
    height: 768,
    modelId: illustration.usage.modelId,
    seed: illustration.value.seed,
    referenceAssetIds,
    costCents: Math.round(illustration.usage.costCents),
  });

  await db.linkPageIllustration(job.storyId, job.pageIndex, illustrationId);
  await db.setStoryPageStatus(job.storyId, job.pageIndex, 'ready');

  await progress.enterStage('done');

  logger.info('page_regenerate complete', {
    jobId: job.jobId,
    storyId: job.storyId,
    pageIndex: job.pageIndex,
    regenCount,
    measuredCents: ledger.totalMeasuredCents,
  });
}
