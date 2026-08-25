-- Fixes findings 1-4 and 9 from the E1 security review. Each of these is a
-- seam between agents that were individually correct.

/* ═══════════════════════════════════════════════════════════════════════════
 * FINDING 4 (prerequisite): mark whether a job actually reserved cost.
 *
 * claim_story_quota is the only thing that increments
 * usage_records.cost_cents_reserved, but record_cost(p_final => true)
 * unconditionally decrements by the job's estimated_cost_cents. character_build
 * and page_regenerate jobs get an estimate written on the row without ever
 * reserving, so settling one releases a DIFFERENT job's reservation — and the
 * per-account ceiling stops binding while a story is still spending.
 * ═══════════════════════════════════════════════════════════════════════════ */

alter table public.generation_jobs
  add column if not exists cost_reserved boolean not null default false;

comment on column public.generation_jobs.cost_reserved is
  'True only when this job added estimated_cost_cents to usage_records.'
  'cost_cents_reserved. record_cost may only release a reservation this job took.';

-- Existing story jobs did reserve; anything else did not.
update public.generation_jobs set cost_reserved = true where type = 'story_generate';

/* ═══════════════════════════════════════════════════════════════════════════
 * FINDING 2 + 3: claim_story_quota must not trust the caller, and must enqueue.
 *
 * The function is granted to `authenticated`, so it is reachable directly at
 * /rest/v1/rpc/claim_story_quota with nothing but the app's own JWT. It was
 * accepting p_estimated_cost_cents, p_length and p_pages_total as arguments,
 * which meant two gates that live only in the Edge Function's TypeScript were
 * bypassable: a free user could claim a bedtime story, and anyone could pass
 * estimate 0 so the ceiling test became `accrued + reserved + 0` and every
 * concurrent enqueue passed.
 *
 * Page counts and costs are now derived here from p_length, matching
 * STORY_SHAPE in packages/shared/src/constants.ts (6/10/12 pages, 45/64/74c).
 * The sql-constants-sync test asserts these stay in step.
 *
 * It also now enqueues, inside the same transaction as the inserts. Previously
 * nothing anywhere called pgmq.send: quota was consumed, the row was written,
 * and the job never reached the worker — so the refund path (worker-only) never
 * fired either. A user's single lifetime free story was lost with nothing to
 * show for it.
 * ═══════════════════════════════════════════════════════════════════════════ */

drop function if exists public.claim_story_quota(
  uuid, uuid[], public.story_theme, public.story_mood, public.story_length,
  public.render_technique, text, integer, integer, text
);

