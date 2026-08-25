-- PageIllustration — domain.ts. Carries a denormalised parent_id
-- (docs/ARCHITECTURE.md): the three-level join (page_illustrations -> stories
-- -> child_profiles -> parent) is the one place RLS becomes a measurable cost,
-- so a trigger-maintained column replaces a scanning policy with a single
-- predicate.

create table public.page_illustrations (
  id                  uuid primary key default gen_random_uuid(),
  story_id            uuid not null references public.stories (id) on delete cascade,
  parent_id           uuid not null references public.parent_accounts (id) on delete cascade,
  page_index          integer not null check (page_index >= 0),
  storage_key         text not null,
  width               integer not null check (width > 0),
  height              integer not null check (height > 0),
  model_id            text not null,
  seed                bigint null,
  reference_asset_ids uuid[] not null default '{}',
  moderation_verdict  public.moderation_verdict not null default 'pass',
  cost_cents          integer not null default 0 check (cost_cents >= 0),
  created_at          timestamptz not null default now()
);

comment on column public.page_illustrations.page_index is '0 = cover.';
comment on column public.page_illustrations.reference_asset_ids is
  'Recording the reference set per image is what makes consistency debuggable.';
comment on column public.page_illustrations.parent_id is
  'Denormalised owner, maintained by trigger. RLS performance measure — never set by a client.';

create unique index page_illustrations_story_page_idx
  on public.page_illustrations (story_id, page_index);
create index page_illustrations_parent_id_idx on public.page_illustrations (parent_id);

create or replace function public.set_page_illustrations_parent_id()
returns trigger
language plpgsql
as $$
begin
  select cp.parent_id into strict new.parent_id
  from public.stories s
  join public.child_profiles cp on cp.id = s.child_id
  where s.id = new.story_id;
  return new;
end;
$$;

create trigger page_illustrations_set_parent_id
  before insert on public.page_illustrations
  for each row execute function public.set_page_illustrations_parent_id();

alter table public.page_illustrations enable row level security;

-- Single-predicate policy, made possible by the denormalised parent_id.
create policy "page_illustrations_owner" on public.page_illustrations
  for all
  using (parent_id = auth.uid())
  with check (parent_id = auth.uid());
