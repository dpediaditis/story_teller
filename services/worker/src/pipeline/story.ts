/**
 * The story_generate pipeline. docs/ARCHITECTURE.md "Request flow — story
 * generation, end to end" is the specification for this file.
 *
 * Stage order is fixed and each stage is entered immediately before its work
 * actually starts:
 *
 *   moderating_input     gate 1 over every character cut-out
 *   validating_request   gate 2 — names and traits via asUntrustedText
 *   writing_story        TextGenerator, structured output
 *   moderating_text      gate 3 + reading level, then story_pages are written
 *   illustrating_cover   PREMIUM tier, page index 0 -> coverReady fires
 *   illustrating_pages   FAST tier, pages 1..n IN ORDER, one progress event each
 *   moderating_images    set-level close-out over the finished image set
 *   narrating            SpeechSynthesizer once, cached forever
 *   assembling           story.status = 'ready'
 *   done                 settle cost
 *
 * COVER FIRST, THEN PAGES IN ORDER is not an implementation detail. It is the
 * product: the cover reveal has a 12s SLO (SLO.coverRevealMs) and pages become
 * readable one at a time so the child reads page 1 while page 5 renders.
 * Generating pages concurrently would break both.
 *
 * The premium/fast tier split is the unit economics (DECISIONS.md §2): exactly
 * one premium image per story, every interior page on the fast tier. Moving a
 * page to the premium tier changes the cost table and the margin with it.
 */

import {
  COVER_ASPECT_RATIO,
  GeneratedStory,
  PAGE_ASPECT_RATIO,
  STORY_SHAPE,
  buildStorageKey,
} from '@papercub/shared';
import type {
  IllustrationPromptInput,
  ModerationVerdict,
  PromptSafeCharacter,
  StoryGenerateJobPayload,
  StoryPromptInput,
} from '@papercub/shared';
import type { CostLedger } from '../cost';
import { JobFailure } from '../errors';
import type { GateContext } from '../moderation';
import {
  gateImageSetCloseOut,
  gateInputImage,
  gateInputText,
  gateOutputImage,
  gateOutputText,
} from '../moderation';
import type { StoryPageRow } from '../ports';
import type { ProgressReporter } from '../progress';
import type { PipelineDeps } from './context';

export interface StoryRunArgs {
  job: StoryGenerateJobPayload;
  deps: PipelineDeps;
  ledger: CostLedger;
  progress: ProgressReporter;
}

