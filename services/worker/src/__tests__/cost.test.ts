/**
 * CLAUDE.md: "if a bug costs money or leaks data, it gets a regression test."
 *
 * Every test here corresponds to a specific way the cost accounting could
 * silently lose or duplicate real money. They use FAKE providers — nothing here
 * touches the network, and the suite runs with no API keys configured.
 */

import { describe, expect, it } from 'vitest';
import { REFUNDABLE_JOB_ERRORS } from '@papercub/shared';
import type { JobErrorCode } from '@papercub/shared';
import { CostLedger, isGlobalSpendHalted } from '../cost';
import { createFakeDb, usage } from '../testing/fakes';

const JOB_ID = '22222222-2222-4222-8222-222222222222';
const PARENT_ID = '33333333-3333-4333-8333-333333333333';

function ledgerWith(db = createFakeDb()) {
  return { db, ledger: new CostLedger({ db, jobId: JOB_ID, parentId: PARENT_ID }) };
}

describe('CostLedger — measured accumulation', () => {
  it('records a delta per provider call and never re-records what it already wrote', async () => {
    const { db, ledger } = ledgerWith();

    await ledger.recordProviderCall('writing_story', usage(2));
    await ledger.recordProviderCall('illustrating_cover', usage(4));
    await ledger.recordProviderCall('illustrating_pages', usage(3));

    expect(db.state.costCalls.map((c) => c.costCentsDelta)).toEqual([2, 4, 3]);
    expect(db.totalRecordedCents()).toBe(9);
    expect(ledger.totalMeasuredCents).toBe(9);
  });

  it('accumulates sub-cent costs instead of rounding each call to zero', async () => {
    // The regression this guards: a 13-image bedtime book where every image
    // costs 0.39c. Flooring per call records 0. Rounding per call records 0 for
    // each and then 13 books look free. The running-total rounding must land on
    // the true 5c.
    const { db, ledger } = ledgerWith();

    for (let i = 0; i < 13; i += 1) {
      await ledger.recordProviderCall('illustrating_pages', usage(0.39));
    }

    expect(ledger.totalMeasuredCents).toBeCloseTo(5.07, 5);
    expect(db.totalRecordedCents()).toBe(5);
    // Never negative on any individual call.
    expect(db.state.costCalls.every((c) => c.costCentsDelta >= 0)).toBe(true);
  });

  it('flushes the sub-cent remainder on settlement so measured spend is not lost', async () => {
    const { db, ledger } = ledgerWith();

    await ledger.recordProviderCall('writing_story', usage(1.6));
    expect(db.totalRecordedCents()).toBe(2);

    await ledger.recordProviderCall('narrating', usage(0.9));
    // Running total 2.5 -> rounds to 3 (banker-free Math.round), delta 1.
    expect(db.totalRecordedCents()).toBe(3);

    await ledger.settleSuccess();
    expect(db.totalRecordedCents()).toBe(Math.round(ledger.totalMeasuredCents));
  });

  it('records the true measured cost even when it exceeds the reserved estimate', async () => {
    // Retries are exactly the runaway the ceiling exists to catch. If the ledger
    // ever clamped measured spend to the estimate, the ceiling would be
    // enforced on a number that can never exceed the estimate — i.e. never.
    const { db, ledger } = ledgerWith();

    for (let i = 0; i < 8; i += 1) {
      await ledger.recordProviderCall('illustrating_pages', usage(20));
    }

    expect(db.totalRecordedCents()).toBe(160);
  });
});

describe('CostLedger — the reservation is released exactly once', () => {
  it('releases on success, with exactly one final call', async () => {
    const { db, ledger } = ledgerWith();

    await ledger.recordProviderCall('writing_story', usage(5));
    await ledger.settleSuccess();

    expect(db.finalCallCount()).toBe(1);
    expect(db.state.refundCalls).toHaveLength(0);
    expect(ledger.reservationReleased).toBe(true);
  });

  it('releases via record_cost — NOT a refund — for a non-refundable failure', async () => {
    const { db, ledger } = ledgerWith();

    await ledger.recordProviderCall('moderating_input', usage(1));
    const result = await ledger.settleFailure('moderation_blocked_input_image');

    expect(result.refunded).toBe(false);
    expect(db.state.refundCalls).toHaveLength(0);
    // The reservation still has to come back — it just does not come with a
    // free story attached.
    expect(db.finalCallCount()).toBe(1);
  });

  it('releases via the refund — NOT record_cost — for a refundable failure', async () => {
    // This is the double-release bug. refund_story_quota already decrements
    // cost_cents_reserved by this job's estimate. A record_cost(final) as well
    // would decrement it twice, freeing a CONCURRENT job's reservation and
    // quietly lifting the account's cost ceiling.
    const { db, ledger } = ledgerWith();

    await ledger.recordProviderCall('illustrating_cover', usage(4));
    const result = await ledger.settleFailure('provider_timeout');

    expect(result.refunded).toBe(true);
    expect(db.state.refundCalls).toEqual([JOB_ID]);
    expect(db.finalCallCount()).toBe(0);
    expect(ledger.reservationReleased).toBe(true);
  });

  it('does not release again when a previous attempt already refunded', async () => {
    // refund_story_quota is guarded by generation_jobs.quota_refunded and
    // returns alreadyRefunded. That means the reservation was released on the
    // FIRST attempt, so this attempt must release nothing at all.
    const db = createFakeDb({ alreadyRefunded: true });
    const ledger = new CostLedger({ db, jobId: JOB_ID, parentId: PARENT_ID });

    await ledger.recordProviderCall('illustrating_pages', usage(2));
    const result = await ledger.settleFailure('provider_error');

    expect(result.refunded).toBe(false);
    expect(db.finalCallCount()).toBe(0);
    expect(db.state.refundCalls).toEqual([JOB_ID]);
  });

  it('still records measured spend on a refundable failure', async () => {
    // A refunded story is still a story we paid a provider for. Refunding the
    // quota must not erase the spend — that spend is what the ceiling and the
    // §6 cost-per-story alert are watching.
    const { db, ledger } = ledgerWith();

    await ledger.recordProviderCall('writing_story', usage(1.5));
    await ledger.recordProviderCall('illustrating_cover', usage(4.2));
    await ledger.settleFailure('moderation_blocked_output_image');

    expect(db.totalRecordedCents()).toBe(6);
    expect(db.state.costCalls.every((c) => c.final === false)).toBe(true);
  });
});

