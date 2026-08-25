-- StoryPage — domain.ts. Also carries the denormalised parent_id (see
-- page_illustrations above for the rationale).
--
-- scene_description is the internal image prompt: never returned to a client.
-- StoryPageDto (contract.ts) omits it entirely — no client-facing endpoint may
-- `select *` this table (docs/ARCHITECTURE.md).

create table public.story_pages (
  id                    uuid primary key default gen_random_uuid(),
  story_id              uuid not null references public.stories (id) on delete cascade,
  parent_id             uuid not null references public.parent_accounts (id) on delete cascade,
  index                 integer not null check (index >= 1),
  text                  text not null,
  scene_description     text not null,
  illustration_asset_id uuid null references public.page_illustrations (id) on delete set null,
  status                public.story_page_status not null default 'pending',
  regen_count           integer not null default 0 check (regen_count >= 0),
  created_at            timestamptz not null default now()
);

comment on column public.story_pages.index is '1-based. Index 0 is the cover and is NOT a story_pages row.';
comment on column public.story_pages.scene_description is
  'Internal image prompt, self-contained. NEVER returned by any client-facing endpoint.';
comment on column public.story_pages.parent_id is
  'Denormalised owner, maintained by trigger. RLS performance measure — never set by a client.';

create unique index story_pages_story_index_idx on public.story_pages (story_id, index);
create index story_pages_parent_id_idx on public.story_pages (parent_id);

create or replace function public.set_story_pages_parent_id()
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

create trigger story_pages_set_parent_id
  before insert on public.story_pages
  for each row execute function public.set_story_pages_parent_id();

alter table public.story_pages enable row level security;

create policy "story_pages_owner" on public.story_pages
  for all
  using (parent_id = auth.uid())
  with check (parent_id = auth.uid());
