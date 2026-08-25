-- GenerationJob — domain.ts. The durable pipeline-run record: cost
-- accounting, SLO monitoring, refund logic. NOT the transient pgmq message.
--
-- docs/AGENT_BRIEFS.md: client SELECT only. Clients never insert or update
-- this table — writes come from security definer functions or the worker
-- (service-role, bypasses RLS entirely).

create table public.generation_jobs (
  id                    uuid primary key default gen_random_uuid(),
  parent_id             uuid not null references public.parent_accounts (id) on delete cascade,
  story_id              uuid null references public.stories (id) on delete set null,
  character_id          uuid null references public.characters (id) on delete set null,
  type                  public.job_type not null,
  status                public.job_status not null default 'queued',
  stage                 public.generation_stage not null default 'queued',
  pages_completed       integer not null default 0 check (pages_completed >= 0),
  pages_total           integer not null default 0 check (pages_total >= 0),
  attempts              integer not null default 0 check (attempts >= 0),
  cost_cents            integer not null default 0 check (cost_cents >= 0),
  estimated_cost_cents  integer not null default 0 check (estimated_cost_cents >= 0),
  latency_ms            integer null,
  error_code            public.job_error_code null,
  quota_refunded        boolean not null default false,
  idempotency_key       text not null,
  created_at            timestamptz not null default now(),
  started_at            timestamptz null,
  finished_at           timestamptz null
);

comment on column public.generation_jobs.cost_cents is
  'MEASURED, accumulated as stages complete. Drives the cost ceiling.';
comment on column public.generation_jobs.estimated_cost_cents is
  'Pre-flight estimate, reserved at enqueue and reconciled at completion.';
comment on column public.generation_jobs.quota_refunded is
  'True once the story quota has been given back. Idempotency guard — without it, a free-story exploit.';

create index generation_jobs_parent_id_idx on public.generation_jobs (parent_id);
create index generation_jobs_story_id_idx on public.generation_jobs (story_id);
-- Idempotency: the edge function looks up an existing job for this key before
-- ever enqueueing another.
create unique index generation_jobs_parent_idempotency_key_idx
  on public.generation_jobs (parent_id, idempotency_key);

alter table public.generation_jobs enable row level security;

create policy "generation_jobs_owner_select" on public.generation_jobs
  for select
  using (parent_id = auth.uid());

-- Deliberately no insert/update/delete policy for the authenticated/anon
-- roles. Writes happen only via security definer functions (claim_story_quota,
-- refund_story_quota, record_cost) or the worker's service-role client, both
-- of which bypass RLS.
