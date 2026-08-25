-- Narration — domain.ts.

create table public.narrations (
  id                  uuid primary key default gen_random_uuid(),
  story_id            uuid not null references public.stories (id) on delete cascade,
  voice_id            text not null,
  provider            text not null,
  storage_key         text not null,
  duration_ms         integer not null check (duration_ms >= 0),
  word_timings_key    text null,
  sentence_level_only boolean not null default false,
  language             text not null,
  created_at          timestamptz not null default now()
);

comment on column public.narrations.word_timings_key is
  'Separate JSON blob of word/sentence timings, for highlighting.';
comment on column public.narrations.sentence_level_only is
  'Fell back to sentence-level timing. Sufficient for a 5-year-old.';

create unique index narrations_story_id_idx on public.narrations (story_id);

alter table public.narrations enable row level security;

create policy "narrations_owner" on public.narrations
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
  );
