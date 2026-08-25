-- Completes the circular reference: child_profiles.avatar_character_id -> characters(id).
-- Deferred to this migration because characters.child_id -> child_profiles had
-- to exist first.

alter table public.child_profiles
  add constraint child_profiles_avatar_character_id_fkey
  foreign key (avatar_character_id) references public.characters (id) on delete set null;

create index child_profiles_avatar_character_id_idx on public.child_profiles (avatar_character_id);