export async function runStoryGenerate(args: StoryRunArgs): Promise<void> {
  const { job, deps, ledger, progress } = args;
  const { db, providers, logger } = deps;

  const gates: GateContext = {
    db,
    moderator: deps.moderator,
    parentId: job.parentId,
    onUsage: (usage) => ledger.recordProviderCall(progress.currentStage, usage),
  };

  const shape = STORY_SHAPE[job.length];
  const pageCount = job.pageCount;

  await db.setStoryStatus(job.storyId, 'generating');

  /* ── moderating_input — gate 1 ─────────────────────────────────────── */

  await progress.enterStage('moderating_input');

  const characters = await db.loadCharacters(job.characterIds);
  if (characters.length !== job.characterIds.length) {
    throw new JobFailure(
      'internal',
      `Expected ${job.characterIds.length} characters, loaded ${characters.length}`,
    );
  }

  for (const character of characters) {
    const cutout = await db.downloadObject(character.cutoutStorageKey);
    await gateInputImage(gates, {
      imageBytes: cutout,
      subjectId: character.id,
      subjectType: 'character_cutout',
    });
  }

  /* ── validating_request — gate 2 ───────────────────────────────────── */

  await progress.enterStage('validating_request');

  // From here on the pipeline works with PromptSafeCharacter only. There is no
  // path from a raw CharacterRecord into a prompt, and no type here can carry a
  // child's display name — DECISIONS.md §10.
  const safeCharacters: PromptSafeCharacter[] = await gateInputText(gates, { characters });

  /* ── writing_story ─────────────────────────────────────────────────── */

  await progress.enterStage('writing_story');

  const storyInput: StoryPromptInput = {
    kind: 'story',
    ageBand: job.ageBand,
    theme: job.theme,
    mood: job.mood,
    length: job.length,
    pageCount,
    characters: safeCharacters,
    worldFacts: [],
    locale: job.locale,
  };

  const written = await providers.text.generateStory(storyInput);
  await ledger.recordProviderCall('writing_story', written.usage);

  // Structured output is configured on the provider, but the schema is
  // re-parsed here too: the adapter's job is to call the model, and trusting it
  // to have validated the shape is how prose ends up in a page slot.
  const parsed = GeneratedStory.safeParse(written.value);
  if (!parsed.success) {
    throw new JobFailure(
      'invalid_structured_output',
      `Story model returned an off-schema object: ${parsed.error.message}`,
    );
  }
  const story = parsed.data;

  if (story.pages.length !== pageCount) {
    throw new JobFailure(
      'invalid_structured_output',
      `Story model returned ${story.pages.length} pages, expected ${pageCount}`,
    );
  }

  const orderedPages = [...story.pages].sort((a, b) => a.index - b.index);
  for (let i = 0; i < orderedPages.length; i += 1) {
    if (orderedPages[i]!.index !== i + 1) {
      throw new JobFailure(
        'invalid_structured_output',
        `Story pages are not a contiguous 1..${pageCount} sequence`,
      );
    }
  }

  /* ── moderating_text — gate 3 + reading level ──────────────────────── */

  await progress.enterStage('moderating_text');

  await gateOutputText(gates, {
    storyId: job.storyId,
    pages: orderedPages.map((p) => ({ index: p.index, text: p.text })),
    ageBand: job.ageBand,
  });

  const pageRows: StoryPageRow[] = orderedPages.map((p) => ({
    index: p.index,
    text: p.text,
    // Internal image prompt. story_pages.scene_description is never selected by
    // any client-facing endpoint and StoryPageDto has no field for it.
    sceneDescription: p.sceneDescription,
    status: 'text_ready',
  }));

  await db.insertStoryPages(job.storyId, pageRows);
  await db.setStoryStatus(job.storyId, 'generating', { title: story.title });

  /* ── illustrating_cover — PREMIUM tier ─────────────────────────────── */

  await progress.enterStage('illustrating_cover');

  const referenceImages: Uint8Array[] = [];
  const referenceAssetIds: string[] = [];
  for (const character of characters) {
    for (const asset of character.referenceAssets) {
      referenceImages.push(await db.downloadObject(asset.storageKey));
      referenceAssetIds.push(asset.id);
    }
  }

  const imageVerdicts = new Map<number, ModerationVerdict>();

  const coverInput: IllustrationPromptInput = {
    kind: 'illustration',
    technique: job.renderTechnique,
    sceneDescription: story.coverSceneDescription,
    characters: safeCharacters,
    aspectRatio: COVER_ASPECT_RATIO,
    seed: null,
    isCover: true,
  };

  const cover = await providers.image.generateIllustration({
    input: coverInput,
    referenceImages,
    // PREMIUM. Exactly one of these per story — see the header note.
    tier: 'premium',
  });
  await ledger.recordProviderCall('illustrating_cover', cover.usage);

  // Gate 4 runs BEFORE the cover is stored, because the next thing that happens
  // is the client revealing it.
  imageVerdicts.set(
    0,
    await gateOutputImage(gates, {
      imageBytes: cover.value.imageBytes,
      storyId: job.storyId,
      pageIndex: 0,
    }),
  );

  // Extension, content type and dimensions all come from the bytes the model
  // returned. Measured live: Gemini answers with JPEG at 928x1152, so the
  // previous hardcoded png/1024x1280 was wrong on all three counts and the
  // reader lays out from these columns.
  const coverMeta = cover.value.meta;
  const coverKey = buildStorageKey({
    bucket: 'illustrations',
    ownerUid: job.parentId,
    scope: job.storyId,
    id: 'cover',
    ext: coverMeta.ext,
  });
  await db.uploadObject(coverKey, cover.value.imageBytes, coverMeta.mimeType);

  const coverId = await db.insertIllustration({
    storyId: job.storyId,
    pageIndex: 0,
    storageKey: coverKey,
    width: coverMeta.width,
    height: coverMeta.height,
    modelId: cover.usage.modelId,
    seed: cover.value.seed,
    referenceAssetIds,
    costCents: Math.round(cover.usage.costCents),
  });

  // `partial` is load-bearing: the story is readable before it is complete.
  await db.setStoryStatus(job.storyId, 'partial', { coverAssetId: coverId });
  await progress.markCoverReady();

  /* ── illustrating_pages — FAST tier, IN ORDER ──────────────────────── */

  await progress.enterStage('illustrating_pages');

  // Seeding every interior page from the cover's seed is what keeps one book
  // looking like one book.
  const styleSeed = cover.value.seed;

  for (const page of orderedPages) {
    await db.setStoryPageStatus(job.storyId, page.index, 'illustrating');

    const pageInput: IllustrationPromptInput = {
      kind: 'illustration',
      technique: job.renderTechnique,
      sceneDescription: page.sceneDescription,
      characters: safeCharacters,
      aspectRatio: PAGE_ASPECT_RATIO,
      seed: styleSeed,
      isCover: false,
    };

    const illustration = await providers.image.generateIllustration({
      input: pageInput,
      referenceImages,
      // FAST. Every interior page. The cheap half of the split that makes the
      // margin in DECISIONS.md §2 work.
      tier: 'fast',
    });
    await ledger.recordProviderCall('illustrating_pages', illustration.usage);

    imageVerdicts.set(
      page.index,
      await gateOutputImage(gates, {
        imageBytes: illustration.value.imageBytes,
        storyId: job.storyId,
        pageIndex: page.index,
      }),
    );

    const pageMeta = illustration.value.meta;
    const pageKey = buildStorageKey({
      bucket: 'illustrations',
      ownerUid: job.parentId,
      scope: job.storyId,
      id: `page-${page.index}`,
      ext: pageMeta.ext,
    });
    await db.uploadObject(pageKey, illustration.value.imageBytes, pageMeta.mimeType);

    const illustrationId = await db.insertIllustration({
      storyId: job.storyId,
      pageIndex: page.index,
      storageKey: pageKey,
      width: pageMeta.width,
      height: pageMeta.height,
      modelId: illustration.usage.modelId,
      seed: illustration.value.seed,
      referenceAssetIds,
      costCents: Math.round(illustration.usage.costCents),
    });

    await db.linkPageIllustration(job.storyId, page.index, illustrationId);
    await db.setStoryPageStatus(job.storyId, page.index, 'ready');

    // Emitted after EACH page, in order. This is the whole point of the
    // sequential loop.
    await progress.markPageReady(page.index);
  }

  /* ── moderating_images — set close-out ─────────────────────────────── */

  await progress.enterStage('moderating_images');

  await gateImageSetCloseOut(gates, {
    storyId: job.storyId,
    expectedPageIndexes: [0, ...orderedPages.map((p) => p.index)],
    verdicts: imageVerdicts,
  });

  /* ── narrating ─────────────────────────────────────────────────────── */

  await progress.enterStage('narrating');

  const narrationText = orderedPages.map((p) => p.text).join('\n\n');
  const speech = await providers.speech.synthesise({
    text: narrationText,
    // The voice the parent chose, already checked against their tier by
    // claim_story_quota. The worker does not re-decide entitlement; it reads
    // what the claim recorded.
    voiceId: job.voiceId,
    language: job.locale,
  });
  await ledger.recordProviderCall('narrating', speech.usage);

  const narrationKey = buildStorageKey({
    bucket: 'narration',
    ownerUid: job.parentId,
    scope: job.storyId,
    id: 'narration',
    ext: speech.value.mimeType === 'audio/wav' ? 'wav' : 'mp3',
  });
  // The synthesiser reports what it actually returned; Gemini's is WAV, not
  // MP3. Hardcoding 'audio/mpeg' stamped the object with a content type its own
  // bytes contradict, and the reader fetches this over a signed URL where the
  // stored content type is what the player is handed.
  await db.uploadObject(narrationKey, speech.value.audioBytes, speech.value.mimeType);

  await db.insertNarration({
    storyId: job.storyId,
    voiceId: job.voiceId,
    provider: speech.usage.provider,
    storageKey: narrationKey,
    durationMs: speech.value.durationMs,
    wordTimingsKey: null,
    // Sentence-level timing is sufficient for a five-year-old (narrations.sql).
    sentenceLevelOnly: true,
    language: job.locale,
  });

  /* ── assembling ────────────────────────────────────────────────────── */

  await progress.enterStage('assembling');

  await db.setStoryStatus(job.storyId, 'ready', { completedAt: new Date().toISOString() });

  /* ── done ──────────────────────────────────────────────────────────── */

  await progress.enterStage('done');

  logger.info('story_generate complete', {
    jobId: job.jobId,
    storyId: job.storyId,
    pages: pageCount,
    measuredCents: ledger.totalMeasuredCents,
    estimatedCents: shape.estimatedCostCents,
  });
}
