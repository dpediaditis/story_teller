-- Security-definer functions: the only way a caller-JWT-scoped Edge Function
-- may write rows it does not own outright (docs/ARCHITECTURE.md). Narrow,
-- audited signatures only — no generic "run this SQL" escape hatch.
--
-- SECURITY-BOUNDARY NOTE: MONTHLY_COST_CEILING_CENTS (385) and the story/
-- character quota limits below are hardcoded rather than passed in, on
-- purpose — packages/shared/src/constants.ts cannot be read from SQL, and
-- these are exactly the numbers a caller must never be trusted to supply
-- (docs/AGENT_BRIEFS.md B2 red line: "Never trust a client-supplied
-- entitlement, price, cost or quota number"). Keep this file's literals in
-- sync with DECISIONS.md / constants.ts by hand; a mismatch is a bug in this
-- migration, not in constants.ts.

/* ═══ claim_story_quota ══════════════════════════════════════════════════
 * Called by the `stories` Edge Function (as the authenticated caller) after
 * it has already validated the request body and resolved character ids.
 * Atomically: re-checks ownership, re-checks the five quota/ceiling gates
 * server-side, and — only if they pass — creates the story, its
 * story_characters rows, and its generation_jobs row, and reserves the
 * estimated cost on usage_records. All in one function invocation, i.e. one
 * transaction: the same transaction as the quota increment, per
 * docs/AGENT_BRIEFS.md item 7.
 *
 * Idempotent on (parent_id, idempotency_key): a retried call with a key that
 * already produced a job returns that job instead of claiming twice.
 * ═══════════════════════════════════════════════════════════════════════ */
create or replace function public.claim_story_quota(
  p_child_id uuid,
  p_character_ids uuid[],
  p_theme public.story_theme,
  p_mood public.story_mood,
  p_length public.story_length,
  p_render_technique public.render_technique,
  p_model_bundle_version text,
  p_pages_total integer,
  p_estimated_cost_cents integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_id uuid := auth.uid();
  v_existing record;
  v_usage record;
  v_tier public.entitlement_tier;
  v_topup integer;
  v_stories_limit integer;
  v_blocked public.quota_block_reason;
  v_story_id uuid;
  v_job_id uuid;
  v_consumed_topup boolean := false;
  v_bad_character_count integer;
begin
  if v_parent_id is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.child_profiles
    where id = p_child_id and parent_id = v_parent_id
  ) then
    raise exception 'forbidden: child does not belong to caller' using errcode = '42501';
  end if;

  select count(*) into v_bad_character_count
  from unnest(p_character_ids) cid
  where not exists (
    select 1 from public.characters c
    where c.id = cid and c.child_id = p_child_id
  );
  if coalesce(array_length(p_character_ids, 1), 0) = 0 or v_bad_character_count > 0 then
    raise exception 'forbidden: character does not belong to caller''s child' using errcode = '42501';
  end if;

  -- Idempotent replay.
  select * into v_existing
  from public.generation_jobs
  where parent_id = v_parent_id and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'allowed', true,
      'idempotentReplay', true,
      'storyId', v_existing.story_id,
      'jobId', v_existing.id
    );
  end if;

  select * into v_usage
  from public.usage_records
  where parent_id = v_parent_id
    and (period_end is null or now() < period_end)
  order by period_start desc
  limit 1
  for update;

  if not found then
    raise exception 'no active usage period for parent %', v_parent_id;
  end if;

  select tier, topup_stories_remaining into v_tier, v_topup
  from public.subscriptions
  where parent_id = v_parent_id;

  if not found then
    v_tier := 'free';
    v_topup := 0;
  end if;

  -- Keep in sync with QUOTA in packages/shared/src/constants.ts.
  v_stories_limit := case when v_tier = 'family' then 5 else 1 end;

  -- Gate: measured cost ceiling, checked atomically against accrued + reserved
  -- + this job's estimate. Checking only accrued would let concurrent
  -- enqueues each pass — the exact runaway scenario the ceiling exists to stop.
  if v_usage.cost_cents_accrued + v_usage.cost_cents_reserved + p_estimated_cost_cents > 385 then
    v_blocked := 'cost_ceiling_reached';
  elsif v_usage.stories_used >= v_stories_limit and coalesce(v_topup, 0) <= 0 then
    v_blocked := case when v_tier = 'free' then 'free_tier_consumed' else 'story_quota_exhausted' end;
  else
    v_blocked := null;
  end if;

  if v_blocked is not null then
    return jsonb_build_object(
      'allowed', false,
      'blockedBy', v_blocked,
      'storiesUsed', v_usage.stories_used,
      'storiesLimit', v_stories_limit,
      'topupStoriesRemaining', coalesce(v_topup, 0),
      'costCentsAccrued', v_usage.cost_cents_accrued,
      'costCentsReserved', v_usage.cost_cents_reserved,
      'costCeilingCents', 385,
      'periodEnd', v_usage.period_end
    );
  end if;

  v_consumed_topup := v_usage.stories_used >= v_stories_limit;

  if v_consumed_topup then
    update public.subscriptions
      set topup_stories_remaining = topup_stories_remaining - 1
      where parent_id = v_parent_id;
  else
    update public.usage_records
      set stories_used = stories_used + 1
      where id = v_usage.id;
  end if;

  update public.usage_records
    set cost_cents_reserved = cost_cents_reserved + p_estimated_cost_cents,
        updated_at = now()
    where id = v_usage.id;

  insert into public.stories (
    child_id, theme, mood, length, status, render_technique, model_bundle_version
  ) values (
    p_child_id, p_theme, p_mood, p_length, 'queued', p_render_technique, p_model_bundle_version
  )
  returning id into v_story_id;

  insert into public.story_characters (story_id, character_id, role, order_index)
  select v_story_id, cid, case when ord = 1 then 'lead' else 'companion' end, ord - 1
  from unnest(p_character_ids) with ordinality as t(cid, ord);

  insert into public.generation_jobs (
    parent_id, story_id, type, status, stage, pages_total, estimated_cost_cents, idempotency_key
  ) values (
    v_parent_id, v_story_id, 'story_generate', 'queued', 'queued', p_pages_total,
    p_estimated_cost_cents, p_idempotency_key
  )
  returning id into v_job_id;

  return jsonb_build_object(
    'allowed', true,
    'idempotentReplay', false,
    'storyId', v_story_id,
    'jobId', v_job_id,
    'storiesUsed', case when v_consumed_topup then v_usage.stories_used else v_usage.stories_used + 1 end,
    'storiesLimit', v_stories_limit,
    'topupStoriesRemaining', case when v_consumed_topup then coalesce(v_topup, 0) - 1 else coalesce(v_topup, 0) end,
    'costCentsAccrued', v_usage.cost_cents_accrued,
    'costCentsReserved', v_usage.cost_cents_reserved + p_estimated_cost_cents,
    'costCeilingCents', 385,
    'periodEnd', v_usage.period_end
  );
