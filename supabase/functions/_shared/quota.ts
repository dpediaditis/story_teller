// Read-side quota/entitlement snapshot builder, shared by `session` and every
// mutating endpoint that returns `quota` in its response (createCharacter,
// createStory, regeneratePage, refreshEntitlement).
//
// This NEVER performs the write side of the quota gate — that is
// claim_story_quota()/refund_story_quota(), security-definer functions in
// supabase/migrations/20260825182000_security_definer_functions.sql, called
// directly by the `stories` function. This module only computes the
// client-visible snapshot from already-committed rows.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, EntitlementSnapshot, QuotaSnapshot } from '@papercub/shared';
import { MONTHLY_COST_CEILING_CENTS, QUOTA } from '@papercub/shared';

export interface RawUsage {
  tier: 'free' | 'family';
  storiesUsed: number;
  topupStoriesRemaining: number;
  costCentsAccrued: number;
  costCentsReserved: number;
  periodEnd: string | null;
  charactersUsed: number;
}

/**
 * Internal-only numbers (includes `costCentsReserved`, which QuotaSnapshot
 * deliberately omits from the wire shape). Endpoints that need to check the
 * cost ceiling against a NEW estimate before writing (createCharacter,
 * regeneratePage — paths with no security-definer claim function, see
 * _shared/jobs.ts) use this instead of re-deriving it from the public
 * QuotaSnapshot.
 */
export async function loadRawUsage(
  supabase: SupabaseClient<Database>,
  parentId: string,
): Promise<RawUsage> {
  const nowIso = new Date().toISOString();
  const [subRes, usageRes, charCountRes] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('tier, topup_stories_remaining')
      .eq('parent_id', parentId)
      .maybeSingle(),
    supabase
      .from('usage_records')
      .select('stories_used, period_end, cost_cents_accrued, cost_cents_reserved')
      .eq('parent_id', parentId)
      .or(`period_end.is.null,period_end.gt.${nowIso}`)
      .order('period_start', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('characters').select('id', { count: 'exact', head: true }).is('archived_at', null),
  ]);
  if (subRes.error) throw subRes.error;
  if (usageRes.error) throw usageRes.error;
  if (charCountRes.error) throw charCountRes.error;

  return {
    tier: subRes.data?.tier ?? 'free',
    storiesUsed: usageRes.data?.stories_used ?? 0,
    topupStoriesRemaining: subRes.data?.topup_stories_remaining ?? 0,
    costCentsAccrued: usageRes.data?.cost_cents_accrued ?? 0,
    costCentsReserved: usageRes.data?.cost_cents_reserved ?? 0,
    periodEnd: usageRes.data?.period_end ?? null,
    charactersUsed: charCountRes.count ?? 0,
  };
}

export async function loadEntitlementAndQuota(
  supabase: SupabaseClient<Database>,
  parentId: string,
): Promise<{ entitlement: EntitlementSnapshot; quota: QuotaSnapshot }> {
  const nowIso = new Date().toISOString();

  const [subRes, usageRes, charCountRes] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('tier, status, product_id, renews_at, expires_at, environment, topup_stories_remaining')
      .eq('parent_id', parentId)
      .maybeSingle(),
    supabase
      .from('usage_records')
      .select('stories_used, characters_used, period_end, cost_cents_accrued, cost_cents_reserved')
      .eq('parent_id', parentId)
      .or(`period_end.is.null,period_end.gt.${nowIso}`)
      .order('period_start', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('characters')
      .select('id', { count: 'exact', head: true })
      .is('archived_at', null),
  ]);

  if (subRes.error) throw subRes.error;
  if (usageRes.error) throw usageRes.error;
  if (charCountRes.error) throw charCountRes.error;

  const sub = subRes.data;
  const usage = usageRes.data;
  const tier = sub?.tier ?? 'free';

  const storiesLimit = tier === 'family' ? QUOTA.family.storiesPerPeriod : QUOTA.free.storiesTotal;
  const charactersLimit = tier === 'family' ? QUOTA.family.charactersTotal : QUOTA.free.charactersTotal;
  const allowedLengths = tier === 'family' ? [...QUOTA.family.allowedLengths] : [...QUOTA.free.allowedLengths];

  const storiesUsed = usage?.stories_used ?? 0;
  const topupStoriesRemaining = sub?.topup_stories_remaining ?? 0;
  const costCentsAccrued = usage?.cost_cents_accrued ?? 0;
  const costCentsReserved = usage?.cost_cents_reserved ?? 0;
  const periodEnd = usage?.period_end ?? null;
  const charactersUsed = charCountRes.count ?? 0;

  let blockedBy: QuotaSnapshot['blockedBy'] = null;
  if (costCentsAccrued + costCentsReserved >= MONTHLY_COST_CEILING_CENTS) {
    blockedBy = 'cost_ceiling_reached';
  } else if (storiesUsed >= storiesLimit && topupStoriesRemaining <= 0) {
    blockedBy = tier === 'free' ? 'free_tier_consumed' : 'story_quota_exhausted';
  } else if (charactersUsed >= charactersLimit) {
    blockedBy = 'character_quota_exhausted';
  }

  const quota: QuotaSnapshot = {
    storiesUsed,
    storiesLimit,
    storiesRemaining: Math.max(0, storiesLimit - storiesUsed) + topupStoriesRemaining,
    topupStoriesRemaining,
    charactersUsed,
    charactersLimit,
    allowedLengths: allowedLengths as QuotaSnapshot['allowedLengths'],
    freeTierConsumed: tier === 'free' && storiesUsed >= QUOTA.free.storiesTotal,
    periodEnd,
    costCentsAccrued,
    costCeilingCents: MONTHLY_COST_CEILING_CENTS,
    blockedBy,
  };

  const entitlement: EntitlementSnapshot = {
    tier,
    status: sub?.status ?? 'none',
    productId: sub?.product_id ?? null,
    // Free tier never renews — DECISIONS.md §4: never render a reset date for
    // free users. Family's periodEnd mirrors the open usage_records row.
    periodEnd: tier === 'free' ? null : periodEnd,
    renewsAt: sub?.renews_at ?? null,
    environment: sub?.environment ?? 'production',
  };

  return { entitlement, quota };
}

/**
 * Global generation halt (DECISIONS.md §3.3). No schema table exists for this
 * in B1's migrations (supabase/migrations has no settings/halt table) — see
 * this agent's handover report. Implemented as an env-var kill switch so ops
 * can flip it without a deploy; a durable, auditable version belongs in a
 * future B1 migration (e.g. an `ops_flags` table read by both this function
 * and the worker).
 */
export function isGenerationHalted(): boolean {
  return (Deno.env.get('GENERATION_HALTED') ?? 'false').toLowerCase() === 'true';
}
