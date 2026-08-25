-- Story — domain.ts.
--
-- STRUCTURAL RULE: there is NO character_id column on this table. The
-- character relationship lives exclusively in story_characters, a real
-- many-to-many join table created in the next migration. MVP writes exactly
-- one row there (role 'lead', order_index 0); V1.1 multi-character support
-- must not require migrating a single existing story. Do not "helpfully" add
-- a convenience column here — see docs/AGENT_BRIEFS.md B1 item 2.
--
-- cover_asset_id is added without an FK here: page_illustrations doesn't exist
-- yet (it references stories). Completed in 20260825181200.

create table public.stories (
  id                   uuid primary key default gen_random_uuid(),
  child_id             uuid not null references public.child_profiles (id) on delete cascade,
  title                text null,
  theme                public.story_theme not null,
  mood                 public.story_mood not null,
  length               public.story_length not null,
  status               public.story_status not null default 'draft',
  cover_asset_id       uuid null,
  render_technique     public.render_technique not null default 'cutout_rerender',
  model_bundle_version text not null,
  character_tombstone  boolean not null default false,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz null,
  favourited_at        timestamptz null,
  deleted_at           timestamptz null
);

comment on column public.stories.render_technique is
  'Per-story so Milestone 0''s Fidelity Ladder can choose without a migration.';
comment on column public.stories.character_tombstone is
  'The starring character was deleted. Story survives and stays readable.';

create index stories_child_id_idx on public.stories (child_id);

alter table public.stories enable row level security;

create policy "stories_owner" on public.stories
  for all
  using (
    child_id in (select id from public.child_profiles where parent_id = auth.uid())
  )
  with check (
    child_id in (select id from public.child_profiles where parent_id = auth.uid())
  );
