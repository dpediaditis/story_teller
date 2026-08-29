/* ═══════════════════════════════════════════════════════════════════════════
 * DECISIONS.md §15 findings 5, 6 and 8.
 *
 * All three are "the guard exists but does not actually bind". None of them
 * were reachable while the app ran on mocks; the app is on the live backend
 * now, so all three are live.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── FINDING 8: the global daily spend cap stopped existing past 1000 jobs ──
 *
 * `globalSpendTodayCents` selected every job row since midnight and summed them
 * in TypeScript. PostgREST caps a response at 1000 rows and says nothing about
 * it, so on the 1001st job of the day the sum silently became "the first 1000
 * jobs" — an undercount that only ever grows, on precisely the busy day the cap
 * exists to protect. DECISIONS.md §3.3's last backstop was strongest when it
 * was needed least.
 *
 * Summed in the database, where there is no row limit.
 */
create or replace function public.global_spend_today_cents()
returns bigint
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(cost_cents), 0)::bigint
  from public.generation_jobs
  where created_at >= date_trunc('day', now() at time zone 'utc');
$$;

comment on function public.global_spend_today_cents is
  'MEASURED spend across every account since midnight UTC. Summed here rather '
  'than client-side: PostgREST silently caps at 1000 rows, which made the cap '
  'stop binding exactly when it mattered (DECISIONS.md §15 finding 8).';

revoke all on function public.global_spend_today_cents() from public;
grant execute on function public.global_spend_today_cents() to service_role;

/* ── FINDING 5: one top-up purchase, replayed, minted unlimited stories ─────
 *
 * `enqueue_revenuecat_event` is granted to `anon, authenticated` — deliberately,
 * because the webhook must be reachable — and the reconciler defends against a
 * forged event by re-fetching subscriber state from RevenueCat with the secret
 * key. That defence works for SUBSCRIPTIONS, which are a snapshot: re-applying
 * the same state twice is idempotent.
 *
 * It does not work for TOP-UPS, which are an increment. `confirmsTopup()` asked
 * only whether a top-up had EVER been purchased, so replaying one genuine
 * NON_RENEWING_PURCHASE event granted +3 stories every time. One EUR 4.99
 * purchase, unlimited stories.
 *
 * Fixed where it cannot be got around: the grant is keyed on the store's own
 * transaction id, with a primary key making a second grant impossible. The
 * reconciler now passes the transaction ids it saw; the arithmetic follows from
 * how many were NEW, so a replay grants exactly zero.
 */
create table if not exists public.topup_grants (
  transaction_id   text primary key,
  parent_id        uuid not null references public.parent_accounts (id) on delete cascade,
  product_id       public.product_id not null,
  stories_granted  integer not null check (stories_granted > 0),
  granted_at       timestamptz not null default now()
);

create index if not exists topup_grants_parent_id_idx on public.topup_grants (parent_id);

alter table public.topup_grants enable row level security;

-- SELECT only, like every other money table. Writes come from
-- apply_revenuecat_event (security definer) and nowhere else.
create policy "topup_grants_owner_select" on public.topup_grants
  for select using (parent_id = auth.uid());

comment on table public.topup_grants is
  'One row per store transaction that has ALREADY granted top-up stories. The '
  'primary key on transaction_id is the whole point: it makes a replayed '
  'purchase event grant nothing (DECISIONS.md §15 finding 5).';

/* ── FINDING 6: a paying customer silently stopped being able to generate ───
 *
 * The old body inserted a usage period only when no open one existed, and never
 * touched `period_end`. RevenueCat sends RENEWAL while the current period is
 * still open, so the renewal was a no-op and `period_end` kept the PREVIOUS
 * cycle's date. The moment that passed, `loadEntitlementAndQuota` found no open
 * paid row and fell back to the free row — whose `cost_cents_accrued` never
 * resets, because the free tier never renews. The subscriber kept paying and
 * quietly stopped being able to make anything.
 *
 * Now: a renewal is detected by `renews_at` advancing past the current period's
 * end. That closes the current period and opens a fresh one with counters at
 * zero. An event that does NOT advance `renews_at` — and RevenueCat sends many —
 * changes nothing, so quota is never reset mid-period.
 */
