-- CharacterAsset — domain.ts. The consistency backbone: built once, reused for
-- every story forever, versioned so pipeline changes don't retroactively break
-- old stories.

create table public.character_assets (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  kind         public.character_asset_kind not null,
  storage_key  text not null,
  model_id     text null,
  prompt_hash  text null,
  version      integer not null default 1 check (version > 0),
  is_primary   boolean not null default false,
  width_px     integer not null check (width_px > 0),
  height_px    integer not null check (height_px > 0),
  created_at   timestamptz not null default now()
);

comment on column public.character_assets.prompt_hash is
  'SHA-256 of the exact prompt used. Cache key + reproducibility.';

create index character_assets_character_id_idx on public.character_assets (character_id);
-- At most one primary asset per (character, kind).
create unique index character_assets_one_primary_per_kind
  on public.character_assets (character_id, kind)
  where is_primary;

alter table public.character_assets enable row level security;

create policy "character_assets_owner" on public.character_assets
  for all
  using (
    character_id in (
      select c.id from public.characters c
      join public.child_profiles cp on cp.id = c.child_id
      where cp.parent_id = auth.uid()
    )
  )
  with check (
    character_id in (
      select c.id from public.characters c
      join public.child_profiles cp on cp.id = c.child_id
      where cp.parent_id = auth.uid()
    )
  );
