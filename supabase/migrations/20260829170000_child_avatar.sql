-- A picture for each child, next to their name.
--
-- The Family tab showed the first letter of the display name in a circle, which
-- is an adult convention: a child who cannot read yet cannot find themselves in
-- a list of letters, and a child with no name set showed "?".
--
-- An ENUM rather than free text, deliberately. child_profiles is written through
-- the `children` Edge Function, but the column is reachable by any future
-- writer, and this value is rendered directly into the UI — an open text column
-- that lands on screen is an injection surface and a way to end up with
-- something that is not an avatar at all. The set is small, closed, and mirrors
-- CHILD_AVATARS in packages/shared/src/avatars.ts.
--
-- DECISIONS.md §10 is unaffected: this is a picture the PARENT picks, stored
-- next to a display name that already never leaves our own UI. It is not
-- derived from the child and it never reaches a provider.

create type public.child_avatar as enum (
  'fox', 'rabbit', 'panda', 'frog', 'unicorn', 'octopus', 'bee', 'turtle'
);

alter table public.child_profiles
  add column if not exists avatar public.child_avatar null;

comment on column public.child_profiles.avatar is
  'Picture shown beside the child in the Family tab. Parent-chosen, closed set '
  '(packages/shared/src/avatars.ts). Never sent to a provider.';