create or replace function public.claim_story_quota(
  p_child_id uuid,
  p_character_ids uuid[],
  p_theme public.story_theme,
  p_mood public.story_mood,
  p_length public.story_length,
  p_render_technique public.render_technique,
  p_model_bundle_version text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_id uuid;
  v_usage public.usage_records%rowtype;
  v_tier public.entitlement_tier := 'free';
  v_topup integer := 0;
  v_stories_limit integer;
  v_story_id uuid;
  v_job_id uuid;
  v_existing public.generation_jobs%rowtype;
  v_consumed_topup boolean;
  v_pages_total integer;
  v_estimated_cost_cents integer;
  v_age_band public.age_band;
  v_locale text;
  v_char uuid;
begin
  v_parent_id := auth.uid();
  if v_parent_id is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Ownership: the child, and every character, must belong to the caller.
  if not exists (
    select 1 from public.child_profiles
    where id = p_child_id and parent_id = v_parent_id and deleted_at is null
  ) then
    raise exception 'forbidden: child does not belong to caller' using errcode = '42501';
  end if;

  foreach v_char in array p_character_ids loop
    if not exists (
      select 1 from public.characters c
      join public.child_profiles cp on cp.id = c.child_id
      where c.id = v_char and cp.parent_id = v_parent_id and c.archived_at is null
    ) then
      raise exception 'forbidden: character does not belong to caller''s child'
        using errcode = '42501';
    end if;
  end loop;

  select age_band into v_age_band from public.child_profiles where id = p_child_id;
  select coalesce(locale, 'en') into v_locale from public.parent_accounts where id = v_parent_id;

  -- Idempotency: same key, same claim.
  select * into v_existing from public.generation_jobs
  where parent_id = v_parent_id and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'ok', true, 'idempotentReplay', true,
      'storyId', v_existing.story_id, 'jobId', v_existing.id
    );
  end if;

  -- DERIVED, never supplied. These mirror STORY_SHAPE in constants.ts.
  v_pages_total := case p_length
    when 'short' then 6 when 'normal' then 10 when 'bedtime' then 12 end;
  v_estimated_cost_cents := case p_length
    when 'short' then 45 when 'normal' then 64 when 'bedtime' then 74 end;

  select * into v_usage from public.usage_records
  where parent_id = v_parent_id
    and (period_end is null or now() < period_end)
  order by period_start desc
  limit 1
  for update;

  if not found then
    raise exception 'no active usage period for parent %', v_parent_id;
  end if;

  select tier, coalesce(topup_stories_remaining, 0)
    into v_tier, v_topup
  from public.subscriptions where parent_id = v_parent_id;

  v_tier := coalesce(v_tier, 'free');
  v_stories_limit := case when v_tier = 'family' then 5 else 1 end;

  -- ENTITLEMENT. Previously only enforced in TypeScript, so a free user could
  -- RPC directly for a bedtime book (13 images) on a grant budgeted for a
  -- short one (7 images).
  if v_tier <> 'family' and p_length <> 'short' then
    return jsonb_build_object(
      'ok', false, 'blockedBy', 'entitlement_required',
      'allowedLengths', jsonb_build_array('short')
    );
  end if;

  if v_usage.cost_cents_accrued + v_usage.cost_cents_reserved + v_estimated_cost_cents > 385 then
    return jsonb_build_object(
      'ok', false, 'blockedBy', 'cost_ceiling_reached',
      'costCentsAccrued', v_usage.cost_cents_accrued,
      'costCentsReserved', v_usage.cost_cents_reserved,
      'costCeilingCents', 385
    );
  elsif v_usage.stories_used >= v_stories_limit and v_topup <= 0 then
    return jsonb_build_object(
      'ok', false,
      'blockedBy', case when v_tier = 'family' then 'story_quota_exhausted'
                        else 'free_tier_consumed' end,
      'storiesUsed', v_usage.stories_used,
      'storiesLimit', v_stories_limit
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
    set cost_cents_reserved = cost_cents_reserved + v_estimated_cost_cents,
        updated_at = now()
    where id = v_usage.id;

  insert into public.stories (
    child_id, theme, mood, length, status, render_technique, model_bundle_version
  ) values (
    p_child_id, p_theme, p_mood, p_length, 'queued', p_render_technique, p_model_bundle_version
  ) returning id into v_story_id;

  insert into public.story_characters (story_id, character_id, role, order_index)
  select v_story_id, c.id, 'lead', c.ord - 1
  from unnest(p_character_ids) with ordinality as c(id, ord);

  insert into public.generation_jobs (
    parent_id, story_id, type, status, stage, pages_total,
    estimated_cost_cents, cost_reserved, idempotency_key
  ) values (
    v_parent_id, v_story_id, 'story_generate', 'queued', 'queued', v_pages_total,
    v_estimated_cost_cents, true, p_idempotency_key
  ) returning id into v_job_id;

  -- ENQUEUE, in this transaction. If the caller's transaction aborts, the
  -- message is rolled back with the quota claim rather than stranding it.
  perform pgmq.send('papercub_generation', jsonb_build_object(
    'type', 'story_generate',
    'jobId', v_job_id,
    'parentId', v_parent_id,
    'childId', p_child_id,
    'storyId', v_story_id,
    'characterIds', to_jsonb(p_character_ids),
    'theme', p_theme,
    'mood', p_mood,
    'length', p_length,
    'pageCount', v_pages_total,
    'ageBand', v_age_band,
    'renderTechnique', p_render_technique,
    'locale', v_locale,
    'estimatedCostCents', v_estimated_cost_cents,
    'modelBundleVersion', p_model_bundle_version,
    'enqueuedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'attempt', 1
  ));

  return jsonb_build_object(
    'ok', true,
    'storyId', v_story_id,
    'jobId', v_job_id,
    'pagesTotal', v_pages_total,
    'estimatedCostCents', v_estimated_cost_cents,
    'storiesUsed', case when v_consumed_topup then v_usage.stories_used
                        else v_usage.stories_used + 1 end,
    'storiesLimit', v_stories_limit,
    'costCentsAccrued', v_usage.cost_cents_accrued,
    'costCentsReserved', v_usage.cost_cents_reserved + v_estimated_cost_cents,
    'costCeilingCents', 385
  );
end;
$$;

revoke all on function public.claim_story_quota(
  uuid, uuid[], public.story_theme, public.story_mood, public.story_length,
  public.render_technique, text, text
) from public;
grant execute on function public.claim_story_quota(
  uuid, uuid[], public.story_theme, public.story_mood, public.story_length,
  public.render_technique, text, text
) to authenticated;

/* ═══════════════════════════════════════════════════════════════════════════
 * FINDING 1: refund_story_quota gave back a STORY for any job type.
 *
 * CostLedger.settleFailure() calls it for every refundable JobErrorCode
 * regardless of job type, and the function had no type guard. So a failed
 * character_build refunded a whole story — and page_regenerate throws
 * `regen_budget_exhausted` DETERMINISTICALLY on a third regeneration, which is
 * in REFUNDABLE_JOB_ERRORS. Ask for a third regen repeatedly and mint stories;
 * at stories_used = 0 it minted paid top-ups instead.
 * ═══════════════════════════════════════════════════════════════════════════ */

create or replace function public.refund_story_quota(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_usage_id uuid;
  v_refunded_topup boolean := false;
begin
  select * into v_job from public.generation_jobs where id = p_job_id;
  if not found then
    return jsonb_build_object('refunded', false, 'reason', 'job_not_found');
  end if;

  if v_job.quota_refunded then
    return jsonb_build_object('refunded', false, 'alreadyRefunded', true);
  end if;

  select id into v_usage_id from public.usage_records
  where parent_id = v_job.parent_id
    and (period_end is null or now() < period_end)
  order by period_start desc
  limit 1
  for update;

  if v_usage_id is not null and v_job.cost_reserved then
    update public.usage_records
      set cost_cents_reserved = greatest(0, cost_cents_reserved - v_job.estimated_cost_cents),
          updated_at = now()
      where id = v_usage_id;
  end if;

  -- Only a story job consumed a story. Everything else releases its
  -- reservation (above) and stops there.
  if v_job.type = 'story_generate' and v_usage_id is not null then
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

  update public.generation_jobs set quota_refunded = true where id = p_job_id;

  return jsonb_build_object(
    'refunded', v_job.type = 'story_generate',
    'refundedTopup', v_refunded_topup,
    'reservationReleased', v_job.cost_reserved
  );
end;
$$;

revoke all on function public.refund_story_quota(uuid) from public;
grant execute on function public.refund_story_quota(uuid) to service_role;

/* ═══════════════════════════════════════════════════════════════════════════
 * FINDING 4: record_cost may only release a reservation this job took.
 * FINDING 10: and only once — at-least-once queue delivery can redeliver a
 * finished job, and a second p_final would release a concurrent job's
 * reservation.
 * ═══════════════════════════════════════════════════════════════════════════ */

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
  v_job public.generation_jobs%rowtype;
  v_usage_id uuid;
begin
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then
    raise exception 'job % not found', p_job_id;
  end if;

  if p_cost_cents > 0 then
    update public.generation_jobs
      set cost_cents = cost_cents + p_cost_cents
      where id = p_job_id;
  end if;

  select id into v_usage_id from public.usage_records
  where parent_id = v_job.parent_id
    and (period_end is null or now() < period_end)
  order by period_start desc
  limit 1
  for update;

  if v_usage_id is null then
    return;
  end if;

  if p_cost_cents > 0 then
    update public.usage_records
      set cost_cents_accrued = cost_cents_accrued + p_cost_cents,
          updated_at = now()
      where id = v_usage_id;
  end if;

  -- Release only if this job actually reserved, and only the first time.
  if p_final and v_job.cost_reserved then
    update public.usage_records
      set cost_cents_reserved = greatest(0, cost_cents_reserved - v_job.estimated_cost_cents),
          updated_at = now()
      where id = v_usage_id;

    update public.generation_jobs
      set cost_reserved = false
      where id = p_job_id;
  end if;
end;
$$;

revoke all on function public.record_cost(uuid, integer, boolean) from public;
grant execute on function public.record_cost(uuid, integer, boolean) to service_role;

/* ═══════════════════════════════════════════════════════════════════════════
 * FINDING 9: clients could UPDATE any column of their own parent_accounts row.
 *
 * The anonymous rate limit branches on parent_accounts.is_anonymous, so a
 * modified client could PATCH is_anonymous = false and shed the limit for free.
 * The same policy allowed setting linked_providers and deleted_at.
 * ═══════════════════════════════════════════════════════════════════════════ */

drop policy if exists parent_accounts_update on public.parent_accounts;

create or replace function public.parent_accounts_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The service role (worker) may change anything; a user session may change
  -- only their own locale.
  if auth.uid() is null then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.is_anonymous is distinct from old.is_anonymous
     or new.linked_providers is distinct from old.linked_providers
     or new.email_hash is distinct from old.email_hash
     or new.deleted_at is distinct from old.deleted_at
     or new.created_at is distinct from old.created_at then
    raise exception 'only locale may be updated by a client session'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists parent_accounts_guard_trg on public.parent_accounts;
create trigger parent_accounts_guard_trg
  before update on public.parent_accounts
  for each row execute function public.parent_accounts_guard();

create policy parent_accounts_update on public.parent_accounts
  for update using (id = auth.uid()) with check (id = auth.uid());
