import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MONTHLY_COST_CEILING_CENTS, QUOTA } from '../src/constants';

/**
 * SQL cannot import TypeScript, so `claim_story_quota` hardcodes the cost
 * ceiling and the per-tier story limits. That duplication is deliberate — these
 * are exactly the numbers a caller must never be allowed to supply, so the
 * security boundary requires them to live server-side.
 *
 * The risk is silent drift: raise the quota in constants.ts, forget the
 * migration, and the app advertises a limit the database will not honour.
 *
 * CLAUDE.md: "if a bug costs money or leaks data, it gets a regression test."
 * This is that test.
 */
const SQL = readFileSync(
  join(__dirname, '../../../supabase/migrations/20260825182000_security_definer_functions.sql'),
  'utf8',
);

const claimFn = SQL.slice(
  SQL.indexOf('function public.claim_story_quota'),
  SQL.indexOf('grant execute on function public.claim_story_quota'),
);

describe('claim_story_quota mirrors constants.ts', () => {
  it('enforces the same monthly cost ceiling', () => {
    expect(claimFn).toContain(String(MONTHLY_COST_CEILING_CENTS));
  });

  it('checks accrued + reserved + estimate, not accrued alone', () => {
    // Omitting `reserved` would let concurrent enqueues each pass the ceiling —
    // the exact runaway-spend scenario the ceiling exists to prevent.
    expect(claimFn).toMatch(
      /cost_cents_accrued\s*\+\s*(?:[a-z_]+\.)?cost_cents_reserved\s*\+/,
    );
  });

  it('locks the usage row so concurrent claims serialise', () => {
    expect(claimFn.toLowerCase()).toContain('for update');
  });

  it('uses the same per-tier story limits', () => {
    expect(claimFn).toMatch(
      new RegExp(`then\\s*${QUOTA.family.storiesPerPeriod}\\s*else\\s*${QUOTA.free.storiesTotal}`),
    );
  });
});

describe('refund_story_quota is idempotent', () => {
  const refundFn = SQL.slice(
    SQL.indexOf('function public.refund_story_quota'),
    SQL.indexOf('grant execute on function public.refund_story_quota'),
  );

  it('short-circuits when quota_refunded is already set', () => {
    // Without this guard, repeated refunds are a free-story exploit.
    expect(refundFn).toMatch(/if\s+v_job\.quota_refunded\s+then/);
  });

  it('always releases the reservation without going negative', () => {
    expect(refundFn).toMatch(/greatest\(\s*0\s*,\s*cost_cents_reserved/);
  });
});
