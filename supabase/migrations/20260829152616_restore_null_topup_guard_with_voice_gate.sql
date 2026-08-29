-- REGRESSION FIX + the voice gate, in one authoritative definition.
--
-- The previous migration rebuilt claim_story_quota from the body in
-- 20260826120000, which PREDATES the free-story bypass fix in 20260826130000 —
-- so it silently reverted it.
--
-- `select tier, coalesce(topup_stories_remaining, 0) into v_tier, v_topup`
-- LOOKS like it defends against the null. It does not: coalesce applies to the
-- COLUMN when a row exists, and when no row exists at all (every free user)
-- `select ... into` sets both variables to NULL regardless. Then:
--
--     stories_used >= limit AND v_topup <= 0
--  => 1 >= 1            AND NULL <= 0
--  => NULL              -- not true, so the guard never fires
--
-- Confirmed live before this fix: a free account with stories_used = 1 against
-- a limit of 1 claimed two more stories. The guard must coalesce the VARIABLE
-- after the select, which is what 20260826130000 did and what is restored here.
--
-- THIS FILE IS THE ONLY PLACE claim_story_quota IS DEFINED from here on. If you
-- need to change it, start from THIS body — not from whichever older migration
-- happens to read most completely. That mistake is what caused this file.

-- The 8-argument overload is DROPPED. Two overloads of a security-definer money
-- function is exactly the ambiguity this migration exists to clean up: a caller
-- that omits the voice silently resolves to a different body, and "which one ran"
-- becomes a question you have to answer at 2am. One definition, one gate.
drop function if exists public.claim_story_quota(
  uuid, uuid[], public.story_theme, public.story_mood, public.story_length,
  public.render_technique, text, text
);

create or replace function public.claim_story_quota(
  p_child_id uuid,
  p_character_ids uuid[],
  p_theme public.story_theme,
  p_mood public.story_mood,
  p_length public.story_length,
  p_render_technique public.render_technique,
  p_model_bundle_version text,
  p_idempotency_key text,
  p_voice_id public.narration_voice default 'papercub_default'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_id uuid;
  v_usage public.usage_records%rowtype;
  v_tier public.entitlement_tier;
  v_topup integer;
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

  select * into v_existing from public.generation_jobs
  where parent_id = v_parent_id and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'ok', true, 'idempotentReplay', true,
      'storyId', v_existing.story_id, 'jobId', v_existing.id
    );
  end if;

  -- DERIVED, never supplied. Mirrors STORY_SHAPE in constants.ts.
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

  select tier, topup_stories_remaining into v_tier, v_topup
  from public.subscriptions where parent_id = v_parent_id;

  -- THE FIX. No subscriptions row means NULL, not the declared default, and
  -- `true and NULL` is NULL — which is not `true`, so the guard below never
  -- fired. Coalesce the VARIABLES, after the select. Never the columns.
  v_tier  := coalesce(v_tier, 'free');
  v_topup := coalesce(v_topup, 0);

  v_stories_limit := case when v_tier = 'family' then 5 else 1 end;

  if v_tier <> 'family' and p_length <> 'short' then
    return jsonb_build_object(
      'ok', false, 'blockedBy', 'entitlement_required',
      'allowedLengths', jsonb_build_array('short')
    );
  end if;

  -- VOICE ENTITLEMENT. Mirrors packages/shared/src/voices.ts: everything except
  -- papercub_default is a family benefit. REFUSED, not silently downgraded — a
  -- book read in a voice the parent did not choose is worse than a clear no.
  if v_tier <> 'family' and p_voice_id <> 'papercub_default' then
    return jsonb_build_object(
      'ok', false, 'blockedBy', 'entitlement_required',
      'reason', 'voice',
      'allowedVoices', jsonb_build_array('papercub_default')
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
    -- Only reachable when v_topup > 0, so a row exists to decrement.
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
    child_id, theme, mood, length, status, render_technique, model_bundle_version, voice_id
  ) values (
    p_child_id, p_theme, p_mood, p_length, 'queued', p_render_technique,
    p_model_bundle_version, p_voice_id
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
    'voiceId', p_voice_id,
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
    'storiesUsed', v_usage.stories_used + case when v_consumed_topup then 0 else 1 end,
    'storiesLimit', v_stories_limit,
    'costCentsAccrued', v_usage.cost_cents_accrued,
    'costCentsReserved', v_usage.cost_cents_reserved + v_estimated_cost_cents,
    'costCeilingCents', 385,
    'voiceId', p_voice_id
  );
end;
$$;

revoke all on function public.claim_story_quota(
  uuid, uuid[], public.story_theme, public.story_mood, public.story_length,
  public.render_technique, text, text, public.narration_voice
) from public;
grant execute on function public.claim_story_quota(
  uuid, uuid[], public.story_theme, public.story_mood, public.story_length,
  public.render_technique, text, text, public.narration_voice
) to authenticated;
