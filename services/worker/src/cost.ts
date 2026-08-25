/**
 * Cost accounting. DECISIONS.md §3 — the money guarantee.
 *
 * The model is three-phase (docs/ARCHITECTURE.md "Cost & quota model"):
 *
 *   estimate at enqueue   claim_story_quota reserved estimatedCostCents on
 *                         usage_records.cost_cents_reserved. Already done
 *                         before the worker ever sees the job.
 *   measure per call      every provider call adds its MEASURED cost the moment
 *                         it returns. Never an estimate — the ceiling exists to
 *                         catch runaway retries, and retries are invisible to
 *                         an estimate.
 *   settle at completion  exactly one record_cost(p_final = true) releases the
 *                         reservation.
 *
 * TWO invariants are load-bearing and are what the tests in
 * __tests__/cost.test.ts exist to protect:
 *
 *  1. THE RESERVATION IS RELEASED EXACTLY ONCE. `record_cost(p_final => true)`
 *     and `refund_story_quota` BOTH decrement the same shared
 *     `usage_records.cost_cents_reserved` counter by this job's
 *     `estimated_cost_cents`. Calling both on one job does not merely
 *     double-release its own reservation — it frees a *concurrent* job's
 *     reservation too, and the ceiling stops binding for the account. So a
 *     refundable failure settles with `final: false` and lets the refund do the
 *     release; every other terminal path settles with `final: true`.
 *
 *  2. MEASURED SPEND IS NEVER DOUBLE-COUNTED. The ledger records DELTAS against
 *     what it has already written, so a crash mid-pipeline leaves the spend
 *     already incurred recorded exactly once, and the settle call adds only the
 *     unrecorded remainder — never the whole total again.
 *
 * Rounding: provider costs are fractional cents (a fast-tier page is well under
 * 1c). Flooring each of 13 calls would under-report a bedtime book by most of
 * its cost. So the ledger accumulates in full precision and derives each
 * integer delta from the ROUNDED RUNNING TOTAL. Error stays bounded at under 1c
 * for the whole job regardless of how many calls it took.
 */

import { REFUNDABLE_JOB_ERRORS } from '@papercub/shared';
import type { GenerationStage, JobErrorCode, RecordCostRequest } from '@papercub/shared';
import type { WorkerDb } from './ports';
import type { ProviderUsage } from './providers/types';

export interface CostLedgerOptions {
  db: WorkerDb;
  jobId: string;
  parentId: string;
}

export class CostLedger {
  private readonly db: WorkerDb;
  private readonly jobId: string;
  private readonly parentId: string;

  /** Full-precision measured spend for this job, in cents. */
  private measuredCents = 0;
  /** Integer cents already written to record_cost. */
  private recordedCents = 0;
  /** Guard for invariant 1: at most one release, ever. */
  private released = false;

  constructor(opts: CostLedgerOptions) {
    this.db = opts.db;
    this.jobId = opts.jobId;
    this.parentId = opts.parentId;
  }

  /** Full-precision measured total, for logging and assertions. */
  get totalMeasuredCents(): number {
    return this.measuredCents;
  }

  /** Integer cents written so far. */
  get totalRecordedCents(): number {
    return this.recordedCents;
  }

  get reservationReleased(): boolean {
    return this.released;
  }

  /**
   * Record one provider call. Called immediately after the call returns, with
   * the usage the provider itself reported — docs/ARCHITECTURE.md: "Every
   * provider call writes a measured cost row the moment it returns."
   */
  async recordProviderCall(stage: GenerationStage, usage: ProviderUsage): Promise<void> {
    this.measuredCents += usage.costCents;
    const delta = Math.round(this.measuredCents) - this.recordedCents;
    this.recordedCents += delta;

    const request: RecordCostRequest = {
      jobId: this.jobId,
      parentId: this.parentId,
      stage,
      provider: usage.provider,
      modelId: usage.modelId,
      costCents: delta,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      imageCount: usage.imageCount,
      latencyMs: usage.latencyMs,
    };

    await this.db.recordCost({ request, costCentsDelta: delta, final: false });
  }

  /**
   * Successful completion: flush any sub-cent remainder and release the
   * reservation. This is the `done` stage of docs/ARCHITECTURE.md.
   */
  async settleSuccess(): Promise<void> {
    await this.flush('done', true);
  }

  /**
   * Terminal failure. Releases the reservation exactly once, via whichever of
   * the two paths applies:
   *
   *   refundable      refund_story_quota gives the story back AND releases the
   *                   reservation, so this settles with final: false.
   *   not refundable  nothing refunds the story, so this settles with
   *                   final: true to release the reservation itself.
   *
   * Either way the reservation IS released — docs/ARCHITECTURE.md: "Reserved
   * cost is always released."
   */
  async settleFailure(errorCode: JobErrorCode): Promise<{ refunded: boolean }> {
    const refundable = REFUNDABLE_JOB_ERRORS.includes(errorCode);

    if (!refundable) {
      await this.flush('done', true);
      return { refunded: false };
    }

    // Flush measured spend WITHOUT releasing — the refund owns the release.
    await this.flush('done', false);

    const result = await this.db.refundStoryQuota(this.jobId);

    if (result.refunded) {
      // refund_story_quota released the reservation as part of the same call.
      this.released = true;
      return { refunded: true };
    }

    // alreadyRefunded: a previous attempt at this job already refunded AND
    // already released. Releasing again here would decrement a reservation that
    // is not ours. Do nothing.
    this.released = true;
    return { refunded: false };
  }

  private async flush(stage: GenerationStage, release: boolean): Promise<void> {
    const delta = Math.round(this.measuredCents) - this.recordedCents;
    const doRelease = release && !this.released;

    if (delta === 0 && !doRelease) return;

    this.recordedCents += delta;
    if (doRelease) this.released = true;

    const request: RecordCostRequest = {
      jobId: this.jobId,
      parentId: this.parentId,
      stage,
      provider: 'papercub',
      modelId: 'settlement',
      costCents: delta,
      inputTokens: null,
      outputTokens: null,
      imageCount: 0,
      latencyMs: 0,
    };

    await this.db.recordCost({ request, costCentsDelta: delta, final: doRelease });
  }
}

/**
 * DECISIONS.md §3.3 — the global daily spend cap.
 *
 * This is deliberately NOT a per-user check and must NOT surface as a quota
 * error. docs/ARCHITECTURE.md: "The global daily cap surfaces as
 * `service_halted`, not as a quota error — do not blame the user for our cap."
 * A halted job is left on the queue to be picked up after the halt lifts; it is
 * never failed, and it never consumes the user's story.
 */
export async function isGlobalSpendHalted(
  db: WorkerDb,
  capCents: number,
): Promise<{ halted: boolean; spentTodayCents: number }> {
  const spentTodayCents = await db.globalSpendTodayCents();
  return { halted: spentTodayCents >= capCents, spentTodayCents };
}
