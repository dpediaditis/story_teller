-- ModerationEvent — domain.ts. Append-only audit trail, the answer to App
-- Review's safety question. SELECT only for clients.

create table public.moderation_events (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid not null references public.parent_accounts (id) on delete cascade,
  subject_type public.moderation_subject_type not null,
  subject_id   text not null,
  stage        public.moderation_stage not null,
  verdict      public.moderation_verdict not null,
  categories   text[] not null default '{}',
  action_taken public.moderation_action not null,
  provider     text not null,
  raw_score    numeric null,
  created_at   timestamptz not null default now()
);

create index moderation_events_parent_id_idx on public.moderation_events (parent_id);
create index moderation_events_subject_idx on public.moderation_events (subject_type, subject_id);

alter table public.moderation_events enable row level security;

create policy "moderation_events_owner_select" on public.moderation_events
  for select
  using (parent_id = auth.uid());

-- No insert/update/delete policy for clients. Append-only, written by the
-- worker's service-role client at each of the four moderation gates.
