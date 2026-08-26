/**
 * The single place a job's terminal outcome is decided.
 *
 * There is exactly one try/catch in the whole worker and it is here. That is
 * deliberate: `generation_jobs.error_code`, the refund decision and the
 * reservation release are three consequences of one event, and splitting them
 * across stages is how a job ends up failed-but-not-refunded, or
 * refunded-twice, or with its reservation stranded until the period rolls.
 *
 * The outcomes, in full:
 *
 *   success              record_cost(final) releases the reservation. No refund.
 *   refundable failure    refund_story_quota gives the story back AND releases.
 *   non-refundable        record_cost(final) releases. Story is NOT given back.
 *   global halt           NOT a failure. No error_code, no refund, no release —
 *                         the message goes back on the queue untouched.
 *
 * The halt case is the one worth being careful about: a halted job has not gone
 * wrong, and failing it would charge a user's story to our own spend cap.
 */

import { QUEUE_NAMES, STORY_SHAPE } from '@papercub/shared';
import type { JobPayload } from '@papercub/shared';
import { CostLedger, isGlobalSpendHalted } from './cost';
import { GenerationHalted, toJobFailure } from './errors';
import type { Logger } from './logger';
import { ProgressReporter } from './progress';
import type { PipelineDeps } from './pipeline/context';
import { runCharacterBuild } from './pipeline/character';
import { runNarrationGenerate } from './pipeline/narration';
import { runPageRegenerate } from './pipeline/page-regenerate';
import { runStoryGenerate } from './pipeline/story';

export interface RunJobOptions {
  job: JobPayload;
  deps: PipelineDeps;
  globalDailySpendCapCents: number;
}

export type JobOutcome =
  | { kind: 'succeeded'; measuredCents: number }
  | { kind: 'failed'; errorCode: string; refunded: boolean; measuredCents: number }
  | { kind: 'halted'; spentTodayCents: number };

export async function runJob(opts: RunJobOptions): Promise<JobOutcome> {
  const { job, deps, globalDailySpendCapCents } = opts;
  const { db } = deps;
  const logger: Logger = deps.logger.child({ jobId: job.jobId, type: job.type });

  /* DECISIONS.md §3.3 — checked BEFORE any provider call, so a halt costs
   * nothing. Not a job failure: see the header note. */
  const halt = await isGlobalSpendHalted(db, globalDailySpendCapCents);
  if (halt.halted) {
    logger.error('generation halted: global daily spend cap reached', {
      spentTodayCents: halt.spentTodayCents,
      capCents: globalDailySpendCapCents,
      queue: QUEUE_NAMES.generation,
    });
    return { kind: 'halted', spentTodayCents: halt.spentTodayCents };
  }

  const ledger = new CostLedger({ db, jobId: job.jobId, parentId: job.parentId });

  const storyId = 'storyId' in job ? job.storyId : null;
  const pagesTotal = job.type === 'story_generate' ? STORY_SHAPE[job.length].pageCount : 0;

  const progress = new ProgressReporter({ db, jobId: job.jobId, storyId, pagesTotal });

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  await db.updateJob(job.jobId, { status: 'running', startedAt });

  try {
    switch (job.type) {
      case 'story_generate':
        await runStoryGenerate({ job, deps, ledger, progress });
        break;
      case 'character_build':
        await runCharacterBuild({ job, deps, ledger, progress });
        break;
      case 'page_regenerate':
        await runPageRegenerate({ job, deps, ledger, progress });
        break;
      case 'narration_generate':
        await runNarrationGenerate({ job, deps, ledger, progress });
        break;
    }

    // Settle: flush the sub-cent remainder and release the reservation. Exactly
    // one release per job, and this is it on the success path.
    await ledger.settleSuccess();

    // `stage` is deliberately not set here: every pipeline ends by entering
    // the `done` stage itself, and re-writing it would emit a second `done`
    // transition for a stage that only ran once.
    await db.updateJob(job.jobId, {
      status: 'succeeded',
      errorCode: null,
      finishedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedMs,
    });

    logger.info('job succeeded', { measuredCents: ledger.totalRecordedCents });
    return { kind: 'succeeded', measuredCents: ledger.totalRecordedCents };
  } catch (err) {
    if (err instanceof GenerationHalted) {
      // A stage noticed the cap mid-run. Same rule: not the user's failure.
      logger.error('generation halted mid-job', { spentTodayCents: err.spentTodayCents });
      return { kind: 'halted', spentTodayCents: err.spentTodayCents };
    }

    const failure = toJobFailure(err);

    // Order matters: the error_code lands on the row BEFORE the refund, so a
    // crash between the two leaves a job that is visibly failed and
    // un-refunded — recoverable — rather than refunded with no reason recorded.
    await db.updateJob(job.jobId, {
      status: 'failed',
      errorCode: failure.code,
      finishedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedMs,
    });

    // Settles measured spend and releases the reservation via exactly one of
    // the two paths. See CostLedger.settleFailure.
    const { refunded } = await ledger.settleFailure(failure.code);

    await progress.markFailed(failure.code);

    // Deliberately AFTER the refund and the reservation release: the character
    // slot matters, but not enough to risk the money path if this write fails.
    // A slot is derived from a live count, so a missed write here costs the user
    // a slot until the row is archived — a refund missed here would cost real
    // money and could not be reconstructed.
    if (job.type === 'character_build') {
      try {
        await db.setCharacterStatus(job.characterId, 'failed');
      } catch (statusErr) {
        logger.error('failed to mark character failed; its slot stays consumed', {
          characterId: job.characterId,
          reason: statusErr instanceof Error ? statusErr.message : String(statusErr),
        });
      }
    }

    logger.error('job failed', {
      errorCode: failure.code,
      refunded,
      measuredCents: ledger.totalRecordedCents,
      reason: failure.message,
    });

    return {
      kind: 'failed',
      errorCode: failure.code,
      refunded,
      measuredCents: ledger.totalRecordedCents,
    };
  }
}
