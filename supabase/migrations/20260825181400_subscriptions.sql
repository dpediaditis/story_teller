-- Subscription — domain.ts. THE SERVER IS AUTHORITATIVE; the client never
-- decides entitlement (DECISIONS.md §8). A client that could UPDATE this row
-- has free access — SELECT only, writes via apply_revenuecat_event().

create table public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  parent_id                 uuid not null references public.parent_accounts (id) on delete cascade,
  product_id                public.product_id null,
  tier                      public.entitlement_tier not null default 'free',
  status                    public.subscription_status not null default 'none',
  renews_at                 timestamptz null,
  expires_at                timestamptz null,
  original_transaction_id  text null,
  revenuecat_app_user_id    text null,
  environment               public.store_environment not null default 'production',
  topup_stories_remaining   integer not null default 0 check (topup_stories_remaining >= 0),
  updated_at                timestamptz not null default now()
);

create unique index subscriptions_parent_id_idx on public.subscriptions (parent_id);

alter table public.subscriptions enable row level security;

create policy "subscriptions_owner_select" on public.subscriptions
  for select
  using (parent_id = auth.uid());

-- No insert/update/delete policy for clients. Writes come only from
-- apply_revenuecat_event() (security definer), called by the
-- revenuecat-webhook Edge Function after signature verification.
