-- UsageRecord — domain.ts. One row per billing period. Free accounts have
-- exactly one row, period_end IS NULL, never rolls over. SELECT only for
-- clients; writes via claim_story_quota / refund_story_quota / record_cost.

create table public.usage_records (
  id                   uuid primary key default gen_random_uuid(),
  parent_id            uuid not null references public.parent_accounts (id) on delete cascade,
  period_start         timestamptz not null,
  period_end           timestamptz null,
  stories_used         integer not null default 0 check (stories_used >= 0),
  characters_used      integer not null default 0 check (characters_used >= 0),
  regens_used          integer not null default 0 check (regens_used >= 0),
  cost_cents_accrued   integer not null default 0 check (cost_cents_accrued >= 0),
  cost_cents_reserved  integer not null default 0 check (cost_cents_reserved >= 0),
  updated_at           timestamptz not null default now()
);

comment on column public.usage_records.period_end is
  'null on the free tier: the period never ends. The free tier does not renew.';
comment on column public.usage_records.cost_cents_accrued is
  'MEASURED spend. The cost ceiling is checked against this + reserved.';
comment on column public.usage_records.cost_cents_reserved is
  'Reserved-but-not-yet-settled cost of in-flight jobs.';

create index usage_records_parent_id_idx on public.usage_records (parent_id);
-- At most one open-ended (free, never-renewing) period per parent.
create unique index usage_records_one_open_period_per_parent
  on public.usage_records (parent_id)
  where period_end is null;

alter table public.usage_records enable row level security;

create policy "usage_records_owner_select" on public.usage_records
  for select
  using (parent_id = auth.uid());

-- No insert/update/delete policy for clients.
