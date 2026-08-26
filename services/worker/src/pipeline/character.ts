/**
 * The character_build pipeline.
 *
 * Stages, in GenerationStage order:
 *   moderating_input      gate 1 over the cut-out the child uploaded
 *   analysing_drawing     VisionAnalyzer -> DrawingAnalysis (structured output)
 *   building_character_refs  the reference sheet every later illustration is
 *                            conditioned on
 *   done
 *
 * DECISIONS.md §2 prices a character build at 16c one-off. It is the other half
 * of the free tier's $0.61 total lifetime exposure, so it is costed with the
 * same measured-per-call discipline as a story.
 *
 * The analysis produces `feature_anchor` — the textual description of what makes
 * this drawing this drawing ("three horns, one big eye, striped tail"). Every
 * illustration prompt for this character carries it, and it is OUR text against
 * a controlled schema, not user free text.
 */

import { DrawingAnalysis, buildStorageKey } from '@papercub/shared';
import type { CharacterBuildJobPayload, IllustrationPromptInput } from '@papercub/shared';
import type { CostLedger } from '../cost';
import { JobFailure } from '../errors';
import type { GateContext } from '../moderation';
import { gateInputImage, gateOutputImage } from '../moderation';
import type { ProgressReporter } from '../progress';
import type { PipelineDeps } from './context';

export interface CharacterRunArgs {
  job: CharacterBuildJobPayload;
  deps: PipelineDeps;
  ledger: CostLedger;
  progress: ProgressReporter;
}

export async function runCharacterBuild(args: CharacterRunArgs): Promise<void> {
  const { job, deps, ledger, progress } = args;
  const { db, providers, logger } = deps;

  const gates: GateContext = {
    db,
    moderator: deps.moderator,
    parentId: job.parentId,
    onUsage: (usage) => ledger.recordProviderCall(progress.currentStage, usage),
  };

  /* ── moderating_input — gate 1 ─────────────────────────────────────── */

  await progress.enterStage('moderating_input');

  const cutout = await db.downloadObject(job.cutoutStorageKey);
  await gateInputImage(gates, {
    imageBytes: cutout,
    subjectId: job.characterId,
    subjectType: 'character_cutout',
  });

  /* ── analysing_drawing ─────────────────────────────────────────────── */

  await progress.enterStage('analysing_drawing');

  const analysed = await providers.vision.analyseDrawing({
    cutoutImageBytes: cutout,
    method: 'vision_subject_lift',
  });
  await ledger.recordProviderCall('analysing_drawing', analysed.usage);

  const parsed = DrawingAnalysis.safeParse(analysed.value);
  if (!parsed.success) {
    throw new JobFailure(
      'invalid_structured_output',
      `Vision model returned an off-schema analysis: ${parsed.error.message}`,
    );
  }
  const analysis = parsed.data;

  const featureAnchor = analysis.distinguishingFeatures.join(', ');

  // The contract allows an empty `distinguishingFeatures` — it caps the array
  // but sets no minimum, and widening it would change a wire type over a
  // worker concern. The pipeline cannot allow it: this string becomes
  // `feature_anchor`, and every illustration prompt for this character for the
  // rest of its life is conditioned on it. A character built without one drifts
  // page to page, which is the one thing the product promises it will not do.
  // `invalid_structured_output` is refundable, so failing here returns the
  // slot rather than spending it on a character that would look wrong.
  if (featureAnchor.length === 0) {
    throw new JobFailure(
      'invalid_structured_output',
      `Vision model returned no distinguishing features for character ${job.characterId}; ` +
        `there is nothing to anchor later illustrations to.`,
    );
  }

  /* ── building_character_refs ───────────────────────────────────────── */

  await progress.enterStage('building_character_refs');

  // The reference sheet is a premium-tier render: it is generated once per
  // character and every later illustration is conditioned on it, so its
  // fidelity sets the ceiling for the whole book. This is the one place outside
  // a story cover where the premium tier is correct.
  const refInput: IllustrationPromptInput = {
    kind: 'illustration',
    technique: 'cutout_rerender',
    sceneDescription:
      `A clean character reference sheet on a plain background, showing the ` +
      `subject standing and facing forward, full body, centred. Subject: ` +
      `${analysis.subjectGuess}. Distinguishing features: ${featureAnchor}. ` +
      `Drawn in ${analysis.medium} with ${analysis.lineQuality} lines.`,
    // No characters array: this IS the pass that creates the character's
    // reference, so there is nothing prior to reference. No user free text
    // reaches this prompt at all.
    characters: [],
    aspectRatio: '1:1',
    seed: null,
    isCover: false,
  };

  const sheet = await providers.image.generateIllustration({
    input: refInput,
    referenceImages: [cutout],
    tier: 'premium',
  });
  await ledger.recordProviderCall('building_character_refs', sheet.usage);

  await gateOutputImage(gates, {
    imageBytes: sheet.value.imageBytes,
    storyId: job.characterId,
    pageIndex: 0,
  });

  // See story.ts: format and dimensions are read off the returned bytes.
  const sheetMeta = sheet.value.meta;
  const sheetKey = buildStorageKey({
    bucket: 'character-assets',
    ownerUid: job.parentId,
    scope: job.characterId,
    id: 'reference-sheet',
    ext: sheetMeta.ext,
  });
  await db.uploadObject(sheetKey, sheet.value.imageBytes, sheetMeta.mimeType);

  await db.insertCharacterAsset({
    characterId: job.characterId,
    kind: 'reference_sheet',
    storageKey: sheetKey,
    modelId: sheet.usage.modelId,
    promptHash: null,
    isPrimary: true,
    widthPx: sheetMeta.width,
    heightPx: sheetMeta.height,
  });

  await db.updateCharacterFromAnalysis(job.characterId, {
    featureAnchor,
    palette: analysis.dominantColours,
    status: 'ready',
  });

  /* ── done ──────────────────────────────────────────────────────────── */

  await progress.enterStage('done');

  logger.info('character_build complete', {
    jobId: job.jobId,
    characterId: job.characterId,
    measuredCents: ledger.totalMeasuredCents,
  });
}
