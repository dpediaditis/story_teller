-- World / WorldFact / Place — domain.ts v1.2, DECLARED AND UNUSED IN MVP.
-- Created now, with RLS, so My World can be added without a migration. No
-- endpoint in contract.ts exposes these; nothing in MVP reads or writes them.
-- An unused table with RLS off is how you fail a security review later
-- (docs/ARCHITECTURE.md).

create table public.worlds (
  id         uuid primary key default gen_random_uuid(),
  child_id   uuid not null references public.child_profiles (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create index worlds_child_id_idx on public.worlds (child_id);

alter table public.worlds enable row level security;

create policy "worlds_owner" on public.worlds
  for all
  using (
    child_id in (select id from public.child_profiles where parent_id = auth.uid())
  )
  with check (
    child_id in (select id from public.child_profiles where parent_id = auth.uid())
  );

create table public.world_facts (
  id              uuid primary key default gen_random_uuid(),
  world_id        uuid not null references public.worlds (id) on delete cascade,
  subject_type    text not null check (subject_type in ('character', 'place', 'world')),
  subject_id      text not null,
  fact_text       text not null,
  source_story_id uuid null references public.stories (id) on delete set null,
  confidence      numeric not null default 1 check (confidence >= 0 and confidence <= 1),
  superseded_by   uuid null references public.world_facts (id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on column public.world_facts.fact_text is
  'e.g. "Bobo is afraid of the dark." Text, not images — cheap.';

create index world_facts_world_id_idx on public.world_facts (world_id);

alter table public.world_facts enable row level security;

create policy "world_facts_owner" on public.world_facts
  for all
  using (
    world_id in (
      select w.id from public.worlds w
      join public.child_profiles cp on cp.id = w.child_id
      where cp.parent_id = auth.uid()
    )
  )
  with check (
    world_id in (
      select w.id from public.worlds w
      join public.child_profiles cp on cp.id = w.child_id
      where cp.parent_id = auth.uid()
    )
  );

create table public.places (
  id                  uuid primary key default gen_random_uuid(),
  world_id            uuid not null references public.worlds (id) on delete cascade,
  name                text not null,
  description         text not null,
  first_story_id      uuid null references public.stories (id) on delete set null,
  style_ref_asset_id  uuid null references public.character_assets (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index places_world_id_idx on public.places (world_id);

alter table public.places enable row level security;

create policy "places_owner" on public.places
  for all
  using (
    world_id in (
      select w.id from public.worlds w
      join public.child_profiles cp on cp.id = w.child_id
      where cp.parent_id = auth.uid()
    )
  )
  with check (
    world_id in (
      select w.id from public.worlds w
      join public.child_profiles cp on cp.id = w.child_id
      where cp.parent_id = auth.uid()
    )
  );
