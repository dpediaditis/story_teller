-- StoryCharacter — domain.ts. MANY-TO-MANY FROM DAY ONE, composite primary
-- key, no surrogate id. MVP always writes exactly one row (role 'lead',
-- order_index 0); every read path must nonetheless treat this as a list.

create table public.story_characters (
  story_id     uuid not null references public.stories (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete restrict,
  role         public.story_character_role not null default 'lead',
  order_index  integer not null default 0,
  primary key (story_id, character_id)
);

comment on table public.story_characters is
  'Real join table. MVP writes one row; V1.1 multi-character must not require a migration.';

create index story_characters_character_id_idx on public.story_characters (character_id);

alter table public.story_characters enable row level security;

create policy "story_characters_owner" on public.story_characters
  for all
  using (
    story_id in (
      select s.id from public.stories s
      join public.child_profiles cp on cp.id = s.child_id
      where cp.parent_id = auth.uid()
    )
  )
  with check (
    story_id in (
      select s.id from public.stories s
      join public.child_profiles cp on cp.id = s.child_id
      where cp.parent_id = auth.uid()
    )
    and
    character_id in (
      select c.id from public.characters c
      join public.child_profiles cp on cp.id = c.child_id
      where cp.parent_id = auth.uid()
    )
  );
