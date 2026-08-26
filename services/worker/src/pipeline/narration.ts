/**
 * The narration_generate pipeline. Narration is normally produced inline by the
 * story pipeline; this job exists for the case where a story exists without one
 * — a narration that failed on its own, or a language added later.
 *
 * "SpeechSynthesizer once, cached forever" (docs/ARCHITECTURE.md): narrations
 * has a unique index on story_id, so the audio is generated once and every
 * later play is a signed URL, not a provider call. Re-synthesising an existing
 * narration would be paying twice for a file we already hold.
 */

import { buildStorageKey } from '@papercub/shared';
import type { NarrationJobPayload } from '@papercub/shared';
import type { CostLedger } from '../cost';
import { JobFailure } from '../errors';
import type { ProgressReporter } from '../progress';
import type { PipelineDeps } from './context';

export interface NarrationRunArgs {
  job: NarrationJobPayload;
  deps: PipelineDeps;
  ledger: CostLedger;
  progress: ProgressReporter;
}

export async function runNarrationGenerate(args: NarrationRunArgs): Promise<void> {
  const { job, deps, ledger, progress } = args;
  const { db, providers, logger } = deps;

  await progress.enterStage('narrating');

  const story = await db.loadStory(job.storyId);
  if (story.pages.length === 0) {
    throw new JobFailure('internal', `Story ${job.storyId} has no pages to narrate`);
  }

  const text = [...story.pages]
    .sort((a, b) => a.index - b.index)
    .map((p) => p.text)
    .join('\n\n');

  const speech = await providers.speech.synthesise({
    text,
    voiceId: job.voiceId,
    language: job.language,
  });
  await ledger.recordProviderCall('narrating', speech.usage);

  const key = buildStorageKey({
    bucket: 'narration',
    ownerUid: job.parentId,
    scope: job.storyId,
    id: `narration-${job.language}`,
    ext: speech.value.mimeType === 'audio/wav' ? 'wav' : 'mp3',
  });
  await db.uploadObject(key, speech.value.audioBytes, 'audio/mpeg');

  await db.insertNarration({
    storyId: job.storyId,
    voiceId: job.voiceId,
    provider: speech.usage.provider,
    storageKey: key,
    durationMs: speech.value.durationMs,
    wordTimingsKey: null,
    sentenceLevelOnly: true,
    language: job.language,
  });

  await progress.enterStage('done');

  logger.info('narration_generate complete', {
    jobId: job.jobId,
    storyId: job.storyId,
    measuredCents: ledger.totalMeasuredCents,
  });
}