end;
$$;

revoke all on function public.claim_story_quota(
  uuid, uuid[], public.story_theme, public.story_mood, public.story_length,
  public.render_technique, text, integer, integer, text
) from public;
grant execute on function public.claim_story_quota(
  uuid, uuid[], public.story_theme, public.story_mood, public.story_length,
  public.render_technique, text, integer, integer, text
) to authenticated;
-- NOTE: not granted to `anon` — that PostgREST role has no auth.uid() at all.
-- Supabase's anonymous sign-in issues a real JWT with role `authenticated`
-- (auth.users.is_anonymous = true), which is what this function is for.

/* ═══ refund_story_quota ═════════════════════════════════════════════════
 * Called by the worker when a job's error_code lands in REFUNDABLE_JOB_ERRORS.
 * Idempotent, guarded by generation_jobs.quota_refunded — without that guard
 * this is a free-story exploit (docs/AGENT_BRIEFS.md item 7). Also releases
 * the job's reserved cost, always, refund or not — "Reserved cost is always
 * released" (docs/ARCHITECTURE.md).
 * ═══════════════════════════════════════════════════════════════════════ */
create or replace function public.refund_story_quota(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_usage_id uuid;
  v_refunded_topup boolean := false;
begin
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then
    raise exception 'generation_jobs % not found', p_job_id;
  end if;

  if v_job.quota_refunded then
    -- Idempotent no-op: already refunded once.
    return jsonb_build_object('refunded', false, 'alreadyRefunded', true);
  end if;

  select id into v_usage_id
  from public.usage_records
  where parent_id = v_job.parent_id
    and (period_end is null or now() < period_end)
  order by period_start desc
  limit 1
  for update;

  if v_usage_id is not null then
    -- Release reservation regardless of refund path.
    update public.usage_records
      set cost_cents_reserved = greatest(0, cost_cents_reserved - v_job.estimated_cost_cents),
          updated_at = now()
      where id = v_usage_id;

    -- Give the story back: prefer restoring base quota (stories_used -= 1);
    -- if the count is already at zero this job must have consumed a topup,
    -- so give the topup back instead.
    if exists (
      select 1 from public.usage_records where id = v_usage_id and stories_used > 0
    ) then
      update public.usage_records
        set stories_used = stories_used - 1
        where id = v_usage_id;
    else
      update public.subscriptions
        set topup_stories_remaining = topup_stories_remaining + 1
        where parent_id = v_job.parent_id;
      v_refunded_topup := true;
    end if;
  end if;

  update public.generation_jobs
    set quota_refunded = true
    where id = p_job_id;

  return jsonb_build_object('refunded', true, 'refundedTopup', v_refunded_topup);
end;
$$;

revoke all on function public.refund_story_quota(uuid) from public;
grant execute on function public.refund_story_quota(uuid) to service_role;

/* ═══ record_cost ════════════════════════════════════════════════════════
 * Called by the worker after every provider call returns, per
 * docs/ARCHITECTURE.md: "Every provider call writes a measured cost row the
 * moment it returns." Adds to the job's and the usage period's measured
 * spend. When p_final is true (the 'done' stage, or a terminal failure that
 * isn't going through refund_story_quota), also releases this job's full
 * reservation back out of cost_cents_reserved.
 * ═══════════════════════════════════════════════════════════════════════ */
create or replace function public.record_cost(
  p_job_id uuid,
  p_cost_cents integer,
  p_final boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  update public.generation_jobs
    set cost_cents = cost_cents + p_cost_cents,
        finished_at = case when p_final then now() else finished_at end
    where id = p_job_id
    returning * into v_job;

  if not found then
    raise exception 'generation_jobs % not found', p_job_id;
  end if;

  update public.usage_records
    set cost_cents_accrued = cost_cents_accrued + p_cost_cents,
        cost_cents_reserved = case
          when p_final then greatest(0, cost_cents_reserved - v_job.estimated_cost_cents)
          else cost_cents_reserved
        end,
        updated_at = now()
    where id = (
      select id from public.usage_records
      where parent_id = v_job.parent_id
        and (period_end is null or now() < period_end)
      order by period_start desc
      limit 1
    );
end;
$$;

revoke all on function public.record_cost(uuid, integer, boolean) from public;
grant execute on function public.record_cost(uuid, integer, boolean) to service_role;

/* ═══ apply_revenuecat_event ═════════════════════════════════════════════
 * Called by the revenuecat-webhook Edge Function, AFTER it has verified
 * REVENUECAT_WEBHOOK_SECRET (B2's job, not this function's). RevenueCat is
 * not an authorization source by itself (DECISIONS.md §8) — this function is
 * what turns a verified webhook into the row the worker actually reads.
 *
 * p_revenuecat_app_user_id is expected to equal the Supabase auth uid (how
 * the app configures RevenueCat), so it also identifies parent_accounts.id.
 * ═══════════════════════════════════════════════════════════════════════ */
create or replace function public.apply_revenuecat_event(
  p_parent_id uuid,
  p_product_id public.product_id,
  p_tier public.entitlement_tier,
  p_status public.subscription_status,
  p_renews_at timestamptz,
  p_expires_at timestamptz,
  p_original_transaction_id text,
  p_revenuecat_app_user_id text,
  p_environment public.store_environment,
  p_is_topup boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.parent_accounts where id = p_parent_id) then
    raise exception 'parent_accounts % not found', p_parent_id;
  end if;

  insert into public.subscriptions (
    parent_id, product_id, tier, status, renews_at, expires_at,
    original_transaction_id, revenuecat_app_user_id, environment,
    topup_stories_remaining, updated_at
  ) values (
    p_parent_id, p_product_id, p_tier, p_status, p_renews_at, p_expires_at,
    p_original_transaction_id, p_revenuecat_app_user_id, p_environment,
    case when p_is_topup then 3 else 0 end, now()
  )
  on conflict (parent_id) do update set
    product_id = excluded.product_id,
    tier = excluded.tier,
    status = excluded.status,
    renews_at = excluded.renews_at,
    expires_at = excluded.expires_at,
    original_transaction_id = excluded.original_transaction_id,
    revenuecat_app_user_id = excluded.revenuecat_app_user_id,
    environment = excluded.environment,
    -- Top-ups accumulate (non-expiring, DECISIONS.md §1); every other field
    -- from RevenueCat is a snapshot and replaces the previous value.
    topup_stories_remaining = public.subscriptions.topup_stories_remaining
      + case when p_is_topup then 3 else 0 end,
    updated_at = now();

  -- A newly-active family subscription opens (or keeps open) the renewing
  -- usage period. Free tier's single non-renewing row is left alone.
  if p_tier = 'family' and p_status = 'active' then
    insert into public.usage_records (parent_id, period_start, period_end)
    select p_parent_id, now(), p_renews_at
    where not exists (
      select 1 from public.usage_records
      where parent_id = p_parent_id and period_end is not null and now() < period_end
    );
  end if;
end;
$$;

revoke all on function public.apply_revenuecat_event(
  uuid, public.product_id, public.entitlement_tier, public.subscription_status,
  timestamptz, timestamptz, text, text, public.store_environment, boolean
) from public;
grant execute on function public.apply_revenuecat_event(
  uuid, public.product_id, public.entitlement_tier, public.subscription_status,
  timestamptz, timestamptz, text, text, public.store_environment, boolean
) to service_role;

/* ═══ merge_accounts ══════════════════════════════════════════════════════
 * Called by the account-merge Edge Function once it has validated the signed
 * merge token names uid A (docs/ARCHITECTURE.md account merge flow).
 *
 *  'merge'             — child_profiles.parent_id A -> B (everything owned via
 *                         child_id follows automatically), then uid A is
 *                         retired (soft-deleted, purged after
 *                         RETENTION_DAYS.accountHardDelete). Actual storage
 *                         object re-keying is a worker/edge-function-level
 *                         operation on the storage API, out of scope for SQL.
 *  'keep_account_only' — nothing moves. uid A is retired the same way, so its
 *                         content is retained for RETENTION_DAYS.
 *                         orphanedAnonymousContent (also 30 days) and then
 *                         purged by the same scheduled job. Never deleted
 *                         immediately.
 * ═══════════════════════════════════════════════════════════════════════ */
create or replace function public.merge_accounts(
  p_source_parent_id uuid,
  p_target_parent_id uuid,
  p_strategy public.merge_strategy
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_source_parent_id = p_target_parent_id then
    raise exception 'source and target parent accounts must differ';
  end if;

  if not exists (select 1 from public.parent_accounts where id = p_source_parent_id) then
    raise exception 'parent_accounts % (source) not found', p_source_parent_id;
  end if;
  if not exists (select 1 from public.parent_accounts where id = p_target_parent_id) then
    raise exception 'parent_accounts % (target) not found', p_target_parent_id;
  end if;

  if p_strategy = 'merge' then
    update public.child_profiles
      set parent_id = p_target_parent_id
      where parent_id = p_source_parent_id;
  end if;

  -- Both strategies retire the source uid; 'merge' has already moved its data
  -- out from under it, 'keep_account_only' leaves the data in place to be
  -- purged after the retention window (never deleted immediately).
  update public.parent_accounts
    set deleted_at = now()
    where id = p_source_parent_id and deleted_at is null;
end;
$$;

revoke all on function public.merge_accounts(uuid, uuid, public.merge_strategy) from public;
grant execute on function public.merge_accounts(uuid, uuid, public.merge_strategy) to service_role;