drop function if exists public.apply_revenuecat_event(
  uuid, public.product_id, public.entitlement_tier, public.subscription_status,
  timestamptz, timestamptz, text, text, public.store_environment, boolean
);

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
  p_is_topup boolean default false,
  -- Store transaction ids for top-up purchases RevenueCat currently reports.
  -- The set is re-sent on every reconcile pass; only the unseen ones grant.
  p_topup_transaction_ids text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage           public.usage_records%rowtype;
  v_newly_granted   integer := 0;
  v_stories_added   integer := 0;
  v_period_rolled   boolean := false;
begin
  if not exists (select 1 from public.parent_accounts where id = p_parent_id) then
    raise exception 'parent_accounts % not found', p_parent_id;
  end if;

  /* Top-ups: insert-if-new, and count what was actually new. `on conflict do
   * nothing` is the guard — a replayed transaction id inserts zero rows and
   * therefore grants zero stories, no matter how many times it arrives. */
  if p_topup_transaction_ids is not null and array_length(p_topup_transaction_ids, 1) > 0 then
    with inserted as (
      insert into public.topup_grants (transaction_id, parent_id, product_id, stories_granted)
      select txn_id, p_parent_id, p_product_id, 3   -- TOPUP_STORIES_GRANTED
      from unnest(p_topup_transaction_ids) as txn_id
      on conflict (transaction_id) do nothing
      returning 1
    )
    select count(*) into v_newly_granted from inserted;
  end if;

  v_stories_added := v_newly_granted * 3;

  insert into public.subscriptions (
    parent_id, product_id, tier, status, renews_at, expires_at,
    original_transaction_id, revenuecat_app_user_id, environment,
    topup_stories_remaining, updated_at
  ) values (
    p_parent_id, p_product_id, p_tier, p_status, p_renews_at, p_expires_at,
    p_original_transaction_id, p_revenuecat_app_user_id, p_environment,
    v_stories_added, now()
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
    topup_stories_remaining = public.subscriptions.topup_stories_remaining + v_stories_added,
    updated_at = now();

  if p_tier = 'family' and p_status = 'active' then
    select * into v_usage
    from public.usage_records
    where parent_id = p_parent_id
      and period_end is not null
      and now() < period_end
    order by period_start desc
    limit 1
    for update;

    if not found then
      -- No current paid period: the first one, or the previous one has expired.
      insert into public.usage_records (parent_id, period_start, period_end)
      values (p_parent_id, now(), p_renews_at);
      v_period_rolled := true;

    elsif p_renews_at is not null and p_renews_at > v_usage.period_end then
      -- RENEWED. Close the period that just ended and open a fresh one, with
      -- stories_used and cost_cents_accrued back at zero. DECISIONS.md §1:
      -- quota resets on the billing anniversary, no rollover.
      update public.usage_records
        set period_end = now(), updated_at = now()
        where id = v_usage.id;

      insert into public.usage_records (parent_id, period_start, period_end)
      values (p_parent_id, now(), p_renews_at);
      v_period_rolled := true;
    end if;
    -- Any other event leaves the period alone: RevenueCat sends several per
    -- cycle and resetting quota on each would hand out unlimited stories.
  end if;

  return jsonb_build_object(
    'topupTransactionsGranted', v_newly_granted,
    'storiesGranted', v_stories_added,
    'periodRolled', v_period_rolled
  );
end;
$$;

revoke all on function public.apply_revenuecat_event(
  uuid, public.product_id, public.entitlement_tier, public.subscription_status,
  timestamptz, timestamptz, text, text, public.store_environment, boolean, text[]
) from public;
grant execute on function public.apply_revenuecat_event(
  uuid, public.product_id, public.entitlement_tier, public.subscription_status,
  timestamptz, timestamptz, text, text, public.store_environment, boolean, text[]
) to service_role;
