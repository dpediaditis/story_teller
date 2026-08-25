-- Completes the circular reference: stories.cover_asset_id -> page_illustrations(id).
-- Deferred to this migration because page_illustrations.story_id -> stories
-- had to exist first.

alter table public.stories
  add constraint stories_cover_asset_id_fkey
  foreign key (cover_asset_id) references public.page_illustrations (id) on delete set null;

create index stories_cover_asset_id_idx on public.stories (cover_asset_id);
