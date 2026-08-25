-- Closes the grant mismatch between B1 (schema) and B2 (Edge Functions).
--
-- `apply_revenuecat_event` and `merge_accounts` were granted to `service_role`
-- only, but Edge Functions deliberately do not hold SUPABASE_SERVICE_ROLE_KEY
-- (CLAUDE.md rule 1 — that key lives only in services/worker, so a bug in a
-- client-reachable function can be a broken feature but never a data breach).
-- Both RPCs would therefore have failed at runtime.
--
-- The two problems have different shapes and get different fixes.

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. merge_accounts — authorisation belongs to the caller, not to a role.
 *
 * Session B legitimately holds a user JWT and owns the merge TARGET. Its right
 * to the SOURCE comes from the merge token, which the Edge Function verifies
 * before calling. So this does not need elevated privilege at all — it needs
 * the function to re-check ownership itself rather than trusting its arguments.
 *
 * The re-check matters: without it, any authenticated user could pass someone
 * else's uid as p_target_parent_id and pull their library across.
 * ═══════════════════════════════════════════════════════════════════════════ */

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
  -- The caller must BE the target. The Edge Function has already proven the
  -- caller's right to the source by verifying the signed merge token; this
  -- guards the half the token cannot speak for.
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if auth.uid() <> p_target_parent_id then
    raise exception 'forbidden: caller is not the merge target'
      using errcode = '42501';
  end if;

  if p_source_parent_id = p_target_parent_id then
    raise exception 'source and target are the same account'
      using errcode = '22023';
  end if;

  -- Refuse to merge from an account that is not anonymous. Only an anonymous
  -- uid may be absorbed; a real account is never silently emptied.
  if not exists (
    select 1 from public.parent_accounts
    where id = p_source_parent_id
      and is_anonymous
      and deleted_at is null
  ) then
    raise exception 'source account is not an unmerged anonymous account'
      using errcode = '42501';
  end if;

  if p_strategy = 'merge' then
    -- Everything else (characters, stories, drawings) hangs off child_profiles,
    -- so reassigning the parent moves the whole library in one statement.
    update public.child_profiles
      set parent_id = p_target_parent_id
      where parent_id = p_source_parent_id;
  end if;

  -- 'keep_account_only' moves nothing. The anonymous content stays in place and
  -- is retained for RETENTION_DAYS.orphanedAnonymousContent (30 days) by the
  -- purge job — never deleted here. DECISIONS.md §7: never silently discard
  -- either side.
  update public.parent_accounts
    set deleted_at = now()
    where id = p_source_parent_id;
end;
$$;

revoke all on function public.merge_accounts(uuid, uuid, public.merge_strategy) from public;
grant execute on function public.merge_accounts(uuid, uuid, public.merge_strategy) to authenticated;

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. RevenueCat — an inbox the worker drains, not a direct write.
 *
 * The webhook is server-to-server and holds no user JWT, so it cannot be
 * authorised by RLS. Rather than hand it the service-role key, it drops a
 * signal into an inbox and services/worker (which legitimately holds the key)
 * applies the entitlement change.
 *
 * The important consequence: the stored payload is a HINT, not a source of
 * truth. The worker must re-fetch subscriber state from RevenueCat's REST API
 * with REVENUECAT_SECRET_API_KEY before calling apply_revenuecat_event. That
 * makes a forged inbox row harmless — it can at most cause a redundant
 * reconciliation of an account that is then read from RevenueCat anyway.
 * ═══════════════════════════════════════════════════════════════════════════ */

create table if not exists public.revenuecat_event_inbox (
  id uuid primary key default gen_random_uuid(),
  -- RevenueCat's own event id. Unique, so webhook redelivery is idempotent.
  event_id text not null unique,
  app_user_id text not null,
  event_type text not null,
  environment text not null,
  -- Untrusted. Kept for debugging and audit; never applied without
  -- reconciliation against the RevenueCat API.
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text
);

alter table public.revenuecat_event_inbox enable row level security;

-- No policy at all: no client role may read or write this table by any path.
-- The worker reaches it with the service-role key, which bypasses RLS; the
-- webhook reaches it only through the security-definer function below.

create index if not exists revenuecat_event_inbox_unprocessed_idx
  on public.revenuecat_event_inbox (received_at)
  where processed_at is null;

/**
 * The only way the webhook can write. Deliberately does nothing but record —
 * no entitlement logic, no reads of other users' rows, no return of anything
 * the caller did not already supply.
 *
 * Granted to `anon` because the Edge Function calls it with the anon key after
 * verifying REVENUECAT_WEBHOOK_SECRET itself. The blast radius if that secret
 * ever leaked is "rows appear in an inbox that the worker then validates
 * against RevenueCat" — which is why reconciliation is mandatory, not optional.
 */
create or replace function public.enqueue_revenuecat_event(
  p_event_id text,
  p_app_user_id text,
  p_event_type text,
  p_environment text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event_id is null or length(p_event_id) = 0 then
    raise exception 'event_id is required' using errcode = '22023';
  end if;

  if length(p_payload::text) > 65536 then
    raise exception 'payload too large' using errcode = '22001';
  end if;

  insert into public.revenuecat_event_inbox (
    event_id, app_user_id, event_type, environment, payload
  )
  values (
    p_event_id, p_app_user_id, p_event_type, p_environment, p_payload
  )
  -- Redelivery is expected and must be a no-op, not a duplicate grant.
  on conflict (event_id) do nothing;
end;
$$;

revoke all on function public.enqueue_revenuecat_event(text, text, text, text, jsonb) from public;
grant execute on function public.enqueue_revenuecat_event(text, text, text, text, jsonb) to anon, authenticated;

comment on table public.revenuecat_event_inbox is
  'Untrusted webhook signals. services/worker drains this and reconciles each '
  'app_user_id against the RevenueCat REST API before calling '
  'apply_revenuecat_event. Never apply payload contents directly.';