describe('CostLedger — refund happens for exactly the right error codes', () => {
  const ALL_CODES: JobErrorCode[] = [
    'moderation_blocked_input_image',
    'moderation_blocked_input_text',
    'moderation_blocked_output_text',
    'moderation_blocked_output_image',
    'reading_level_failed',
    'invalid_structured_output',
    'provider_timeout',
    'provider_error',
    'provider_rate_limited',
    'provider_safety_refusal',
    'regen_budget_exhausted',
    'cost_ceiling_exceeded',
    'storage_error',
    'cancelled',
    'internal',
  ];

  it.each(ALL_CODES)('%s refunds if and only if it is in REFUNDABLE_JOB_ERRORS', async (code) => {
    const { db, ledger } = ledgerWith();
    await ledger.recordProviderCall('writing_story', usage(1));

    const result = await ledger.settleFailure(code);
    const shouldRefund = REFUNDABLE_JOB_ERRORS.includes(code);

    expect(result.refunded).toBe(shouldRefund);
    expect(db.state.refundCalls.length).toBe(shouldRefund ? 1 : 0);

    // Whichever path was taken, the reservation came back exactly once.
    const releases = db.finalCallCount() + db.state.refundCalls.length;
    expect(releases).toBe(1);
  });

  it('never refunds a failure the user caused', async () => {
    // The two input gates are the user's own content. Blocking them fails the
    // story without giving a story back — and both are deliberately absent from
    // REFUNDABLE_JOB_ERRORS. A regression that added them would make the free
    // tier infinitely reusable by uploading something that always blocks.
    expect(REFUNDABLE_JOB_ERRORS).not.toContain('moderation_blocked_input_image');
    expect(REFUNDABLE_JOB_ERRORS).not.toContain('moderation_blocked_input_text');
  });
});

describe('CostLedger — a crash mid-pipeline does not double-charge', () => {
  it('settles only the unrecorded remainder after several recorded calls', async () => {
    const { db, ledger } = ledgerWith();

    await ledger.recordProviderCall('writing_story', usage(1.2));
    await ledger.recordProviderCall('illustrating_cover', usage(3.9));
    await ledger.recordProviderCall('illustrating_pages', usage(2.1));

    const beforeSettle = db.totalRecordedCents();
    await ledger.settleFailure('provider_error');

    const total = db.totalRecordedCents();

    // The settlement adds at most the sub-cent remainder — never the whole
    // total a second time.
    expect(total).toBe(Math.round(ledger.totalMeasuredCents));
    expect(total - beforeSettle).toBeLessThanOrEqual(1);
    expect(total).toBeLessThan(beforeSettle * 2);
  });

  it('is idempotent if settle is somehow reached twice', async () => {
    const { db, ledger } = ledgerWith();

    await ledger.recordProviderCall('writing_story', usage(3));
    await ledger.settleSuccess();
    await ledger.settleSuccess();

    expect(db.totalRecordedCents()).toBe(3);
    // The critical one: still exactly one release.
    expect(db.finalCallCount()).toBe(1);
  });
});

describe('global daily spend cap', () => {
  it('halts at or above the cap', async () => {
    const db = createFakeDb({ globalSpendTodayCents: 50_000 });
    await expect(isGlobalSpendHalted(db, 50_000)).resolves.toEqual({
      halted: true,
      spentTodayCents: 50_000,
    });
  });

  it('does not halt below the cap', async () => {
    const db = createFakeDb({ globalSpendTodayCents: 49_999 });
    await expect(isGlobalSpendHalted(db, 50_000)).resolves.toEqual({
      halted: false,
      spentTodayCents: 49_999,
    });
  });
});
