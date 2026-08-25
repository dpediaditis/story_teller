-- Character — domain.ts. `name` is user free text; treated as UntrustedText at
-- every prompt boundary (packages/shared/src/prompt-safety.ts) — that's an
-- application-layer rule, not something SQL can enforce.

create table public.characters (
  id                  uuid primary key default gen_random_uuid(),
  child_id            uuid not null references public.child_profiles (id) on delete cascade,
  drawing_id          uuid not null references public.original_drawings (id),
  name                text not null,
  character_type      text null,
  personality_traits  text[] not null default '{}',
  palette             text[] not null default '{}',
  feature_anchor      text null,
  status              public.character_status not null default 'draft',
  created_at          timestamptz not null default now(),
  archived_at         timestamptz null
);

comment on column public.characters.feature_anchor is
  'Textual feature anchor from the vision pass. Injected into every image prompt.';

create index characters_child_id_idx on public.characters (child_id);
create index characters_drawing_id_idx on public.characters (drawing_id);

alter table public.characters enable row level security;

create policy "characters_owner" on public.characters
  for all
  using (
    child_id in (select id from public.child_profiles where parent_id = auth.uid())
  )
  with check (
    child_id in (select id from public.child_profiles where parent_id = auth.uid())
  );
