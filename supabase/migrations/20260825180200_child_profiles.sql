-- ChildProfile — domain.ts. NO BIRTH DATE. age_band only (CLAUDE.md rule 3).
-- avatar_character_id is added without an FK here: characters doesn't exist
-- yet and characters.child_id references this table. The FK is completed in
-- 20260825180500_child_profiles_avatar_fk.sql once characters exists.

create table public.child_profiles (
  id                  uuid primary key default gen_random_uuid(),
  parent_id           uuid not null references public.parent_accounts (id) on delete cascade,
  display_name        text null,
  age_band            public.age_band not null,
  avatar_character_id uuid null,
  created_at          timestamptz not null default now(),
  deleted_at          timestamptz null
);

comment on column public.child_profiles.display_name is
  'ChildDisplayName. Stored here, rendered in our UI only. Must never reach an AI provider prompt.';

create index child_profiles_parent_id_idx on public.child_profiles (parent_id);

alter table public.child_profiles enable row level security;

create policy "child_profiles_owner" on public.child_profiles
  for all
  using (parent_id = auth.uid())
  with check (parent_id = auth.uid());
