/* ═══════════════════════════════════════════════════════════════════════════
 * character_build could never be enqueued at all.
 *
 * `generation_jobs` has a SELECT-only policy for `authenticated` — deliberately,
 * so a client can never write its own job row. B1 supplied a security-definer
 * claim function for `story_generate` (claim_story_quota) and for nothing else,
 * so `supabase/functions/characters` hit a 42501 on every create and rolled the
 * character and drawing back out again. `_shared/jobs.ts` documented this as a
 * known gap and raised a typed error; this migration closes it.
 *
 * The consequence, until now: the FIRST thing a real user does — photograph a
 * drawing and wait for a character — could not succeed through the real API at
 * all. It was only reachable by inserting the job by hand.
 *
 * This function is deliberately NARROWER than claim_story_quota. The drawing and
 * character rows are written by the Edge Function under the caller's own JWT,
 * where RLS applies to them; only the part RLS must forbid a client to do —
 * claim the slot, reserve the cost, write the job, enqueue — happens here.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── The character slot is a live count, and `failed` no longer occupies one ──
 *
 * `charactersUsed` has always been derived (`_shared/quota.ts` counts
 * non-archived `characters` rows) rather than read from a counter. That is a
 * good property — a derived count cannot drift out of step with reality the way
 * a counter incremented in one place and decremented in another can.
 *
 * But it meant a FAILED build kept its slot forever: the row stayed at status
 * `building`, still counted, and on the free tier — one character, total, ever —
 * a user whose first build failed could never make another. There was nothing to
 * refund, because nothing had been incremented.
 *
 * Fixed by excluding `failed` from the count, so the slot returns the moment the
 * worker marks the character failed. No second counter, no refund path, and
 * nothing that can double-release.
 */

comment on column public.usage_records.characters_used is
  'DEAD COLUMN — never written. The character slot is derived by counting '
  'public.characters rows that are neither archived nor failed (see '
  'claim_character_build and supabase/functions/_shared/quota.ts). Kept rather '
  'than dropped because packages/shared/src/db.ts is generated from this schema; '
  'do not start writing it without removing the derived count first, or the two '
  'will disagree.';

create or replace function public.claim_character_build(
  p_character_id uuid,
  p_model_bundle_version text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_id   uuid;
  v_child_id    uuid;
  v_drawing_id  uuid;
  v_cutout_key  text;
  v_usage       public.usage_records%rowtype;
  v_tier        public.entitlement_tier;
  v_limit       integer;
  v_in_use      integer;
  v_existing    public.generation_jobs%rowtype;
  v_job_id      uuid;
  v_estimate    constant integer := 16;  -- CHARACTER_BUILD_ESTIMATED_COST_CENTS
begin
  v_parent_id := auth.uid();
  if v_parent_id is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Ownership, and the cut-out the worker will be told to read. Resolved HERE
  -- from the character id rather than taken from the caller: a caller-supplied
  -- storage key would let one account point a build at another's drawing.
  select c.child_id, c.drawing_id, od.cutout_storage_key
    into v_child_id, v_drawing_id, v_cutout_key
  from public.characters c
  join public.child_profiles cp on cp.id = c.child_id
  left join public.original_drawings od on od.id = c.drawing_id
  where c.id = p_character_id
    and cp.parent_id = v_parent_id
    and cp.deleted_at is null
    and c.archived_at is null;

  if not found then
    raise exception 'forbidden: character does not belong to caller'
      using errcode = '42501';
  end if;

  if v_cutout_key is null or length(v_cutout_key) = 0 then
    raise exception 'character % has no cut-out to analyse', p_character_id
      using errcode = '22023';
  end if;

  -- Idempotency, same contract as claim_story_quota: same key, same claim.
  select * into v_existing from public.generation_jobs
  where parent_id = v_parent_id and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'ok', true, 'idempotentReplay', true,
      'characterId', v_existing.character_id, 'jobId', v_existing.id
    );
  end if;

  select * into v_usage from public.usage_records
  where parent_id = v_parent_id
    and (period_end is null or now() < period_end)
  order by period_start desc
  limit 1
  for update;

  if not found then
    raise exception 'no active usage period for parent %', v_parent_id;
  end if;

  select coalesce(tier, 'free') into v_tier
  from public.subscriptions where parent_id = v_parent_id;
  v_tier := coalesce(v_tier, 'free');
  v_limit := case when v_tier = 'family' then 5 else 1 end;  -- QUOTA.*.charactersTotal

  -- Every OTHER character already holding a slot. This one is excluded because
  -- the Edge Function has already inserted it; counting it would make the very
  -- first character on the free tier fail its own limit check.
  select count(*) into v_in_use
  from public.characters c
  join public.child_profiles cp on cp.id = c.child_id
  where cp.parent_id = v_parent_id
    and cp.deleted_at is null
    and c.id <> p_character_id
    and c.archived_at is null
    and c.status <> 'failed';

  if v_in_use >= v_limit then
    return jsonb_build_object(
      'ok', false, 'blockedBy', 'character_quota_exhausted',
      'charactersUsed', v_in_use, 'charactersLimit', v_limit
    );
  end if;

  if v_usage.cost_cents_accrued + v_usage.cost_cents_reserved + v_estimate > 385 then
    return jsonb_build_object(
      'ok', false, 'blockedBy', 'cost_ceiling_reached',
      'costCentsAccrued', v_usage.cost_cents_accrued,
      'costCentsReserved', v_usage.cost_cents_reserved,
      'costCeilingCents', 385
    );
  end if;

  -- RESERVE. DECISIONS.md §15 finding 4: character_build previously wrote an
  -- estimate without ever reserving, so settling it released a CONCURRENT
  -- story's reservation. `cost_reserved` is what makes record_cost and
  -- refund_story_quota release this job's own reservation exactly once.
  update public.usage_records
    set cost_cents_reserved = cost_cents_reserved + v_estimate,
        updated_at = now()
    where id = v_usage.id;

  insert into public.generation_jobs (
    parent_id, character_id, type, status, stage,
    estimated_cost_cents, cost_reserved, idempotency_key
  ) values (
    v_parent_id, p_character_id, 'character_build', 'queued', 'queued',
    v_estimate, true, p_idempotency_key
  ) returning id into v_job_id;

  -- Enqueued in THIS transaction: an aborted claim takes the message with it
  -- rather than stranding a job nobody reserved for (DECISIONS.md §15 finding 3).
  perform pgmq.send('papercub_generation', jsonb_build_object(
    'type', 'character_build',
    'jobId', v_job_id,
    'parentId', v_parent_id,
    'childId', v_child_id,
    'characterId', p_character_id,
    'drawingId', v_drawing_id,
    'cutoutStorageKey', v_cutout_key,
    'estimatedCostCents', v_estimate,
    'modelBundleVersion', p_model_bundle_version,
    'enqueuedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'attempt', 1
  ));

  return jsonb_build_object(
    'ok', true,
    'characterId', p_character_id,
    'jobId', v_job_id,
    'estimatedCostCents', v_estimate,
    'charactersUsed', v_in_use + 1,
    'charactersLimit', v_limit
  );
end;
$$;

revoke all on function public.claim_character_build(uuid, text, text) from public;
grant execute on function public.claim_character_build(uuid, text, text) to authenticated;
